import type { TrackConfig } from './types';

export const PLAYER_COLORS = [
  '#d44735',
  '#ee9a2f',
  '#245c8c',
  '#2f7a54',
  '#7b4d9e',
  '#2b9db2',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

export const USA_BEGINNER_TRACK: TrackConfig = {
  id: 'usa-beginner-starter',
  name: 'USA — one-lap learning race',
  laps: 1,
  finishSpace: 40,
  // This is a functional starter circuit. See docs/track-data.md for provenance.
  corners: [
    { id: 'corner-1', lineSpace: 10, speedLimit: 4, label: 'Turn 1' },
    { id: 'corner-2', lineSpace: 20, speedLimit: 3, label: 'Turn 2' },
    { id: 'corner-3', lineSpace: 29, speedLimit: 5, label: 'Turn 3' },
    { id: 'corner-4', lineSpace: 36, speedLimit: 4, label: 'Turn 4' },
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
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
