import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { get } from '@/lib/api';
import { useGame } from '@/store/game';
import { verifyGame, type VerificationResult } from '@/lib/verify';

/**
 * Recomputes every roll in the browser from the revealed seed.
 *
 * The point is not that the player reads the hashes - it is that they could.
 * The server committed to sha256(seed) before the first throw, so if the
 * revealed seed hashes to that same value, the whole sequence was fixed
 * before anyone moved. No re-rolling after seeing the board is possible.
 */
export function FairnessPanel({ gameId }: { gameId: string }) {
  const { rolls, serverSeedHash } = useGame();
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [gameId]);

  async function run() {
    if (!serverSeedHash) {
      setError('No rolls were seen in this browser, so there is nothing to check.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { serverSeed } = await get<{ serverSeed: string }>(`/games/${gameId}/fairness`);
      setResult(await verifyGame(serverSeed, serverSeedHash, rolls));
    } catch (e) {
      setError((e as Error).message.replace(/_/g, ' '));
    } finally {
      setBusy(false);
    }
  }

  if (!result) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="w-full rounded-2xl border border-brass/40 px-4 py-3 text-sm font-medium
                     text-brass-soft transition hover:bg-brass/10 disabled:opacity-45"
        >
          {busy ? 'Checking the dice' : 'Check the dice were fair'}
        </button>
        {error && <p className="mt-2 text-center text-xs text-[#e2574c]">{error}</p>}
      </div>
    );
  }

  // The verdict is the whole point; the evidence only matters to whoever
  // doubts it. A hundred numbered tiles up front just buries the answer.
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/25 p-4 text-left"
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px]
            font-bold ${result.allOk ? 'bg-[#2f9159] text-white' : 'bg-[#d1483f] text-white'}`}
        >
          {result.allOk ? 'Y' : '!'}
        </span>
        <div className="min-w-0">
          <p
            className={`text-sm font-semibold ${result.allOk ? 'text-[#8fd6ab]' : 'text-[#f0a49d]'}`}
          >
            {result.allOk
              ? `All ${result.rolls.length} rolls match the sealed dice`
              : 'These rolls do not match the sealed dice'}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed opacity-55">
            The server sealed its dice before the first throw and opened them afterwards. Nothing
            could be changed once play began.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="mt-3 text-[11px] underline decoration-white/25 underline-offset-4
                   opacity-50 transition hover:opacity-100"
      >
        {showDetail ? 'Hide the details' : 'Show me the numbers'}
      </button>

      {showDetail && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.2em] opacity-40">Sealed fingerprint</p>
          <p className="mono mt-1 break-all text-[10px] opacity-45">{result.computedHash}</p>
          <div className="mt-3 flex flex-wrap gap-1">
            {result.rolls.map((r) => (
              <span
                key={r.nonce}
                title={`roll ${r.nonce}: saw ${r.value}, sealed dice give ${r.expected}`}
                className={`grid h-6 w-6 place-items-center rounded-md text-[11px] font-semibold
                  ${r.ok ? 'bg-[#2f9159]/25 text-[#8fd6ab]' : 'bg-[#d1483f]/30 text-[#f0a49d]'}`}
              >
                {r.value}
              </span>
            ))}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}