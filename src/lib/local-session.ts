import { MAX_PLAYERS, PLAYER_COLORS, type PlayerColor } from '../engine/constants';
import { createInitialGame } from '../engine/engine';
import type { GameState } from '../engine/types';
import type { RoomPlayer } from './supabase';

export interface LocalRoom {
  code: string;
  raceId?: string;
  hostPlayerId: string;
  status: 'LOBBY' | 'RACING' | 'FINISHED';
  players: RoomPlayer[];
  game: GameState | null;
}

const ROOM_KEY = 'heat-fan-local-room';

function makeRaceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

export function nextOpenSeat(players: readonly RoomPlayer[]): number | null {
  for (let seat = 0; seat < MAX_PLAYERS; seat += 1) {
    if (!players.some((player) => player.seat === seat)) return seat;
  }
  return null;
}

export function createLocalRoom(
  nickname: string,
  playerId: string,
  color: PlayerColor = PLAYER_COLORS[0],
): LocalRoom {
  const room: LocalRoom = {
    code: makeRoomCode(),
    raceId: makeRaceId(),
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
  const seat = nextOpenSeat(room.players);
  if (seat === null) return room;
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
    ].sort((left, right) => left.seat - right.seat),
  };
  setLocalRoom(next);
  return next;
}

export function removeLocalPlayer(room: LocalRoom, playerId: string): LocalRoom {
  if (room.status !== 'LOBBY')
    throw new Error('Players can only be removed before the race starts.');
  if (playerId === room.hostPlayerId) throw new Error('The host cannot be removed from the room.');
  if (!room.players.some((player) => player.id === playerId))
    throw new Error('That player is no longer in the room.');
  const next = { ...room, players: room.players.filter((player) => player.id !== playerId) };
  setLocalRoom(next);
  return next;
}

export function fillLocalBotSeats(room: LocalRoom): LocalRoom {
  let next = room;
  while (next.players.length < MAX_PLAYERS) next = addLocalBotSeat(next);
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
  next.raceId = makeRaceId();
  setLocalRoom(next);
  return next;
}

export function restartLocalRoom(room: LocalRoom): LocalRoom {
  if (room.game?.phase !== 'FINISHED')
    throw new Error('A new race is available after the current race is finished.');
  // Rebuild from the finished game's authoritative player records. The room
  // player list is a public mirror and may be stale or missing local-only
  // controller metadata after a refresh; using it here can silently turn AI
  // seats into human seats and leave the new race waiting forever.
  const sourcePlayers = room.game.players.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    color: player.color,
    controller: player.controller ?? 'HUMAN',
  }));
  const game = createInitialGame(sourcePlayers);
  const nextPlayers = room.players.map((roomPlayer) => {
    const source = sourcePlayers.find((player) => player.id === roomPlayer.id);
    return {
      ...roomPlayer,
      nickname: source?.name ?? roomPlayer.nickname,
      color: source?.color ?? roomPlayer.color,
      isBot: source?.controller === 'BOT',
      connected: true,
      submitted: false,
      position: undefined,
      gear: undefined,
      engineHeat: undefined,
      handCount: undefined,
      deckCount: undefined,
      discardCount: undefined,
      finished: undefined,
      finishRank: undefined,
      finishRound: undefined,
    };
  });
  const next = {
    ...room,
    raceId: makeRaceId(),
    status: 'RACING' as const,
    players: nextPlayers,
    game,
  };
  setLocalRoom(next);
  return next;
}
