import { describe, expect, it } from 'vitest';
import { deriveRoll, sha256Hex, verifyGame } from '../verify';

describe('sha256Hex', () => {
  it('matches the published vector for "abc"', () => {
    // If this drifts, every honest game would fail verification and look
    // like the server had cheated.
    return expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('deriveRoll', () => {
  it('always produces a face between one and six', async () => {
    for (let nonce = 0; nonce < 60; nonce += 1) {
      const value = await deriveRoll('seed-under-test', nonce);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });

  it('is deterministic for the same seed and nonce', async () => {
    const a = await deriveRoll('seed-under-test', 7);
    const b = await deriveRoll('seed-under-test', 7);
    expect(a).toBe(b);
  });

  it('gives a different sequence for a different seed', async () => {
    const one = await Promise.all([0, 1, 2, 3, 4].map((n) => deriveRoll('seed-a', n)));
    const two = await Promise.all([0, 1, 2, 3, 4].map((n) => deriveRoll('seed-b', n)));
    expect(one).not.toEqual(two);
  });
});

describe('verifyGame', () => {
  it('passes when the rolls came from the sealed seed', async () => {
    const seed = 'a-known-seed';
    const hash = await sha256Hex(seed);
    const observed = await Promise.all(
      [0, 1, 2, 3].map(async (nonce) => ({
        nonce,
        value: await deriveRoll(seed, nonce),
        userId: 'u1',
      })),
    );
    const result = await verifyGame(seed, hash, observed);
    expect(result.hashMatches).toBe(true);
    expect(result.allOk).toBe(true);
  });

  it('fails when a roll was tampered with', async () => {
    const seed = 'a-known-seed';
    const hash = await sha256Hex(seed);
    const real = await deriveRoll(seed, 0);
    const result = await verifyGame(seed, hash, [
      { nonce: 0, value: ((real % 6) + 1), userId: 'u1' },
    ]);
    expect(result.allOk).toBe(false);
  });

  it('fails when the revealed seed is not the one that was sealed', async () => {
    const result = await verifyGame('some-other-seed', await sha256Hex('the-real-seed'), []);
    expect(result.hashMatches).toBe(false);
    expect(result.allOk).toBe(false);
  });
});