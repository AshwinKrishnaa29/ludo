import {
  HOME_COLUMN_ENTRY,
  HOME_PROGRESS,
  MAIN_TRACK_LENGTH,
  START_OFFSET,
  type PlayerColour,
} from '@ludo/shared';

export type Cell = readonly [number, number];

export const GRID = 15;
export const CENTRE: Cell = [7, 7];

/**
 * The 52 shared ring squares, in travel order, indexed absolutely.
 *
 * Index 0 is red's entry. Verified against the domain contract: the ring, the
 * four home columns and the centre block tile the cross exactly, each colour's
 * home column joins the ring at progress 51, every entry sits one cell from
 * its own yard, and each star square falls 8 steps past an entry.
 */
export const RING: readonly Cell[] = [
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0],
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
];

export const HOME_PATH: Record<PlayerColour, readonly Cell[]> = {
  red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
};

export const YARD_ORIGIN: Record<PlayerColour, Cell> = {
  red: [0, 0],
  green: [9, 0],
  yellow: [9, 9],
  blue: [0, 9],
};

/**
 * Resting positions inside a yard.
 *
 * The offsets are 1.5 and 3.5, which put the token centres at 2 and 4 in a
 * six-cell yard - symmetric about the yard's centre of 3. Whole-number offsets
 * would place them at 1.5 and 3.5, whose midpoint is 2.5, and the whole group
 * would sit up and to the left of where it belongs.
 */
export const YARD_SLOT_OFFSETS = [1.5, 3.5] as const;

export function yardSlot(colour: PlayerColour, tokenId: number): Cell {
  const origin = YARD_ORIGIN[colour];
  const dx = YARD_SLOT_OFFSETS[tokenId % 2 === 0 ? 0 : 1];
  const dy = YARD_SLOT_OFFSETS[tokenId < 2 ? 0 : 1];
  return [origin[0] + dx, origin[1] + dy];
}

export function cellFor(
  colour: PlayerColour,
  progress: number | null,
  tokenId: number,
): Cell {
  if (progress === null) return yardSlot(colour, tokenId);
  if (progress >= HOME_PROGRESS) return CENTRE;
  if (progress >= HOME_COLUMN_ENTRY) {
    return HOME_PATH[colour][progress - HOME_COLUMN_ENTRY] ?? CENTRE;
  }
  return RING[(START_OFFSET[colour] + progress) % MAIN_TRACK_LENGTH] ?? CENTRE;
}

/**
 * Every cell a token passes through moving from one progress to another, so a
 * token hops square by square instead of sliding across the board.
 */
export function pathBetween(
  colour: PlayerColour,
  from: number | null,
  to: number,
  tokenId: number,
): Cell[] {
  const start = from === null ? 0 : from + 1;
  const cells: Cell[] = [];
  for (let p = start; p <= to; p += 1) cells.push(cellFor(colour, p, tokenId));
  return cells.length > 0 ? cells : [cellFor(colour, to, tokenId)];
}

export function landingProgress(progress: number | null, roll: number): number | null {
  if (progress === null) return roll === 6 ? 0 : null;
  const next = progress + roll;
  return next > HOME_PROGRESS ? null : next;
}