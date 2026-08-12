import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addLocalBotSeat, createLocalRoom, removeLocalPlayer } from './local-session';

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
});
