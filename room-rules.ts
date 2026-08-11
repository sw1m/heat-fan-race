import { MAX_PLAYERS, MIN_PLAYERS } from '../engine/constants';
import type { RoomPlayer } from './supabase';

export function roomJoinError(
  room: { status: string; players: RoomPlayer[] } | null,
): string | null {
  if (!room) return 'Room not found. Check the code or invite link.';
  if (room.status === 'FINISHED') return 'This race is finished. Ask the host to start a new race.';
  if (room.status !== 'LOBBY') return 'This room is already racing.';
  if (room.players.length >= MAX_PLAYERS) return 'This room is full.';
  return null;
}

export function startRoomError(room: { players: RoomPlayer[] } | null): string | null {
  if (!room) return 'Room not found.';
  if (room.players.length < MIN_PLAYERS) return `At least ${MIN_PLAYERS} racers are required.`;
  if (room.players.length > MAX_PLAYERS) return `A room cannot exceed ${MAX_PLAYERS} racers.`;
  return null;
}

export function uniqueNickname(existing: readonly string[], nickname: string): string {
  if (!existing.includes(nickname)) return nickname;
  let suffix = 2;
  while (existing.includes(`${nickname} #${suffix}`)) suffix += 1;
  return `${nickname} #${suffix}`;
}
