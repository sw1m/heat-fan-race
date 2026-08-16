import type { TrackConfig, TrackVisualConfig } from './types.ts';

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
 * An intentionally geometric, image-free top-down course sketch. The route is
 * an open snake so every numbered space is visible without making the course
 * loop back onto itself. The engine uses the numbered track data below; this
 * presentation path is only a clean visual guide.
 */
export const USA_TRACK_VISUAL: TrackVisualConfig = {
  laneGap: 3.6,
  centerline: [
    { x: 8, y: 86 },
    { x: 92, y: 86 },
    { x: 92, y: 68 },
    { x: 8, y: 68 },
    { x: 8, y: 50 },
    { x: 92, y: 50 },
    { x: 92, y: 32 },
    { x: 8, y: 32 },
    { x: 8, y: 14 },
    { x: 92, y: 14 },
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
export const TOTAL_STRESS_CARDS = 37;
export const STARTING_STRESS_CARDS = 3;
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
