import type { TrackConfig, TrackVisualConfig } from './types';

export const PLAYER_COLORS = [
  '#d44735',
  '#f2c230',
  '#245c8c',
  '#2f7a54',
  '#7b4d9e',
  '#2b9db2',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/**
 * A neutral, image-free drawing of the USA course supplied from the player's
 * board reference. It preserves the long lower straight, wide right-hand
 * sweep, upper bend, and tight left-side return without copying board art.
 */
export const USA_TRACK_VISUAL: TrackVisualConfig = {
  laneGap: 3.4,
  centerline: [
    { x: 15, y: 80 },
    { x: 10, y: 72 },
    { x: 10, y: 62 },
    { x: 15, y: 53 },
    { x: 24, y: 47 },
    { x: 32, y: 44 },
    { x: 37, y: 38 },
    { x: 37, y: 28 },
    { x: 34, y: 19 },
    { x: 38, y: 12 },
    { x: 47, y: 9 },
    { x: 60, y: 10 },
    { x: 72, y: 14 },
    { x: 81, y: 23 },
    { x: 87, y: 35 },
    { x: 89, y: 49 },
    { x: 87, y: 63 },
    { x: 80, y: 73 },
    { x: 67, y: 79 },
    { x: 51, y: 82 },
    { x: 34, y: 82 },
    { x: 22, y: 81 },
    { x: 15, y: 80 },
  ],
};

export const USA_BEGINNER_TRACK: TrackConfig = {
  id: 'usa-beginner-starter',
  name: 'USA — one-lap learning race',
  laps: 1,
  finishSpace: 69,
  engineHeatCapacity: 6,
  visual: USA_TRACK_VISUAL,
  corners: [
    { id: 'corner-1', lineSpace: 6, speedLimit: 7, label: 'Turn 1' },
    { id: 'corner-2', lineSpace: 20, speedLimit: 3, label: 'Turn 2' },
    { id: 'corner-3', lineSpace: 26, speedLimit: 3, label: 'Turn 3' },
    { id: 'corner-4', lineSpace: 52, speedLimit: 2, label: 'Turn 4' },
  ],
  grid: [
    { space: 0, lane: 0 },
    { space: 0, lane: 1 },
    { space: -1, lane: 0 },
    { space: -1, lane: 1 },
    { space: -2, lane: 0 },
    { space: -2, lane: 1 },
  ],
};

export const BASIC_VALUES = [1, 2, 3, 4] as const;
export const STARTING_HAND_SIZE = 7;
export const USA_ENGINE_HEAT = 6;
export const TOTAL_HEAT_CARDS = 7;
export const STARTER_DECK_EXTRA_HEAT_CARDS = TOTAL_HEAT_CARDS - USA_ENGINE_HEAT;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
