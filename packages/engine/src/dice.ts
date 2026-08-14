import { createHash, randomBytes } from 'node:crypto';
import type { RollProof } from '@ludo/shared';

/**
 * The engine never calls `Math.random` directly — it asks a `DiceRoller`.
 * That single indirection is what makes every rule in this package testable
 * with a scripted sequence of rolls, and it is also what lets us swap in a
 * provably-fair implementation without touching the rules.
 */
export interface DiceRoller {
  roll(): { value: number; proof: RollProof };
}

/**
 * Commit–reveal dice.
 *
 * The server commits to `sha256(serverSeed)` before the first roll. Every
 * roll is `sha256(serverSeed:nonce)` reduced to 1..6. When the game ends the
 * seed is revealed, so any player can recompute the entire sequence and prove
 * the server did not re-roll after seeing the board.
 *
 * Rejection sampling is used rather than a naive `% 6` so the distribution is
 * exactly uniform.
 */
export class ProvableDiceRoller implements DiceRoller {
  readonly serverSeedHash: string;
  #nonce: number;

  /**
   * `startNonce` lets a stateless service resume the sequence. Nonces are
   * allocated from Redis before each command, so a retried command burns a
   * nonce — harmless, because every emitted roll carries the nonce that
   * produced it, and verification checks that pairing rather than the count.
   */
  constructor(
    private readonly serverSeed: string = randomBytes(32).toString('hex'),
    startNonce = 0,
  ) {
    this.serverSeedHash = createHash('sha256').update(this.serverSeed).digest('hex');
    this.#nonce = startNonce;
  }

  /** Only ever called once the game is over. */
  reveal(): string {
    return this.serverSeed;
  }

  roll(): { value: number; proof: RollProof } {
    const nonce = this.#nonce++;
    return {
      value: ProvableDiceRoller.derive(this.serverSeed, nonce),
      proof: { nonce, serverSeedHash: this.serverSeedHash },
    };
  }

  /** Public so clients can independently verify a revealed game. */
  static derive(serverSeed: string, nonce: number): number {
    let round = 0;
    for (;;) {
      const digest = createHash('sha256')
        .update(`${serverSeed}:${nonce}:${round}`)
        .digest();
      for (const byte of digest) {
        // 252 == 6 * 42; bytes above that would bias the distribution.
        if (byte < 252) return (byte % 6) + 1;
      }
      round += 1;
    }
  }
}

/** Test double: replays a fixed sequence, cycling if it runs out. */
export class ScriptedDiceRoller implements DiceRoller {
  #index = 0;

  constructor(private readonly sequence: readonly number[]) {
    if (sequence.length === 0) throw new Error('sequence must not be empty');
  }

  roll(): { value: number; proof: RollProof } {
    const nonce = this.#index;
    const value = this.sequence[this.#index % this.sequence.length]!;
    this.#index += 1;
    return { value, proof: { nonce, serverSeedHash: 'scripted' } };
  }
}
