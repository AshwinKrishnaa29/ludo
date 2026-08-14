// web/src/components/EndScreen.tsx
// Shown when state.phase === 'finished'.
// Phase 1 (3 s): winner spotlight + confetti.
// Phase 2: everyone gets a fun title from titles.ts.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { GameState } from '@ludo/shared';
import { Confetti } from '@/components/Confetti';
import { assignTitle } from '@/lib/titles';
import { FILL } from '@/lib/colours';
import type { PlayerStats } from '@/store/game';

interface Props {
  state: GameState;
  stats: Record<string, PlayerStats>;
  userId: string | null;
  onLeave: () => void;
}

export function EndScreen({ state, stats, userId, onLeave }: Props) {
  const [phase, setPhase] = useState<'winner' | 'everyone'>('winner');
  const winnerId = state.winnerOrder[0];
  const winner = state.players.find((p) => p.userId === winnerId);
  const winnerStats = stats[winnerId ?? ''] ?? { captures: 0, sixes: 0, tokensHome: 0, gotCaptured: 0 };
  const allStats = Object.values(stats);

  // Auto-advance to everyone screen after 3 s
  useEffect(() => {
    const t = setTimeout(() => setPhase('everyone'), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#14172b]/90 p-6 backdrop-blur-md"
    >
      {phase === 'winner' && <Confetti />}

      <AnimatePresence mode="wait">
        {phase === 'winner' ? (
          // ── Phase 1: Winner spotlight ──────────────────────────────────────
          <motion.div
            key="winner"
            initial={{ scale: 0.85, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 1.06, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="relative z-50 w-full max-w-sm rounded-3xl border border-brass/50
                       bg-[#1c2140] p-8 text-center shadow-[0_0_80px_-20px_rgba(201,162,39,0.4)]"
          >
            <motion.p
              className="text-5xl"
              animate={{ rotate: [0, -12, 12, -8, 8, 0], scale: [1, 1.2, 1.2, 1.1, 1.1, 1] }}
              transition={{ duration: 0.8, delay: 0.3 }}
            >
              👑
            </motion.p>
            <p className="mt-3 text-xs uppercase tracking-[0.35em] text-brass">Ludo Champion</p>
            <h2 className="display mt-1 text-3xl font-bold">{winner?.displayName ?? 'Winner'}</h2>
            {winner && (
              <div
                className="mx-auto mt-3 grid h-12 w-12 place-items-center rounded-full text-lg font-bold text-white"
                style={{ background: FILL[winner.colour], boxShadow: `0 0 24px ${FILL[winner.colour]}88` }}
              >
                {winner.displayName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="mt-6 flex justify-center gap-6">
              {[
                { value: winnerStats.tokensHome, label: 'home' },
                { value: winnerStats.captures,   label: 'captures' },
                { value: winnerStats.sixes,       label: 'sixes' },
              ].map(({ value, label }, i) => (
                <div key={label} className="flex items-center gap-6">
                  {i > 0 && <div className="h-8 w-px bg-white/10" />}
                  <div className="text-center">
                    <p className="text-2xl font-bold text-brass">{value}</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wide opacity-45">{label}</p>
                  </div>
                </div>
              ))}
            </div>
            <motion.p
              className="mt-6 text-xs opacity-35"
              animate={{ opacity: [0.2, 0.5, 0.2] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              Showing everyone's moment...
            </motion.p>
            <button
              type="button"
              onClick={() => setPhase('everyone')}
              className="mt-3 text-xs underline decoration-brass/30 underline-offset-4 opacity-40 transition hover:opacity-80"
            >
              Skip
            </button>
          </motion.div>
        ) : (
          // ── Phase 2: Everyone's moment ─────────────────────────────────────
          <motion.div
            key="everyone"
            initial={{ scale: 0.92, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 24 }}
            className="w-full max-w-sm rounded-3xl border border-white/12 bg-[#1c2140] p-7 text-center"
          >
            <p className="text-3xl">🎉</p>
            <h2 className="display mt-2 text-2xl">What a game!</h2>
            <p className="mt-1 text-sm opacity-50">No losers. Just good games. ❤️</p>

            <ul className="mt-5 space-y-2 text-left">
              {state.winnerOrder.map((uid, i) => {
                const p = state.players.find((x) => x.userId === uid);
                if (!p) return null;
                const pStats = stats[uid] ?? { captures: 0, sixes: 0, tokensHome: 0, gotCaptured: 0 };
                const { emoji, title } = assignTitle(pStats, allStats, uid === winnerId);
                return (
                  <motion.li
                    key={uid}
                    initial={{ opacity: 0, x: -14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 + 0.05 }}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3
                      ${i === 0 ? 'border-brass/50 bg-brass/10' : 'border-white/8 bg-white/[0.03]'}`}
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                      style={{ background: FILL[p.colour] }}
                    >
                      {p.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-tight">{p.displayName}</span>
                      <span className="text-xs opacity-55">{emoji} {title}</span>
                    </span>
                    {uid === userId && <span className="shrink-0 text-[11px] opacity-40">you</span>}
                  </motion.li>
                );
              })}
            </ul>

            <p className="mt-5 text-xs opacity-30">The fun was everyone's. 🎲❤️</p>
            <button
              type="button"
              onClick={onLeave}
              className="mt-5 w-full rounded-2xl bg-brass px-4 py-3.5 font-semibold
                         text-[#14172b] transition hover:bg-brass-soft active:scale-95"
            >
              Play again 🎲
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}