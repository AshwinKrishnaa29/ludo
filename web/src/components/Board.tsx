import { memo } from 'react';
import { motion } from 'framer-motion';
import { SAFE_SQUARES, START_OFFSET, type GameState, type PlayerColour } from '@ludo/shared';
import {
  GRID,
  HOME_PATH,
  RING,
  YARD_ORIGIN,
  YARD_SLOT_OFFSETS,
  cellFor,
  landingProgress,
} from '@/lib/geometry';
import { DEEP, FILL, SOFT } from '@/lib/colours';
import { Token } from './Token';

interface Props {
  state: GameState;
  legal: number[];
  meUserId: string | null;
  onMove: (tokenId: number) => void;
  onStep: () => void;
}

const COLOURS: PlayerColour[] = ['red', 'green', 'yellow', 'blue'];

function Star({ x, y }: { x: number; y: number }) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.31 : 0.13;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${x + 0.5 + r * Math.cos(a)},${y + 0.5 + r * Math.sin(a)}`);
  }
  return <polygon points={pts.join(' ')} fill="#1417250f" stroke="#14172522" strokeWidth={0.03} />;
}

function BoardInner({ state, legal, meUserId, onMove, onStep }: Props) {
  const current = state.players[state.turnIndex];
  const myTurn = !!current && current.userId === meUserId;
  const roll = state.pendingRoll;
  const seated = new Set(state.players.map((p) => p.colour));

  const occupancy = new Map<string, number>();

  return (
    <svg
      viewBox={`-0.45 -0.45 ${GRID + 0.9} ${GRID + 0.9}`}
      className="h-full w-full select-none"
      role="img"
      aria-label="Ludo board"
    >
      <defs>
        <linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4ecda" />
          <stop offset="100%" stopColor="#e3d5ba" />
        </linearGradient>
        <filter id="soften" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0.12" stdDeviation="0.12" floodOpacity="0.22" />
        </filter>
      </defs>

      <rect
        x={-0.45}
        y={-0.45}
        width={GRID + 0.9}
        height={GRID + 0.9}
        rx={0.9}
        fill="url(#cloth)"
      />

      {/* Yards. An empty seat is drawn flat so the board shows who is missing. */}
      {COLOURS.map((c) => {
        const [ox, oy] = YARD_ORIGIN[c];
        const active = seated.has(c);
        return (
          <g key={`yard-${c}`} opacity={active ? 1 : 0.32}>
            <rect x={ox} y={oy} width={6} height={6} rx={0.7} fill={FILL[c]} />
            <rect x={ox} y={oy} width={6} height={6} rx={0.7} fill="none" stroke={DEEP[c]} strokeWidth={0.09} />
            <rect x={ox + 0.85} y={oy + 0.85} width={4.3} height={4.3} rx={0.55} fill="#f7f1e2" />
            {[0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={ox + YARD_SLOT_OFFSETS[i % 2 === 0 ? 0 : 1] + 0.5}
                cy={oy + YARD_SLOT_OFFSETS[i < 2 ? 0 : 1] + 0.5}
                r={0.4}
                fill={SOFT[c]}
                stroke={DEEP[c]}
                strokeWidth={0.05}
              />
            ))}
          </g>
        );
      })}

      {/* Ring */}
      {RING.map(([x, y], idx) => {
        const entryOf = COLOURS.find((c) => START_OFFSET[c] === idx);
        return (
          <g key={`ring-${idx}`}>
            <rect
              x={x}
              y={y}
              width={1}
              height={1}
              fill={entryOf ? SOFT[entryOf] : '#fbf7ec'}
              stroke="#1417251f"
              strokeWidth={0.035}
            />
            {SAFE_SQUARES.has(idx) && !entryOf && <Star x={x} y={y} />}
            {entryOf && (
              <polygon
                points={`${x + 0.5},${y + 0.22} ${x + 0.75},${y + 0.62} ${x + 0.25},${y + 0.62}`}
                fill={FILL[entryOf]}
                opacity={0.75}
              />
            )}
          </g>
        );
      })}

      {/* Home columns */}
      {COLOURS.map((c) =>
        HOME_PATH[c].map(([x, y], i) => (
          <rect
            key={`home-${c}-${i}`}
            x={x}
            y={y}
            width={1}
            height={1}
            fill={FILL[c]}
            opacity={seated.has(c) ? 0.9 : 0.3}
            stroke="#1417251f"
            strokeWidth={0.035}
          />
        )),
      )}

      {/* Centre - the dice tray. Kept visually recessed so the die sits in it. */}
      <g>
        <polygon points="6,6 9,6 7.5,7.5" fill={FILL.green} opacity={0.9} />
        <polygon points="9,6 9,9 7.5,7.5" fill={FILL.yellow} opacity={0.9} />
        <polygon points="6,9 9,9 7.5,7.5" fill={FILL.blue} opacity={0.9} />
        <polygon points="6,6 6,9 7.5,7.5" fill={FILL.red} opacity={0.9} />
        <circle cx={7.5} cy={7.5} r={1.05} fill="#14172b" opacity={0.82} />
        <circle cx={7.5} cy={7.5} r={1.05} fill="none" stroke="#c9a227" strokeWidth={0.06} opacity={0.5} />
      </g>

      {/* Landing previews */}
      {myTurn &&
        roll !== null &&
        current &&
        current.tokens
          .filter((t) => legal.includes(t.id))
          .map((t) => {
            const dest = landingProgress(t.progress, roll);
            if (dest === null) return null;
            const [cx, cy] = cellFor(current.colour, dest, t.id);
            return (
              <motion.g key={`ghost-${t.id}`}>
                <motion.circle
                  cx={cx + 0.5}
                  cy={cy + 0.5}
                  r={0.36}
                  fill={FILL[current.colour]}
                  opacity={0.16}
                  animate={{ opacity: [0.1, 0.28, 0.1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <circle
                  cx={cx + 0.5}
                  cy={cy + 0.5}
                  r={0.36}
                  fill="none"
                  stroke="#c9a227"
                  strokeWidth={0.075}
                  strokeDasharray="0.16 0.13"
                />
              </motion.g>
            );
          })}

      {/* Tokens */}
      <g filter="url(#soften)">
        {state.players.flatMap((p) =>
          p.tokens.map((t) => {
            const [cx, cy] = cellFor(p.colour, t.progress, t.id);
            const key = `${cx},${cy}`;
            const nth = occupancy.get(key) ?? 0;
            occupancy.set(key, nth + 1);
            const movable = myTurn && p.userId === meUserId && legal.includes(t.id);
            return (
              <Token
                key={`${p.userId}-${t.id}`}
                colour={p.colour}
                tokenId={t.id}
                progress={t.progress}
                offset={nth === 0 ? 0 : 0.12 * (nth % 2 === 1 ? 1 : -1) * Math.ceil(nth / 2)}
                movable={movable}
                dimmed={
                  myTurn && p.userId === meUserId && !movable && state.phase === 'awaiting_move'
                }
                onPick={() => onMove(t.id)}
                onStep={onStep}
              />
            );
          }),
        )}
      </g>

      {/* Tokens safely home, counted in each wedge */}
      {state.players.map((p) => {
        const done = p.tokens.filter((t) => (t.progress ?? -1) >= 57).length;
        if (done === 0) return null;
        const at: Record<PlayerColour, [number, number]> = {
          red: [6.35, 7.62],
          green: [7.5, 6.55],
          yellow: [8.65, 7.62],
          blue: [7.5, 8.72],
        };
        const [ax, ay] = at[p.colour];
        return (
          <text
            key={`done-${p.userId}`}
            x={ax}
            y={ay}
            fontSize={0.46}
            fill="#fff"
            textAnchor="middle"
            fontWeight={700}
            opacity={0.9}
          >
            {done}
          </text>
        );
      })}

      <rect
        x={-0.45}
        y={-0.45}
        width={GRID + 0.9}
        height={GRID + 0.9}
        rx={0.9}
        fill="none"
        stroke="#c9a227"
        strokeWidth={0.11}
        opacity={0.65}
      />
    </svg>
  );
}

export const Board = memo(BoardInner);