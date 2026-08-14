import { motion } from 'framer-motion';
import type { GameState } from '@ludo/shared';
import { FILL } from '@/lib/colours';

interface Props {
  state: GameState;
  secondsLeft: number;
  onDrop: (userId: string) => void;
}

/**
 * The table stops rather than letting a bot finish somebody's match. Anyone
 * still playing can carry on without the missing player instead of waiting
 * out the clock.
 */
export function PausedOverlay({ state, secondsLeft, onDrop }: Props) {
  const missing = state.players.find((p) => p.userId === state.pausedFor);
  if (!missing) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 grid place-items-center rounded-2xl
                 bg-[#14172b]/78 p-6 text-center backdrop-blur-[3px]"
    >
      <div>
        <motion.span
          className="mx-auto mb-4 block h-12 w-12 rounded-full"
          style={{ background: FILL[missing.colour] }}
          animate={{ opacity: [1, 0.35, 1] }}
          transition={{ duration: 1.8, repeat: Infinity }}
        />
        <p className="display text-xl">Waiting for {missing.displayName}</p>
        <p className="mt-1.5 text-sm opacity-60">
          They dropped out. The game is on hold so nobody plays for them.
        </p>
        <p className="mono mt-4 text-3xl text-brass-soft">{secondsLeft}s</p>
        <button
          type="button"
          onClick={() => onDrop(missing.userId)}
          className="mt-5 rounded-2xl border border-white/20 px-5 py-2.5 text-sm
                     transition hover:border-brass/60 hover:bg-white/[0.06]"
        >
          Carry on without them
        </button>
      </div>
    </motion.div>
  );
}