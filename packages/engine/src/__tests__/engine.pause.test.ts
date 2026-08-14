import { describe, expect, it } from 'vitest';
import {
  MISSED_TURNS_BEFORE_PAUSE,
  PAUSE_GRACE_MS,
  defaultColours,
  type GameCommand,
  type GameState,
  type Player,
} from '@ludo/shared';
import { applyCommand, createGame, isPauseExpired, isTurnExpired } from '../engine.js';
import { ScriptedDiceRoller } from '../dice.js';

const NOW = 1_700_000_000_000;
const deps = (now = NOW) => ({ dice: new ScriptedDiceRoller([6, 3, 5, 2, 4, 1]), now });

let counter = 0;
function cmd(partial: Omit<GameCommand, 'commandId' | 'issuedAt'>): GameCommand {
  return { ...partial, commandId: `test-${++counter}`, issuedAt: NOW } as GameCommand;
}

function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${i}`,
    displayName: `P${i}`,
  }));
}

/** Rewrites one player, so a scenario can start from an arbitrary position. */
function withPlayer(state: GameState, index: number, patch: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === index ? { ...p, ...patch } : p)) };
}

describe('seating', () => {
  it('places two players diagonally opposite rather than side by side', () => {
    expect(defaultColours(2)).toEqual(['red', 'yellow']);
    const game = createGame('g', 'r', seats(2), NOW);
    expect(game.players.map((p) => p.colour)).toEqual(['red', 'yellow']);
  });

  it('honours colours chosen in the lobby', () => {
    const game = createGame(
      'g',
      'r',
      [
        { userId: 'a', displayName: 'A', colour: 'blue' },
        { userId: 'b', displayName: 'B', colour: 'green' },
      ],
      NOW,
    );
    expect(game.players.map((p) => p.colour)).toEqual(['blue', 'green']);
  });

  it('never lets two players share a colour', () => {
    const game = createGame(
      'g',
      'r',
      [
        { userId: 'a', displayName: 'A', colour: 'red' },
        { userId: 'b', displayName: 'B', colour: 'red' },
        { userId: 'c', displayName: 'C', colour: 'red' },
      ],
      NOW,
    );
    expect(new Set(game.players.map((p) => p.colour)).size).toBe(3);
  });
});

describe('covering for an absent player', () => {
  it('plays their turn while they are within the grace allowance', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    const state = withPlayer(base, 0, { connected: false, missedTurns: 0 });
    const { state: after, events } = applyCommand(state, cmd({ type: 'auto_play', userId: 'u0' }), deps());

    expect(events.some((e) => e.type === 'dice_rolled')).toBe(true);
    expect(after.phase).not.toBe('paused');
    expect(after.players[0]!.missedTurns).toBe(1);
  });

  it('pauses once they have missed the allowance', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    const state = withPlayer(base, 0, {
      connected: false,
      missedTurns: MISSED_TURNS_BEFORE_PAUSE,
    });
    const { state: after, events } = applyCommand(state, cmd({ type: 'auto_play', userId: 'u0' }), deps());

    expect(after.phase).toBe('paused');
    expect(after.pausedFor).toBe('u0');
    expect(after.turnDeadline).toBe(NOW + PAUSE_GRACE_MS);
    expect(events.some((e) => e.type === 'game_paused')).toBe(true);
    // Nothing was played on their behalf this time.
    expect(events.some((e) => e.type === 'dice_rolled')).toBe(false);
  });

  it('stops for a player who is present but never chooses', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    // Being connected is no excuse: if three real decisions go unmade, the
    // table stops for them exactly as it would for someone who vanished.
    const state = withPlayer(base, 0, {
      connected: true,
      missedTurns: MISSED_TURNS_BEFORE_PAUSE,
    });
    const { state: after } = applyCommand(state, cmd({ type: 'auto_play', userId: 'u0' }), deps());
    expect(after.phase).toBe('paused');
  });

  it('does not count a forced move against them', () => {
    // One token out of the yard and a roll of 3: exactly one legal move, so
    // nothing is being decided on the player's behalf.
    const base = createGame('g', 'r', seats(3), NOW);
    const state = withPlayer(base, 0, {
      connected: false,
      tokens: [
        { id: 0, progress: 4 },
        { id: 1, progress: null },
        { id: 2, progress: null },
        { id: 3, progress: null },
      ],
    });
    const { state: after } = applyCommand(state, cmd({ type: 'auto_play', userId: 'u0' }), {
      dice: new ScriptedDiceRoller([3]),
      now: NOW,
    });
    expect(after.players[0]!.missedTurns).toBe(0);
  });

  it('counts a turn where several tokens could have moved', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    const state = withPlayer(base, 0, {
      connected: false,
      tokens: [
        { id: 0, progress: 4 },
        { id: 1, progress: 9 },
        { id: 2, progress: 20 },
        { id: 3, progress: null },
      ],
    });
    const { state: after } = applyCommand(state, cmd({ type: 'auto_play', userId: 'u0' }), {
      dice: new ScriptedDiceRoller([3]),
      now: NOW,
    });
    expect(after.players[0]!.missedTurns).toBe(1);
  });
});

describe('a paused game', () => {
  function pausedGame(): GameState {
    const base = createGame('g', 'r', seats(3), NOW);
    const stalled = withPlayer(base, 0, {
      connected: false,
      missedTurns: MISSED_TURNS_BEFORE_PAUSE,
    });
    return applyCommand(stalled, cmd({ type: 'auto_play', userId: 'u0' }), deps()).state;
  }

  it('refuses rolls from everyone except the player being waited on', () => {
    const state = pausedGame();
    expect(() => applyCommand(state, cmd({ type: 'roll_dice', userId: 'u1' }), deps())).toThrow(
      /not_your_turn|game_paused/,
    );
  });

  it('resumes as soon as the awaited player simply rolls', () => {
    const state = pausedGame();
    const { state: after, events } = applyCommand(
      state,
      cmd({ type: 'roll_dice', userId: 'u0' }),
      deps(NOW + 5_000),
    );
    expect(after.pausedFor).toBeNull();
    expect(after.players[0]!.missedTurns).toBe(0);
    expect(events.some((e) => e.type === 'game_resumed')).toBe(true);
    expect(events.some((e) => e.type === 'dice_rolled')).toBe(true);
  });

  it('resumes when the missing player comes back, forgiving their misses', () => {
    const state = pausedGame();
    const { state: after, events } = applyCommand(
      state,
      cmd({ type: 'set_connection', userId: 'u0', connected: true }),
      deps(NOW + 5_000),
    );

    expect(after.phase).toBe('awaiting_roll');
    expect(after.pausedFor).toBeNull();
    expect(after.turnIndex).toBe(0);
    expect(after.players[0]!.missedTurns).toBe(0);
    expect(events.some((e) => e.type === 'game_resumed')).toBe(true);
  });

  it('is not treated as an expired turn, but does expire on its own clock', () => {
    const state = pausedGame();
    const later = NOW + PAUSE_GRACE_MS + 1;
    expect(isTurnExpired(state, later)).toBe(false);
    expect(isPauseExpired(state, later)).toBe(true);
    expect(isPauseExpired(state, NOW + 1_000)).toBe(false);
  });
});

describe('dropping a player', () => {
  /** Puts the table into the pause that dropping someone requires. */
  function stalled(players: number, index: number, patch: Partial<Player> = {}): GameState {
    const base = createGame('g', 'r', seats(players), NOW);
    const turned = { ...base, turnIndex: index };
    const gone = withPlayer(turned, index, {
      connected: false,
      missedTurns: MISSED_TURNS_BEFORE_PAUSE,
      ...patch,
    });
    return applyCommand(gone, cmd({ type: 'auto_play', userId: `u${index}` }), deps()).state;
  }

  it('refuses to drop anyone the table is not waiting for', () => {
    const state = stalled(3, 0);
    expect(() =>
      applyCommand(
        state,
        cmd({ type: 'abandon_player', userId: 'u1', targetUserId: 'u2' }),
        deps(),
      ),
    ).toThrow(/wrong_phase/);
  });

  it('lets a player remove themselves at any time', () => {
    // Walking away is your own decision, so it needs no pause and nobody
    // else's agreement - and it is final.
    const base = createGame('g', 'r', seats(3), NOW);
    const { state: after, events } = applyCommand(
      base,
      cmd({ type: 'abandon_player', userId: 'u1', targetUserId: 'u1' }),
      deps(),
    );
    expect(after.players[1]!.abandoned).toBe(true);
    const left = events.find((e) => e.type === 'player_abandoned');
    expect(left && left.type === 'player_abandoned' && left.reason).toBe('left');
  });

  it('does not disturb the turn when someone leaves out of turn', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    const { state: after } = applyCommand(
      base,
      cmd({ type: 'abandon_player', userId: 'u2', targetUserId: 'u2' }),
      deps(),
    );
    expect(after.turnIndex).toBe(0);
    expect(after.phase).toBe('awaiting_roll');
  });

  it('moves play on when the player whose turn it is leaves', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    const { state: after } = applyCommand(
      base,
      cmd({ type: 'abandon_player', userId: 'u0', targetUserId: 'u0' }),
      deps(),
    );
    expect(after.players[after.turnIndex]!.abandoned).toBe(false);
  });

  it('refuses to drop anyone while play is running', () => {
    const base = createGame('g', 'r', seats(3), NOW);
    expect(() =>
      applyCommand(
        base,
        cmd({ type: 'abandon_player', userId: 'u1', targetUserId: 'u2' }),
        deps(),
      ),
    ).toThrow(/wrong_phase/);
  });

  it('takes their tokens off the board and skips their turn', () => {
    const moved = stalled(3, 0, {
      tokens: [
        { id: 0, progress: 10 },
        { id: 1, progress: 20 },
        { id: 2, progress: null },
        { id: 3, progress: null },
      ],
    });

    const { state: after, events } = applyCommand(
      moved,
      cmd({ type: 'abandon_player', userId: 'system', targetUserId: 'u0' }),
      deps(),
    );

    expect(after.players[0]!.abandoned).toBe(true);
    expect(after.players[0]!.tokens.every((t) => t.progress === null)).toBe(true);
    expect(events.some((e) => e.type === 'player_abandoned')).toBe(true);
    // Turn moved on to someone still racing.
    expect(after.players[after.turnIndex]!.abandoned).toBe(false);
    expect(after.turnIndex).not.toBe(0);
  });

  it('ends a two-player game, survivor first and dropout last', () => {
    const base = stalled(2, 0);
    const { state: after, events } = applyCommand(
      base,
      cmd({ type: 'abandon_player', userId: 'system', targetUserId: 'u0' }),
      deps(),
    );

    expect(after.phase).toBe('finished');
    expect(after.winnerOrder).toEqual(['u1', 'u0']);
    expect(events.some((e) => e.type === 'game_finished')).toBe(true);
  });

  it('is a no-op the second time, so a retried timer cannot double-drop', () => {
    const base = stalled(3, 0);
    const once = applyCommand(
      base,
      cmd({ type: 'abandon_player', userId: 'system', targetUserId: 'u0' }),
      deps(),
    ).state;
    const twice = applyCommand(
      once,
      cmd({ type: 'abandon_player', userId: 'system', targetUserId: 'u0' }),
      deps(),
    );
    expect(twice.events).toHaveLength(0);
    expect(twice.state.version).toBe(once.version);
  });

  it('leaves no captureable trace of a dropped player', () => {
    const onBoard = stalled(3, 1, {
      tokens: [
        { id: 0, progress: 5 },
        { id: 1, progress: null },
        { id: 2, progress: null },
        { id: 3, progress: null },
      ],
    });
    const after = applyCommand(
      onBoard,
      cmd({ type: 'abandon_player', userId: 'system', targetUserId: 'u1' }),
      deps(),
    ).state;
    expect(after.players[1]!.tokens.every((t) => t.progress === null)).toBe(true);
  });
});