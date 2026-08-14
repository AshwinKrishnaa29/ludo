import { describe, expect, it } from 'vitest';
import {
  CommandRejected,
  HOME_PROGRESS,
  type GameCommand,
  type GameState,
  type PlayerColour,
} from '@ludo/shared';
import { ProvableDiceRoller, ScriptedDiceRoller } from '../dice.js';
import { TURN_TIMEOUT_MS, applyCommand, createGame, legalMoves } from '../engine.js';

const SEATS = [
  { userId: 'u-red', displayName: 'Red' },
  { userId: 'u-green', displayName: 'Green' },
  { userId: 'u-yellow', displayName: 'Yellow' },
  { userId: 'u-blue', displayName: 'Blue' },
];

const NOW = 1_700_000_000_000;

let counter = 0;
function cmd<T extends GameCommand['type']>(
  type: T,
  userId: string,
  extra: Record<string, unknown> = {},
): GameCommand {
  return { type, userId, commandId: `c-${counter++}`, issuedAt: NOW, ...extra } as GameCommand;
}

function deps(sequence: number[]) {
  return { dice: new ScriptedDiceRoller(sequence), now: NOW };
}

/** Place specific tokens on the board without playing the moves out. */
function withTokens(
  state: GameState,
  placements: Partial<Record<PlayerColour, (number | null)[]>>,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => {
      const positions = placements[p.colour];
      if (!positions) return p;
      return {
        ...p,
        tokens: p.tokens.map((t, i) => ({ ...t, progress: positions[i] ?? t.progress ?? null })),
      };
    }),
  };
}

describe('createGame', () => {
  it('seats players in colour order with four tokens each in the yard', () => {
    const game = createGame('g1', 'r1', SEATS, NOW);
    expect(game.players.map((p) => p.colour)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(game.players.every((p) => p.tokens.every((t) => t.progress === null))).toBe(true);
    expect(game.phase).toBe('awaiting_roll');
    expect(game.turnDeadline).toBe(NOW + TURN_TIMEOUT_MS);
  });

  it('refuses fewer than two or more than four players', () => {
    expect(() => createGame('g', 'r', SEATS.slice(0, 1), NOW)).toThrow();
    expect(() => createGame('g', 'r', [...SEATS, SEATS[0]!], NOW)).toThrow();
  });
});

describe('leaving the yard', () => {
  it('requires a six', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    expect(legalMoves(game, 3)).toHaveLength(0);
    expect(legalMoves(game, 6)).toHaveLength(4);
  });

  it('passes the turn when nothing can move', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const { state, events } = applyCommand(game, cmd('roll_dice', 'u-red'), deps([2]));
    expect(state.turnIndex).toBe(1);
    expect(state.phase).toBe('awaiting_roll');
    expect(events.map((e) => e.type)).toEqual(['dice_rolled', 'turn_passed']);
  });
});

describe('extra turns', () => {
  it('is granted for a six', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const rolled = applyCommand(game, cmd('roll_dice', 'u-red'), deps([6]));
    const moved = applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 0 }), deps([1]));
    expect(moved.state.turnIndex).toBe(0);
    expect(moved.state.phase).toBe('awaiting_roll');
    expect(moved.events.some((e) => e.type === 'extra_turn')).toBe(true);
  });

  it('is forfeited after three consecutive sixes', () => {
    let state = createGame('g', 'r', SEATS, NOW);
    const d = deps([6, 6, 6]);

    state = applyCommand(state, cmd('roll_dice', 'u-red'), d).state;
    state = applyCommand(state, cmd('move_token', 'u-red', { tokenId: 0 }), d).state;
    expect(state.consecutiveSixes).toBe(1);

    state = applyCommand(state, cmd('roll_dice', 'u-red'), d).state;
    state = applyCommand(state, cmd('move_token', 'u-red', { tokenId: 1 }), d).state;
    expect(state.consecutiveSixes).toBe(2);

    const third = applyCommand(state, cmd('roll_dice', 'u-red'), d);
    expect(third.state.turnIndex).toBe(1);
    expect(third.state.consecutiveSixes).toBe(0);
    expect(
      third.events.some((e) => e.type === 'turn_passed' && e.reason === 'three_sixes'),
    ).toBe(true);
  });
});

describe('capturing', () => {
  it('sends the victim back to the yard and grants an extra turn', () => {
    // Red progress 5 == absolute square 5. Green progress 44 == absolute 5.
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [2, null, null, null],
      green: [44, null, null, null],
    });
    const rolled = applyCommand(base, cmd('roll_dice', 'u-red'), deps([3]));
    const moved = applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 0 }), deps([3]));

    const green = moved.state.players.find((p) => p.colour === 'green')!;
    expect(green.tokens[0]!.progress).toBeNull();
    expect(moved.events.some((e) => e.type === 'token_captured')).toBe(true);
    expect(moved.state.turnIndex).toBe(0);
  });

  it('does not capture on a safe square', () => {
    // Absolute square 8 is a star. Green progress 47 == absolute 8.
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [5, null, null, null],
      green: [47, null, null, null],
    });
    const rolled = applyCommand(base, cmd('roll_dice', 'u-red'), deps([3]));
    const moved = applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 0 }), deps([3]));

    const green = moved.state.players.find((p) => p.colour === 'green')!;
    expect(green.tokens[0]!.progress).toBe(47);
    expect(moved.events.some((e) => e.type === 'token_captured')).toBe(false);
    expect(moved.state.turnIndex).toBe(1);
  });

  it('never captures inside a home column', () => {
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [53, null, null, null],
      green: [53, null, null, null],
    });
    const moves = legalMoves(base, 2);
    expect(moves[0]!.captures).toHaveLength(0);
  });
});

