/**
 * Independent re-derivation of the dice, in the browser.
 *
 * This mirrors ProvableDiceRoller.derive exactly: sha256 of
 * `${serverSeed}:${nonce}:${round}`, scanning the digest for the first byte
 * below 252 and reducing it modulo 6. The 252 cut-off is rejection sampling -
 * 252 is 6 x 42, so any byte at or above it would make low faces very slightly
 * more likely. If a byte is never found the round counter increments and the
 * hash is taken again.
 *
 * If this disagreed with the server by even one step, honest games would fail
 * verification, so it is deliberately a line-for-line translation rather than
 * a reimplementation.
 */

const encoder = new TextEncoder();

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(digest);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = await sha256(input);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveRoll(serverSeed: string, nonce: number): Promise<number> {
  for (let round = 0; round < 64; round += 1) {
    const digest = await sha256(`${serverSeed}:${nonce}:${round}`);
    for (const byte of digest) {
      if (byte < 252) return (byte % 6) + 1;
    }
  }
  throw new Error('no unbiased byte found');
}

export interface ObservedRoll {
  nonce: number;
  value: number;
  userId: string;
}

export interface VerifiedRoll extends ObservedRoll {
  expected: number;
  ok: boolean;
}

export interface VerificationResult {
  hashMatches: boolean;
  publishedHash: string;
  computedHash: string;
  rolls: VerifiedRoll[];
  allOk: boolean;
}

/**
 * Two independent checks. First: the revealed seed really is the one whose
 * hash was published before the game began - so the server could not have
 * chosen a seed after seeing the board. Second: every roll actually observed
 * matches what that seed produces at its nonce.
 */
export async function verifyGame(
  serverSeed: string,
  publishedHash: string,
  observed: readonly ObservedRoll[],
): Promise<VerificationResult> {
  const computedHash = await sha256Hex(serverSeed);
  const rolls: VerifiedRoll[] = [];
  for (const r of observed) {
    const expected = await deriveRoll(serverSeed, r.nonce);
    rolls.push({ ...r, expected, ok: expected === r.value });
  }
  const hashMatches = computedHash === publishedHash;
  return {
    hashMatches,
    publishedHash,
    computedHash,
    rolls,
    allOk: hashMatches && rolls.every((r) => r.ok),
  };
}