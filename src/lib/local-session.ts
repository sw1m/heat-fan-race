import { MAX_PLAYERS, PLAYER_COLORS, type PlayerColor } from '../engine/constants';
import { createInitialGame } from '../engine/engine';
import type { GameState } from '../engine/types';
import type { RoomPlayer } from './supabase';

export interface LocalRoom {
  code: string;
  hostPlayerId: string;
  status: 'LOBBY' | 'RACING' | 'FINISHED';
  players: RoomPlayer[];
  game: GameState | null;
}

const ROOM_KEY = 'heat-fan-local-room';

export function getLocalRoom(): LocalRoom | null {
  const raw = localStorage.getItem(ROOM_KEY);
  return raw ? (JSON.parse(raw) as LocalRoom) : null;
}

export function setLocalRoom(room: LocalRoom): void {
  localStorage.setItem(ROOM_KEY, JSON.stringify(room));
}

export function clearLocalRoom(): void {
  localStorage.removeItem(ROOM_KEY);
}

export function makeRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function createLocalRoom(
  nickname: string,
  playerId: string,
  color: PlayerColor = PLAYER_COLORS[0],
): LocalRoom {
  const room: LocalRoom = {
    code: makeRoomCode(),
    hostPlayerId: playerId,
    status: 'LOBBY',
    players: [
      {
        id: playerId,
        nickname,
        seat: 0,
        color,
        isHost: true,
        connected: true,
        submitted: false,
      },
    ],
    game: null,
  };
  setLocalRoom(room);
  return room;
}

export function addLocalBotSeat(room: LocalRoom): LocalRoom {
  if (room.players.length >= MAX_PLAYERS) return room;
  const seat = room.players.length;
  const usedColors = new Set(room.players.map((player) => player.color));
  const color =
    PLAYER_COLORS.find((candidate) => !usedColors.has(candidate)) ?? PLAYER_COLORS[seat];
  const next = {
    ...room,
    players: [
      ...room.players,
      {
        id: `bot-seat-${seat + 1}`,
        nickname: `Bot ${seat + 1}`,
        seat,
        color,
        isHost: false,
        connected: true,
        submitted: false,
        isBot: true,
      },
    ],
  };
  setLocalRoom(next);
  return next;
}

export function startLocalRoom(room: LocalRoom): LocalRoom {
  if (room.players.length < 2) throw new Error('At least two racers are needed to start.');
  const game = createInitialGame(
    room.players.map((player) => ({
      id: player.id,
      name: player.nickname,
      seat: player.seat,
      color: player.color,
      controller: player.isBot ? ('BOT' as const) : ('HUMAN' as const),
    })),
  );
  const next = { ...room, status: 'RACING' as const, game };
  setLocalRoom(next);
  return next;
}
