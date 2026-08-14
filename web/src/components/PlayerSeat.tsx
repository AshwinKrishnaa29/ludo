import { motion } from 'framer-motion';
import type { Player } from '@ludo/shared';
import { DEEP, FILL } from '@/lib/colours';

interface Props {
  player: Player;
  active: boolean;
  isMe: boolean;
  secondsLeft: number | null;
  totalSeconds: number;
}

/**
 * The countdown is a ring around the player's disc rather than a number, so
 * time pressure is felt peripherally instead of read.
 */
export function PlayerSeat({ player, active, isMe, secondsLeft, totalSeconds }: Props) {
  const home = player.tokens.filter((t) => (t.progress ?? -1) >= 57).length;
  const frac = secondsLeft === null ? 0 : Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  const R = 21;
  const C = 2 * Math.PI * R;
  const urgent = secondsLeft !== null && secondsLeft <= 5;

  return (
    <motion.div
      layout
      animate={{ opacity: player.connected ? 1 : 0.5 }}
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors
        ${active
          ? 'border-brass/70 bg-white/[0.09] shadow-[0_0_0_1px_rgba(201,162,39,0.25),0_8px_30px_-12px_rgba(201,162,39,0.5)]'
          : 'border-white/8 bg-white/[0.035]'}`}
    >
      <div className="relative grid h-12 w-12 shrink-0 place-items-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx={24} cy={24} r={R} fill="none" stroke="#ffffff14" strokeWidth={3} />
          {active && secondsLeft !== null && (
            <circle
              cx={24}
              cy={24}
              r={R}
              fill="none"
              stroke={urgent ? '#e2574c' : '#c9a227'}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              style={{ transition: 'stroke-dashoffset 0.5s linear' }}
            />
          )}
        </svg>
        <span
          className="grid h-8 w-8 place-items-center rounded-full text-[15px] font-semibold"
          style={{
            background: FILL[player.colour],
            color: '#fff',
            boxShadow: `inset 0 -2px 0 ${DEEP[player.colour]}`,
          }}
        >
          {player.displayName.slice(0, 1).toUpperCase()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium leading-tight">
          {player.displayName}
          {isMe && <span className="ml-1.5 text-xs font-normal opacity-45">you</span>}
        </p>
        <div className="mt-1.5 flex items-center gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="h-1.5 w-4 rounded-full transition-colors"
              style={{ background: i < home ? FILL[player.colour] : '#ffffff1f' }}
            />
          ))}
          {!player.connected && <span className="ml-1 text-[11px] opacity-55">away</span>}
          {player.finishedRank && (
            <span className="ml-1 text-[11px] font-semibold text-brass-soft">
              #{player.finishedRank}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}