describe('reaching home', () => {
  it('requires an exact roll', () => {
    // All four tokens are out, so yard entries cannot confound the result.
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [52, 20, 21, 22],
    });

    // 52 + 6 == 58 overshoots the centre, so token 0 has no move.
    expect(legalMoves(base, 6).find((m) => m.tokenId === 0)).toBeUndefined();

    const exact = legalMoves(base, 5).find((m) => m.tokenId === 0);
    expect(exact).toBeDefined();
    expect(exact!.to).toBe(HOME_PROGRESS);
    expect(exact!.reachesHome).toBe(true);
  });

  it('grants an extra turn', () => {
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [52, 10, null, null],
    });
    const rolled = applyCommand(base, cmd('roll_dice', 'u-red'), deps([5]));
    const moved = applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 0 }), deps([5]));
    expect(moved.events.some((e) => e.type === 'token_home')).toBe(true);
    expect(moved.state.turnIndex).toBe(0);
  });
});

describe('finishing', () => {
  it('ranks a player and skips them afterwards', () => {
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [HOME_PROGRESS, HOME_PROGRESS, HOME_PROGRESS, 52],
      green: [1, null, null, null],
    });
    const rolled = applyCommand(base, cmd('roll_dice', 'u-red'), deps([5]));
    const moved = applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 3 }), deps([5]));

    const red = moved.state.players.find((p) => p.colour === 'red')!;
    expect(red.finishedRank).toBe(1);
    expect(moved.events.some((e) => e.type === 'player_finished')).toBe(true);
    // Red is out, so play moves on rather than granting the home extra turn.
    expect(moved.state.turnIndex).toBe(1);
  });

  it('ends the game when only one player is left', () => {
    let state = withTokens(createGame('g', 'r', SEATS.slice(0, 2), NOW), {
      red: [HOME_PROGRESS, HOME_PROGRESS, HOME_PROGRESS, 52],
      green: [3, null, null, null],
    });
    state = applyCommand(state, cmd('roll_dice', 'u-red'), deps([5])).state;
    const moved = applyCommand(state, cmd('move_token', 'u-red', { tokenId: 3 }), deps([5]));

    expect(moved.state.phase).toBe('finished');
    expect(moved.state.winnerOrder).toEqual(['u-red', 'u-green']);
    expect(moved.events.some((e) => e.type === 'game_finished')).toBe(true);
  });
});

describe('command validation', () => {
  it('rejects a move from the wrong player', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    expect(() => applyCommand(game, cmd('roll_dice', 'u-green'), deps([6]))).toThrow(
      CommandRejected,
    );
  });

  it('rejects a move before a roll', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    expect(() =>
      applyCommand(game, cmd('move_token', 'u-red', { tokenId: 0 }), deps([6])),
    ).toThrow(CommandRejected);
  });

  it('rejects moving a token that has no legal move', () => {
    const base = withTokens(createGame('g', 'r', SEATS, NOW), { red: [10, null, null, null] });
    const rolled = applyCommand(base, cmd('roll_dice', 'u-red'), deps([3]));
    expect(() =>
      applyCommand(rolled.state, cmd('move_token', 'u-red', { tokenId: 1 }), deps([3])),
    ).toThrow(CommandRejected);
  });
});

describe('idempotency', () => {
  it('treats a replayed command as a no-op', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const roll = cmd('roll_dice', 'u-red');
    const first = applyCommand(game, roll, deps([6]));
    const replay = applyCommand(first.state, roll, deps([1]));

    expect(replay.state).toBe(first.state);
    expect(replay.events).toHaveLength(0);
    expect(replay.state.pendingRoll).toBe(6);
  });

  it('increments version on every applied command', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const rolled = applyCommand(game, cmd('roll_dice', 'u-red'), deps([6]));
    expect(rolled.state.version).toBe(game.version + 1);
  });
});

describe('auto play', () => {
  it('advances a stalled turn and records the miss', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const result = applyCommand(game, cmd('auto_play', 'u-red'), deps([6]));
    const red = result.state.players.find((p) => p.colour === 'red')!;

    expect(red.missedTurns).toBe(1);
    expect(red.tokens.some((t) => t.progress === 0)).toBe(true);
  });

  it('prefers a capture over a plain move', () => {
    const base = withTokens(createGame('g', 'r', SEATS, NOW), {
      red: [2, 30, null, null],
      green: [44, null, null, null],
    });
    const result = applyCommand(base, cmd('auto_play', 'u-red'), deps([3]));
    expect(result.events.some((e) => e.type === 'token_captured')).toBe(true);
  });
});

describe('connection tracking', () => {
  it('flags a player as disconnected without disturbing the turn', () => {
    const game = createGame('g', 'r', SEATS, NOW);
    const result = applyCommand(
      game,
      cmd('set_connection', 'u-green', { connected: false }),
      deps([1]),
    );
    expect(result.state.players[1]!.connected).toBe(false);
    expect(result.state.turnIndex).toBe(0);
  });
});

describe('provable dice', () => {
  it('reproduces the same sequence from a revealed seed', () => {
    const roller = new ProvableDiceRoller('seed-under-test');
    const rolls = [roller.roll(), roller.roll(), roller.roll()];
    const seed = roller.reveal();

    for (const { value, proof } of rolls) {
      expect(ProvableDiceRoller.derive(seed, proof.nonce)).toBe(value);
    }
  });

  it('produces a roughly uniform distribution', () => {
    const roller = new ProvableDiceRoller('distribution-seed');
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i += 1) {
      const { value } = roller.roll();
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const face of [1, 2, 3, 4, 5, 6]) {
      // Expect 10,000 each; allow a generous 5% band.
      expect(counts.get(face)!).toBeGreaterThan(9_500);
      expect(counts.get(face)!).toBeLessThan(10_500);
    }
  });
});
