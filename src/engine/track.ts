import type { CarPosition, Lane, PlayerState, TrackConfig } from './types';

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
  const desired = Math.min(track.finishSpace, current.space + distance);
  let space = desired;
  while (space > current.space && !isSpaceOpen(players, space, playerId)) space -= 1;
  if (space === current.space) return current;
  const occupants = occupantsAt(players, space, playerId);
  const lane: Lane = occupants.some((player) => player.position.lane === 0) ? 1 : 0;
  return { space, lane };
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
  const aProgress = a.finishProgress ?? a.position.space;
  const bProgress = b.finishProgress ?? b.position.space;
  if (aProgress !== bProgress) return bProgress - aProgress;
  if (a.position.lane !== b.position.lane) return a.position.lane - b.position.lane;
  return a.seat - b.seat;
}

export function orderedPlayers(players: readonly PlayerState[]): PlayerState[] {
  return [...players].filter((player) => !player.finished).sort(positionSort);
}
