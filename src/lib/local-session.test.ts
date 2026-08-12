import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addLocalBotSeat,
  createLocalRoom,
  removeLocalPlayer,
  restartLocalRoom,
  startLocalRoom,
} from './local-session';
import type { GameState } from '../engine/types';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

describe('local lobby seat management', () => {
  it('removes a non-host and reuses the released seat', () => {
    let room = createLocalRoom('Host', 'host');
    room = addLocalBotSeat(room);
    room = addLocalBotSeat(room);
    const removedId = room.players.find((player) => player.seat === 1)?.id;
    expect(removedId).toBeDefined();

    room = removeLocalPlayer(room, removedId!);
    expect(room.players.map((player) => player.seat)).toEqual([0, 2]);

    room = addLocalBotSeat(room);
    expect(room.players.map((player) => player.seat)).toEqual([0, 1, 2]);
  });

  it('does not allow the host to be removed', () => {
    const room = createLocalRoom('Host', 'host');
    expect(() => removeLocalPlayer(room, 'host')).toThrow(/host cannot be removed/);
  });

  it('does not allow lobby removal after the race starts', () => {
    let room = createLocalRoom('Host', 'host');
    room = addLocalBotSeat(room);
    room.status = 'RACING';
    expect(() => removeLocalPlayer(room, 'bot-seat-2')).toThrow(/before the race starts/);
  });

  it('starts a clean new local race after the finished race', () => {
    let room = createLocalRoom('Host', 'host');
    room = addLocalBotSeat(room);
    room = startLocalRoom(room);
    room = {
      ...room,
      status: 'FINISHED',
      game: { ...room.game!, phase: 'FINISHED' } as GameState,
    };

    const restarted = restartLocalRoom(room);

    expect(restarted.status).toBe('RACING');
    expect(restarted.game?.phase).toBe('PLANNING');
    expect(restarted.game?.round).toBe(1);
    expect(restarted.game?.players.map((player) => player.position.space)).toEqual([0, 0]);
    expect(restarted.players.every((player) => !player.finished && !player.submitted)).toBe(true);
  });

  it('restarts from authoritative bot roles when the room mirror is stale', () => {
    let room = createLocalRoom('Host', 'host');
    room = addLocalBotSeat(room);
    room = startLocalRoom(room);
    const stalePlayers = room.players.map((player) => ({ ...player, isBot: false }));
    const finished = {
      ...room,
      status: 'FINISHED' as const,
      players: stalePlayers,
      game: { ...room.game!, phase: 'FINISHED' as const },
    };

    const restarted = restartLocalRoom(finished);

    expect(restarted.game?.players.find((player) => player.id === 'bot-seat-2')?.controller).toBe(
      'BOT',
    );
    expect(restarted.players.find((player) => player.id === 'bot-seat-2')?.isBot).toBe(true);
    expect(restarted.raceId).not.toBe(room.raceId);
  });

  it('rejects a local restart before the race is finished', () => {
    let room = createLocalRoom('Host', 'host');
    room = addLocalBotSeat(room);
    room = startLocalRoom(room);

    expect(() => restartLocalRoom(room)).toThrow(/after the current race is finished/);
  });
});
