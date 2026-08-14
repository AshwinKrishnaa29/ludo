import type { PlayerColour } from '@ludo/shared';

/** Lacquered, slightly desaturated - closer to painted wood than screen RGB. */
export const FILL: Record<PlayerColour, string> = {
  red: '#d1483f',
  green: '#2f9159',
  yellow: '#dfa62b',
  blue: '#3a72b8',
};

export const DEEP: Record<PlayerColour, string> = {
  red: '#a3352e',
  green: '#226e42',
  yellow: '#b07f1b',
  blue: '#2a558c',
};

export const SOFT: Record<PlayerColour, string> = {
  red: '#f3d3cf',
  green: '#cbe6d5',
  yellow: '#f6e3b8',
  blue: '#cddef2',
};

/** Which corner of the board each colour occupies, for seating the panels. */
export const CORNER: Record<PlayerColour, 'tl' | 'tr' | 'br' | 'bl'> = {
  red: 'tl',
  green: 'tr',
  yellow: 'br',
  blue: 'bl',
};