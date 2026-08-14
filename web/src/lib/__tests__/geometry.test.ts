import { describe, expect, it } from 'vitest';
import { HOME_PROGRESS, PLAYER_COLOURS } from '@ludo/shared';
import {
  GRID,
  YARD_ORIGIN,
  YARD_SLOT_OFFSETS,
  cellFor,
  landingProgress,
  pathBetween,
} from '../geometry';

describe('pathBetween', () => {
  it('returns one cell per step, so a roll of five is five hops', () => {
    expect(pathBetween('red', 3, 8, 0)).toHaveLength(5);
    expect(pathBetween('blue', 0, 1, 2)).toHaveLength(1);
  });

  it('leaves the yard onto the entry square only', () => {
    // A six out of the yard is a single step onto the entry square, not a
    // lap of the board.
    const path = pathBetween('green', null, 0, 1);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual(cellFor('green', 0, 1));
  });

  it('crosses into the home column without a gap', () => {
    const path = pathBetween('yellow', 50, 54, 0);
    expect(path).toHaveLength(4);
    expect(path[path.length - 1]).toEqual(cellFor('yellow', 54, 0));
    const adjacent = (a: readonly number[], b: readonly number[]) =>
      Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!);
    // Every step is one square, except where the ring wraps the centre block.
    for (let i = 1; i < path.length; i += 1) {
      expect(adjacent(path[i - 1]!, path[i]!)).toBeLessThanOrEqual(2);
    }
  });

  it('never returns an empty route', () => {
    expect(pathBetween('red', 5, 5, 0).length).toBeGreaterThan(0);
  });
});

describe('cellFor', () => {
  it('stays on the board for every reachable progress', () => {
    for (const colour of PLAYER_COLOURS) {
      for (let tokenId = 0; tokenId < 4; tokenId += 1) {
        for (let p = 0; p <= HOME_PROGRESS; p += 1) {
          const [x, y] = cellFor(colour, p, tokenId);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(GRID);
          expect(y).toBeLessThan(GRID);
        }
      }
    }
  });

  it('seats yard tokens symmetrically about the centre of the yard', () => {
    // Guards the off-centre bug: whole-number offsets put the group up and to
    // the left of where the yard actually is.
    const centres = YARD_SLOT_OFFSETS.map((o) => o + 0.5);
    const mean = (centres[0]! + centres[1]!) / 2;
    expect(mean).toBe(3);

    for (const colour of PLAYER_COLOURS) {
      const [ox, oy] = YARD_ORIGIN[colour];
      const xs = [0, 1, 2, 3].map((id) => cellFor(colour, null, id)[0] + 0.5);
      const ys = [0, 1, 2, 3].map((id) => cellFor(colour, null, id)[1] + 0.5);
      expect(xs.reduce((a, b) => a + b, 0) / 4).toBe(ox + 3);
      expect(ys.reduce((a, b) => a + b, 0) / 4).toBe(oy + 3);
    }
  });
});

describe('landingProgress', () => {
  it('only lets a token out of the yard on a six', () => {
    expect(landingProgress(null, 6)).toBe(0);
    expect(landingProgress(null, 3)).toBeNull();
  });

  it('refuses to overshoot home', () => {
    expect(landingProgress(HOME_PROGRESS - 2, 2)).toBe(HOME_PROGRESS);
    expect(landingProgress(HOME_PROGRESS - 2, 3)).toBeNull();
  });
});