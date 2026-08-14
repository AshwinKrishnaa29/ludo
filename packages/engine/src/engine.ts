import {
  CommandRejected,
  HOME_COLUMN_ENTRY,
  HOME_PROGRESS,
  MISSED_TURNS_BEFORE_PAUSE,
  PAUSE_GRACE_MS,
  SAFE_SQUARES,
  TOKENS_PER_PLAYER,
  defaultColours,
  isFinished,
  toAbsoluteSquare,
  zoneOf,
  type GameCommand,
  type GameEvent,
  type GameState,
  type Player,
  type PlayerColour,
  type Token,
} from '@ludo/shared';
import type { DiceRoller } from './dice.js';

export const TURN_TIMEOUT_MS = 30_000;

/** How many command ids to remember for idempotency. Bounds state size. */
const COMMAND_HISTORY = 64;

export interface ApplyDeps {
  readonly dice: DiceRoller;
  readonly now: number;
}

export interface ApplyResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface SeatInput {
  readonly userId: string;
  readonly displayName: string;
  /** Chosen in the lobby. Falls back to the default seating when absent. */
  readonly colour?: PlayerColour;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createGame(
  gameId: string,
  roomId: string,
  seats: readonly SeatInput[],
  now: number,
): GameState {
  if (seats.length < 2 || seats.length > 4) {
    throw new Error('a game needs between 2 and 4 players');
  }

  const fallback = defaultColours(seats.length);
  const used = new Set<PlayerColour>();
  const colours = seats.map((seat, i) => {
    const chosen = seat.colour;
    if (chosen && !used.has(chosen)) {
      used.add(chosen);
      return chosen;
    }
    // Two players must never share a colour: colour *is* the route around the
    // board, so a duplicate would put two racers on one set of squares.
    const free = fallback.find((c) => !used.has(c))
      ?? (['red', 'green', 'yellow', 'blue'] as const).find((c) => !used.has(c));
    if (!free) throw new Error('ran out of colours');
    used.add(free);
    void i;
    return free;
  });

  const players: Player[] = seats.map((seat, i) => ({
    userId: seat.userId,
    displayName: seat.displayName,
    colour: colours[i] as PlayerColour,
    tokens: emptyTokens(),
    connected: true,
    missedTurns: 0,
    finishedRank: null,
    abandoned: false,
  }));

  return {
    gameId,
    roomId,
    phase: 'awaiting_roll',
    players,
    turnIndex: 0,
    pendingRoll: null,
    consecutiveSixes: 0,
    version: 0,
    turnDeadline: now + TURN_TIMEOUT_MS,
    pausedFor: null,
    appliedCommands: [],
    winnerOrder: [],
  };
}

function emptyTokens(): Token[] {
  return Array.from({ length: TOKENS_PER_PLAYER }, (_, id) => ({ id, progress: null }));
}

// ---------------------------------------------------------------------------
// Legal move calculation
// ---------------------------------------------------------------------------

export interface LegalMove {
  readonly tokenId: number;
  readonly from: number | null;
  readonly to: number;
  readonly captures: readonly { userId: string; tokenId: number }[];
  readonly reachesHome: boolean;
}

export function legalMoves(state: GameState, roll: number): LegalMove[] {
  const player = state.players[state.turnIndex];
  if (!player || player.finishedRank !== null || player.abandoned) return [];
  if (state.phase === 'paused' || state.phase === 'finished') return [];

  const moves: LegalMove[] = [];
  for (const token of player.tokens) {
    const zone = zoneOf(token.progress);
    if (zone === 'home') continue;

    let to: number;
    if (zone === 'yard') {
      if (roll !== 6) continue;
      to = 0;
    } else {
      to = (token.progress as number) + roll;
      // Overshooting the centre is not allowed - an exact roll is required.
      if (to > HOME_PROGRESS) continue;
    }

    moves.push({
      tokenId: token.id,
      from: token.progress,
      to,
      captures: capturesAt(state, player, to),
      reachesHome: to === HOME_PROGRESS,
    });
  }
  return moves;
}

function capturesAt(
  state: GameState,
  mover: Player,
  toProgress: number,
): { userId: string; tokenId: number }[] {
  const square = toAbsoluteSquare(mover.colour, toProgress);
  // Home column squares are private, so nothing can be captured there.
  if (square === null || SAFE_SQUARES.has(square)) return [];

  const victims: { userId: string; tokenId: number }[] = [];
  for (const other of state.players) {
    if (other.userId === mover.userId || other.abandoned) continue;
    for (const token of other.tokens) {
      if (token.progress === null || token.progress >= HOME_COLUMN_ENTRY) continue;
      if (toAbsoluteSquare(other.colour, token.progress) === square) {
        victims.push({ userId: other.userId, tokenId: token.id });
      }
    }
  }
  return victims;
}

// ---------------------------------------------------------------------------
// Command application
// ---------------------------------------------------------------------------

export function applyCommand(
  state: GameState,
  command: GameCommand,
  deps: ApplyDeps,
): ApplyResult {
  // Idempotency first: a client retrying after a dropped socket must never
  // roll twice or move twice.
  if (state.appliedCommands.includes(command.commandId)) {
    return { state, events: [] };
  }

  switch (command.type) {
    case 'set_connection':
      return remember(applyConnection(state, command.userId, command.connected, deps), command);
    case 'roll_dice': {
      const woken = wakeUp(state, command.userId, deps);
      requireActive(woken.state, command.userId, 'awaiting_roll');
      const rolled = applyRoll(woken.state, deps);
      return remember(
        { state: rolled.state, events: [...woken.events, ...rolled.events] },
        command,
      );
    }
    case 'move_token':
      requireActive(state, command.userId, 'awaiting_move');
      return remember(applyMove(state, command.tokenId, deps), command);
    case 'auto_play':
      return remember(applyAutoPlay(state, deps), command);
    case 'abandon_player':
      return remember(
        applyAbandon(state, command.userId, command.targetUserId, deps),
        command,
      );
  }
}

function requireActive(state: GameState, userId: string, phase: GameState['phase']): void {
  if (state.phase === 'finished') throw new CommandRejected('game_finished');
  if (state.phase === 'paused') throw new CommandRejected('game_paused');
  const current = state.players[state.turnIndex];
  if (!current) throw new CommandRejected('unknown_player');
  if (current.userId !== userId) throw new CommandRejected('not_your_turn');
  if (state.phase !== phase) throw new CommandRejected('wrong_phase');
}

function remember(result: ApplyResult, command: GameCommand): ApplyResult {
  if (result.events.length === 0) return result;
  const history = [...result.state.appliedCommands, command.commandId].slice(-COMMAND_HISTORY);
  return {
    ...result,
    state: { ...result.state, appliedCommands: history, version: result.state.version + 1 },
  };
}

// ---------------------------------------------------------------------------

function applyConnection(
  state: GameState,
  userId: string,
  connected: boolean,
  deps: ApplyDeps,
): ApplyResult {
  const index = state.players.findIndex((p) => p.userId === userId);
  if (index === -1) throw new CommandRejected('unknown_player');
  const target = state.players[index]!;
  if (target.abandoned) return { state, events: [] };

  const players = state.players.map((p, i) => (i === index ? { ...p, connected } : p));
  const events: GameEvent[] = [{ type: 'connection_changed', userId, connected }];

  // Coming back is what un-pauses the table. Their missed turns are forgiven,
  // so a second blip later does not immediately pause the game again.
  if (connected && state.phase === 'paused' && state.pausedFor === userId) {
    const forgiven = players.map((p, i) => (i === index ? { ...p, missedTurns: 0 } : p));
    events.push({ type: 'game_resumed', userId });
    return {
      state: {
        ...state,
        players: forgiven,
        phase: 'awaiting_roll',
        pausedFor: null,
        pendingRoll: null,
        turnDeadline: deps.now + TURN_TIMEOUT_MS,
      },
      events,
    };
  }

  return { state: { ...state, players }, events };
}

/**
 * A paused game is waiting for one specific player, so that player simply
 * acting is enough to restart it. Without this a present-but-idle player
 * would pause the table and then have no way back in, since no reconnection
 * event is ever going to arrive for a socket that never dropped.
 */
function wakeUp(state: GameState, userId: string, deps: ApplyDeps): ApplyResult {
  if (state.phase !== 'paused' || state.pausedFor !== userId) {
    return { state, events: [] };
  }
  const players = state.players.map((p) =>
    p.userId === userId ? { ...p, connected: true, missedTurns: 0 } : p,
  );
  return {
    state: {
      ...state,
      players,
      phase: 'awaiting_roll',
      pausedFor: null,
      pendingRoll: null,
      turnDeadline: deps.now + TURN_TIMEOUT_MS,
    },
    events: [{ type: 'game_resumed', userId }],
  };
}

function applyRoll(state: GameState, deps: ApplyDeps): ApplyResult {
  const player = state.players[state.turnIndex]!;
  const { value, proof } = deps.dice.roll();
  const events: GameEvent[] = [
    { type: 'dice_rolled', userId: player.userId, value, rollProof: proof },
  ];

  const sixes = value === 6 ? state.consecutiveSixes + 1 : 0;

  // Three sixes in a row forfeits the turn - this is what stops a player
  // farming extra turns indefinitely.
  if (sixes >= 3) {
    const passed = passTurn(
      { ...state, consecutiveSixes: 0, pendingRoll: null },
      deps,
      'three_sixes',
    );
    return { state: passed.state, events: [...events, ...passed.events] };
  }

  const moves = legalMoves({ ...state, consecutiveSixes: sixes }, value);
  if (moves.length === 0) {
    const passed = passTurn(
      { ...state, consecutiveSixes: 0, pendingRoll: null },
      deps,
      'no_legal_move',
    );
    return { state: passed.state, events: [...events, ...passed.events] };
  }

  return {
    state: {
      ...state,
      phase: 'awaiting_move',
      pendingRoll: value,
      consecutiveSixes: sixes,
      turnDeadline: deps.now + TURN_TIMEOUT_MS,
    },
    events,
  };
}

function applyMove(state: GameState, tokenId: number, deps: ApplyDeps): ApplyResult {
  const roll = state.pendingRoll;
  if (roll === null) throw new CommandRejected('wrong_phase');

  const move = legalMoves(state, roll).find((m) => m.tokenId === tokenId);
  if (!move) throw new CommandRejected('illegal_move');

  const mover = state.players[state.turnIndex]!;
  const events: GameEvent[] = [
    { type: 'token_moved', userId: mover.userId, tokenId, from: move.from, to: move.to },
  ];

  // 1. Advance the token, sending any captured opponents back to their yard.
  let players = state.players.map((p) => {
    if (p.userId === mover.userId) {
      return {
        ...p,
        tokens: p.tokens.map((t) => (t.id === tokenId ? { ...t, progress: move.to } : t)),
      };
    }
    const hits = move.captures.filter((c) => c.userId === p.userId);
    if (hits.length === 0) return p;
    return {
      ...p,
      tokens: p.tokens.map((t) =>
        hits.some((h) => h.tokenId === t.id) ? { ...t, progress: null } : t,
      ),
    };
  });

  for (const capture of move.captures) {
    events.push({
      type: 'token_captured',
      byUserId: mover.userId,
      victimUserId: capture.userId,
      tokenId: capture.tokenId,
    });
  }
  if (move.reachesHome) {
    events.push({ type: 'token_home', userId: mover.userId, tokenId });
  }

  // 2. Award finishing ranks.
  const winnerOrder = [...state.winnerOrder];
  players = players.map((p) => {
    if (p.finishedRank === null && !p.abandoned && isFinished(p)) {
      winnerOrder.push(p.userId);
      const rank = winnerOrder.length;
      events.push({ type: 'player_finished', userId: p.userId, rank });
      return { ...p, finishedRank: rank };
    }
    return p;
  });

  const next: GameState = { ...state, players, winnerOrder, pendingRoll: null };

  // 3. The game ends once only one player is still going.
  const remaining = next.players.filter((p) => p.finishedRank === null && !p.abandoned);
  if (remaining.length <= 1) {
    const finalOrder = closeOut(next, winnerOrder, remaining);
    events.push({ type: 'game_finished', winnerOrder: finalOrder });
    return {
      state: { ...next, phase: 'finished', winnerOrder: finalOrder, consecutiveSixes: 0 },
      events,
    };
  }

  // 4. Decide whether the mover rolls again. Look at the *updated* record -
  // a player who just sent their last token home is out and must not roll.
  const moverAfter = next.players.find((p) => p.userId === mover.userId)!;
  const extraReason = extraTurnReason(roll, move);
  if (extraReason && moverAfter.finishedRank === null) {
    events.push({ type: 'extra_turn', userId: mover.userId, reason: extraReason });
    return {
      state: {
        ...next,
        phase: 'awaiting_roll',
        consecutiveSixes: roll === 6 ? next.consecutiveSixes : 0,
        turnDeadline: deps.now + TURN_TIMEOUT_MS,
      },
      events,
    };
  }

  const passed = passTurn({ ...next, consecutiveSixes: 0 }, deps, 'move_complete');
  return { state: passed.state, events: [...events, ...passed.events] };
}

/** Ranks everyone who has not already been ranked: racers first, dropouts last. */
function closeOut(
  state: GameState,
  winnerOrder: readonly string[],
  remaining: readonly Player[],
): string[] {
  const order = [
    ...winnerOrder,
    ...remaining.map((p) => p.userId),
    ...state.players.filter((p) => p.abandoned).map((p) => p.userId),
  ];
  return [...new Set(order)];
}

function extraTurnReason(
  roll: number,
  move: LegalMove,
): 'rolled_six' | 'capture' | 'token_home' | null {
  if (move.captures.length > 0) return 'capture';
  if (move.reachesHome) return 'token_home';
  if (roll === 6) return 'rolled_six';
  return null;
}

function passTurn(
  state: GameState,
  deps: ApplyDeps,
  reason: 'no_legal_move' | 'move_complete' | 'three_sixes' | 'timeout',
): ApplyResult {
  const from = state.players[state.turnIndex]!;
  let index = state.turnIndex;
  for (let step = 0; step < state.players.length; step += 1) {
    index = (index + 1) % state.players.length;
    const candidate = state.players[index]!;
    // A dropped player is skipped exactly like a finished one.
    if (candidate.finishedRank === null && !candidate.abandoned) break;
  }
  const to = state.players[index]!;

  return {
    state: {
      ...state,
      phase: 'awaiting_roll',
      turnIndex: index,
      pendingRoll: null,
      pausedFor: null,
      turnDeadline: deps.now + TURN_TIMEOUT_MS,
    },
    events: [{ type: 'turn_passed', fromUserId: from.userId, toUserId: to.userId, reason }],
  };
}

/**
 * Fired by the turn timer, never by a client.
 *
 * The distinction that matters is whether the player actually had a decision
 * to make. A turn with one legal move, or none, is forced - playing it decides
 * nothing on their behalf and costs them nothing, so it is not counted
 * against them however long they are away. A turn with several tokens to
 * choose between is a real decision, and after
 * MISSED_TURNS_BEFORE_PAUSE of those go unmade the table stops and waits
 * rather than letting a bot play out somebody's match.
 */
function applyAutoPlay(state: GameState, deps: ApplyDeps): ApplyResult {
  if (state.phase === 'finished') throw new CommandRejected('game_finished');
  if (state.phase === 'paused') throw new CommandRejected('game_paused');
  const player = state.players[state.turnIndex]!;

  if (player.missedTurns >= MISSED_TURNS_BEFORE_PAUSE) {
    const resumeBy = deps.now + PAUSE_GRACE_MS;
    return {
      state: {
        ...state,
        phase: 'paused',
        pausedFor: player.userId,
        pendingRoll: null,
        consecutiveSixes: 0,
        turnDeadline: resumeBy,
      },
      events: [{ type: 'game_paused', userId: player.userId, resumeBy }],
    };
  }

  const events: GameEvent[] = [];
  let working = state;
  let hadChoice = false;

  if (working.phase === 'awaiting_roll') {
    const rolled = applyRoll(working, deps);
    working = rolled.state;
    events.push(...rolled.events);
  }

  if (working.phase === 'awaiting_move' && working.pendingRoll !== null) {
    const moves = legalMoves(working, working.pendingRoll);
    hadChoice = moves.length > 1;
    const best = pickBestMove(moves);
    if (best) {
      const moved = applyMove(working, best.tokenId, deps);
      working = moved.state;
      events.push(...moved.events);
    }
  }

  const players = hadChoice
    ? working.players.map((p) =>
        p.userId === player.userId ? { ...p, missedTurns: p.missedTurns + 1 } : p,
      )
    : working.players;
  return { state: { ...working, players }, events };
}

/**
 * Removes a player for good. Their tokens leave the board entirely: parking
 * them where they stood would turn a missing player into permanent obstacles,
 * and leaving them on safe squares would distort the remaining race badly.
 */
function applyAbandon(
  state: GameState,
  issuerUserId: string,
  targetUserId: string,
  deps: ApplyDeps,
): ApplyResult {
  if (state.phase === 'finished') throw new CommandRejected('game_finished');
  const index = state.players.findIndex((p) => p.userId === targetUserId);
  if (index === -1) throw new CommandRejected('unknown_player');
  if (state.players[index]!.abandoned) return { state, events: [] };

  // Two ways out, and no others. You may always remove yourself - walking
  // away is your own decision and takes effect immediately. Removing someone
  // else is only allowed while the table is already waiting for that exact
  // player. The client only offers the button during a pause, but a client is
  // not a security boundary: without this check any player could knock an
  // opponent out mid-game by emitting the command directly.
  const leavingVoluntarily = issuerUserId === targetUserId;
  const waitingForThem = state.phase === 'paused' && state.pausedFor === targetUserId;
  if (!leavingVoluntarily && !waitingForThem) {
    throw new CommandRejected('wrong_phase');
  }

  const players = state.players.map((p, i) =>
    i === index
      ? {
          ...p,
          abandoned: true,
          connected: false,
          tokens: p.tokens.map((t) => ({ ...t, progress: null })),
        }
      : p,
  );

  const reason = leavingVoluntarily ? 'left' : state.phase === 'paused' ? 'timed_out' : 'removed';
  const events: GameEvent[] = [
    { type: 'player_abandoned', userId: targetUserId, reason },
  ];

  const next: GameState = { ...state, players, pausedFor: null, pendingRoll: null };
  const remaining = next.players.filter((p) => p.finishedRank === null && !p.abandoned);

  // With one racer left there is no game. The survivor takes the win, and the
  // dropout is ranked last rather than being erased from the record.
  if (remaining.length <= 1) {
    const finalOrder = closeOut(next, next.winnerOrder, remaining);
    events.push({ type: 'game_finished', winnerOrder: finalOrder });
    return {
      state: { ...next, phase: 'finished', winnerOrder: finalOrder, consecutiveSixes: 0 },
      events,
    };
  }

  // Only disturb the turn order if the game was actually waiting on them.
  if (state.phase === 'paused' || state.turnIndex === index) {
    const passed = passTurn({ ...next, consecutiveSixes: 0 }, deps, 'timeout');
    return { state: passed.state, events: [...events, ...passed.events] };
  }
  return {
    state: { ...next, phase: state.phase, pendingRoll: state.pendingRoll },
    events,
  };
}

function pickBestMove(moves: readonly LegalMove[]): LegalMove | undefined {
  if (moves.length === 0) return undefined;
  const score = (m: LegalMove) => (m.captures.length > 0 ? 3 : m.reachesHome ? 2 : 1);
  return [...moves].sort((a, b) => score(b) - score(a) || b.to - a.to)[0];
}

/** Convenience for the turn-timer service. */
export function isTurnExpired(state: GameState, now: number): boolean {
  return (
    state.phase !== 'finished' && state.phase !== 'paused' && now >= state.turnDeadline
  );
}

/** True once a paused game has waited long enough to drop the missing player. */
export function isPauseExpired(state: GameState, now: number): boolean {
  return state.phase === 'paused' && now >= state.turnDeadline;
}