import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import type { PlayerColour } from '@ludo/shared';
import { cellFor, pathBetween } from '@/lib/geometry';
import { DEEP, FILL } from '@/lib/colours';

interface Props {
  colour: PlayerColour;
  tokenId: number;
  progress: number | null;
  offset: number;
  movable: boolean;
  dimmed: boolean;
  onPick: () => void;
  onStep: () => void;
}

/** Long enough to read as counting. Below about 150ms it looks like sliding. */
const STEP_MS = 190;

/**
 * A token walks its route rather than sliding to the destination: one square
 * per step, each step eased in and out with a small bounce, so a roll of five
 * is visibly five hops. The path comes from the same geometry the board is
 * drawn from, so the token can never cut a corner the rules do not allow.
 */
export function Token({ colour, tokenId, progress, offset, movable, dimmed, onPick, onStep }: Props) {
  const controls = useAnimationControls();
  const prev = useRef<number | null | undefined>(undefined);
  const [airborne, setAirborne] = useState(false);


  useEffect(() => {
    const [x, y] = cellFor(colour, progress, tokenId);
    const target = { x: x + 0.5 + offset, y: y + 0.5 + offset };

    // First paint: place the token, do not animate it in.
    if (prev.current === undefined) {
      prev.current = progress;
      void controls.set(target);
      return;
    }

    const from = prev.current;
    prev.current = progress;
    if (from === progress) {
      void controls.start({ ...target, transition: { duration: 0.2 } });
      return;
    }

    // Sent home by a capture: arc back rather than retrace the whole board.
    if (progress === null) {
      setAirborne(true);
      onStep(); // single sound for the capture arc
      void controls
        .start({ ...target, transition: { type: 'spring', stiffness: 120, damping: 14 } })
        .then(() => setAirborne(false));
      return;
    }

    // The starting cell has to lead the keyframes, otherwise the token jumps
    // to the first step before animating.
    const start = cellFor(colour, from, tokenId);
    const route = [start, ...pathBetween(colour, from, progress, tokenId)];
    const segments = route.length - 1;

    // Fire the sound once per step, timed to match each cell landing.
    // We skip index 0 because that is the starting cell the token is already on.
    for (let i = 1; i <= segments; i++) {
      setTimeout(() => onStep(), i * STEP_MS);
    }

    void controls.start({
      x: route.map((c) => c[0] + 0.5 + offset),
      y: route.map((c) => c[1] + 0.5 + offset),
      // Alternating scale gives each landing a small squash, so consecutive
      // steps stay countable instead of blurring into one glide.
      scale: route.map((_, i) => (i === 0 || i === segments ? 1 : i % 2 === 1 ? 1.12 : 1)),
      transition: {
        duration: (segments * STEP_MS) / 1000,
        ease: Array.from({ length: segments }, () => 'easeInOut' as const),
      },
    });
  }, [colour, tokenId, progress, offset, controls, onStep]);

  return (
    <motion.g
      animate={controls}
      style={{ cursor: movable ? 'pointer' : 'default' }}
      onClick={movable ? onPick : undefined}
      opacity={dimmed ? 0.34 : 1}
    >
      {movable && (
        <motion.circle
          r={0.34}
          fill="none"
          stroke="#c9a227"
          strokeWidth={0.09}
          animate={{ r: [0.34, 0.58], opacity: [0.9, 0] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <motion.g animate={{ scale: airborne ? [1, 1.45, 1] : 1 }} transition={{ duration: 0.5 }}>
        <ellipse rx={0.3} ry={0.12} cy={0.26} fill="#0000003d" />
        <circle r={0.31} fill={DEEP[colour]} />
        <circle r={0.27} cy={-0.035} fill={FILL[colour]} />
        <circle r={0.115} cy={-0.09} fill="#ffffff5c" />
        {movable && <circle r={0.31} fill="none" stroke="#f5e6b8" strokeWidth={0.08} />}
      </motion.g>
    </motion.g>
  );
}