import type { CarPosition, Lane, PlayerState, TrackConfig, TrackVisualPoint } from './types.ts';

export interface VisualTrackPosition extends TrackVisualPoint {
  angle: number;
}

function distanceBetween(a: TrackVisualPoint, b: TrackVisualPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Resolve a numbered space to a lane centerline position for the track map. */
export function visualTrackPosition(
  track: TrackConfig,
  space: number,
  lane: Lane,
): VisualTrackPosition | null {
  const visual = track.visual;
  if (!visual || visual.centerline.length < 2 || track.finishSpace <= 0) return null;

  const lengths = visual.centerline
    .slice(1)
    .map((point, index) => distanceBetween(visual.centerline[index], point));
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const target = (space / track.finishSpace) * totalLength;

  let segmentIndex = 0;
  let segmentStartDistance = 0;
  if (target <= 0) {
    segmentIndex = 0;
  } else if (target >= totalLength) {
    segmentIndex = lengths.length - 1;
    segmentStartDistance = totalLength - lengths[segmentIndex];
  } else {
    for (let index = 0; index < lengths.length; index += 1) {
      if (segmentStartDistance + lengths[index] >= target) {
        segmentIndex = index;
        break;
      }
      segmentStartDistance += lengths[index];
    }
  }

  const start = visual.centerline[segmentIndex];
  const end = visual.centerline[segmentIndex + 1];
  const segmentLength = lengths[segmentIndex] || 1;
  const ratio = (target - segmentStartDistance) / segmentLength;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const normalX = -dy / segmentLength;
  const normalY = dx / segmentLength;
  const laneOffset = (lane === 0 ? -1 : 1) * visual.laneGap * 0.5;

  return {
    x: start.x + dx * ratio + normalX * laneOffset,
    y: start.y + dy * ratio + normalY * laneOffset,
    angle,
  };
}

export function occupantsAt(
  players: readonly PlayerState[],
  space: number,
  exceptId?: string,
): PlayerState[] {
  return players.filter(
    (player) => player.id !== exceptId && !player.finished && player.position.space === space,
  );
}

export function isSpaceOpen(
  players: readonly PlayerState[],
  space: number,
  exceptId?: string,
): boolean {
  return occupantsAt(players, space, exceptId).length < 2;
}

export function chooseLandingPosition(
  players: readonly PlayerState[],
  current: CarPosition,
  movement: number,
  track: TrackConfig,
  playerId: string,
): CarPosition {
  const distance = Math.max(0, movement);
  if (distance === 0) return current;
  // The finish marker is still a track space. A car finishes only after
  // landing in a post-finish space beyond the line.
  const desired = current.space + distance;
  let space = desired;
  while (space > current.space && !isSpaceOpen(players, space, playerId)) space -= 1;
  if (space === current.space) return current;
  const occupants = occupantsAt(players, space, playerId);
  const lane: Lane = occupants.some((player) => player.position.lane === 0) ? 1 : 0;
  return { space, lane };
}

export function chooseSpinoutPosition(
  players: readonly PlayerState[],
  cornerLineSpace: number,
  track: TrackConfig,
  playerId: string,
  fallback: CarPosition,
): CarPosition {
  const firstTrackSpace = Math.min(0, ...track.grid.map((position) => position.space));
  for (let space = cornerLineSpace - 1; space >= firstTrackSpace; space -= 1) {
    if (!isSpaceOpen(players, space, playerId)) continue;
    const occupants = occupantsAt(players, space, playerId);
    const lane: Lane = occupants.some((player) => player.position.lane === 0) ? 1 : 0;
    return { space, lane };
  }
  return fallback;
}

export function crossedCorners(
  track: TrackConfig,
  fromSpace: number,
  toSpace: number,
): TrackConfig['corners'] {
  if (toSpace <= fromSpace) return [];
  return track.corners.filter(
    (corner) => corner.lineSpace > fromSpace && corner.lineSpace <= toSpace,
  );
}

export function nextCorner(
  track: TrackConfig,
  fromSpace: number,
): TrackConfig['corners'][number] | undefined {
  return track.corners.find((corner) => corner.lineSpace > fromSpace);
}

export function distanceToNextCorner(track: TrackConfig, fromSpace: number): number | null {
  const corner = nextCorner(track, fromSpace);
  return corner ? Math.max(0, corner.lineSpace - 1 - fromSpace) : null;
}

export function isAdjacentOrBehind(players: readonly PlayerState[], player: PlayerState): boolean {
  return players.some(
    (other) =>
      other.id !== player.id &&
      !other.finished &&
      (other.position.space === player.position.space ||
        other.position.space === player.position.space + 1),
  );
}

export function positionSort(a: PlayerState, b: PlayerState): number {
  if (a.position.space !== b.position.space) return b.position.space - a.position.space;
  if (a.position.lane !== b.position.lane) return a.position.lane - b.position.lane;
  return a.seat - b.seat;
}

export function finishSort(a: PlayerState, b: PlayerState): number {
  // The final landing space is authoritative. `finishProgress` is retained
  // for compatibility with saved states, but it can represent the first
  // crossing before a later Boost or Slipstream movement in the same turn.
  if (a.position.space !== b.position.space) return b.position.space - a.position.space;
  if (a.position.lane !== b.position.lane) return a.position.lane - b.position.lane;
  return a.seat - b.seat;
}

export function orderedPlayers(players: readonly PlayerState[]): PlayerState[] {
  return [...players].filter((player) => !player.finished).sort(positionSort);
}
