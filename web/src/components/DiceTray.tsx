import { motion, AnimatePresence } from 'framer-motion';
import type { PlayerColour } from '@ludo/shared';
import { DEEP, FILL } from '@/lib/colours';
import { useGameSounds } from '@/hooks/useGameSounds';

interface Props {
  value: number | null;
  colour: PlayerColour | null;
  rolling: boolean;
  canRoll: boolean;
  onRoll: () => void;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 28], [70, 28], [30, 50], [70, 50], [30, 72], [70, 72]],
};

/**
 * The die lives in the middle of the board, tinted with the colour of whoever
 * threw it. Every player sees every roll in the same place, which is why this
 * board needs no running commentary.
 */
export function DiceTray({ value, colour, rolling, canRoll, onRoll }: Props) {
  const tint = colour ? FILL[colour] : '#8a86a3';
  const deep = colour ? DEEP[colour] : '#5d5a72';
  const { playDice } = useGameSounds();

  return (
    <button
      type="button"
      onClick={() => { playDice(); onRoll(); }}
      disabled={!canRoll}
      aria-label={canRoll ? 'Roll the dice' : value ? `Rolled ${value}` : 'Waiting'}
      className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center
                 rounded-full transition-transform disabled:cursor-default
                 enabled:hover:scale-[1.06] enabled:active:scale-95"
      style={{ width: '17%', height: '17%' }}
    >
      {canRoll && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: '2px solid #c9a227' }}
          animate={{ scale: [1, 1.35], opacity: [0.75, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      <motion.svg
        viewBox="0 0 100 100"
        className="h-[76%] w-[76%]"
        animate={
          rolling
            ? { rotate: [0, -140, 95, 0], scale: [1, 1.18, 0.92, 1] }
            : { rotate: 0, scale: 1 }
        }
        transition={{ duration: 0.6, ease: [0.3, 0.9, 0.4, 1] }}
      >
        <rect x={8} y={8} width={84} height={84} rx={20} fill={deep} />
        <rect x={8} y={5} width={84} height={84} rx={20} fill="#faf6ec" />
        <rect
          x={8}
          y={5}
          width={84}
          height={84}
          rx={20}
          fill="none"
          stroke={tint}
          strokeWidth={4}
          opacity={0.85}
        />
        <AnimatePresence mode="wait">
          <motion.g
            key={value ?? 'blank'}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.16 }}
          >
            {(value ? PIPS[value] ?? [] : []).map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy - 3} r={8.5} fill={deep} />
            ))}
          </motion.g>
        </AnimatePresence>
      </motion.svg>
    </button>
  );
}