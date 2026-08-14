// web/src/lib/titles.ts
// Single source of truth for player title logic.
// Used by EndScreen (end of game) and PlayerSeat (live during game).

import type { PlayerStats } from '@/store/game';

export interface PlayerTitle {
  emoji: string;
  title: string;
}

export function assignTitle(
  stats: PlayerStats,
  allStats: PlayerStats[],
  isWinner: boolean,
): PlayerTitle {
  if (isWinner) return { emoji: '👑', title: 'Ludo Champion' };

  const mostCaptures = Math.max(...allStats.map((s) => s.captures));
  const mostSixes    = Math.max(...allStats.map((s) => s.sixes));
  const mostCaptured = Math.max(...allStats.map((s) => s.gotCaptured));

  if (stats.captures > 0 && stats.captures === mostCaptures)
    return { emoji: '😈', title: 'Chaos Maker' };
  if (stats.sixes >= 3 && stats.sixes === mostSixes)
    return { emoji: '🎲', title: 'Dice Master' };
  if (stats.gotCaptured >= 2 && stats.tokensHome >= 1)
    return { emoji: '🔥', title: 'Comeback King' };
  if (stats.gotCaptured === mostCaptured && stats.gotCaptured > 0)
    return { emoji: '⭐', title: 'Unlucky Star' };
  if (stats.tokensHome >= 2)
    return { emoji: '🏃', title: 'Race Star' };
  return { emoji: '❤️', title: 'Good Sport' };
}