import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../engine/constants';
import { roomJoinError, startRoomError, uniqueNickname } from './room-rules';

const player = (seat: number) => ({
  id: String(seat),
  nickname: `Racer ${seat}`,
  seat,
  color: '#000',
  isHost: seat === 0,
  connected: true,
  submitted: false,
});

describe('room lifecycle rules', () => {
  it('creates specific join errors and caps rooms at six', () => {
    expect(roomJoinError(null)).toMatch(/not found/);
    expect(roomJoinError({ status: 'RACING', players: [player(0)] })).toMatch(/already racing/);
    expect(
      roomJoinError({
        status: 'LOBBY',
        players: Array.from({ length: MAX_PLAYERS }, (_, seat) => player(seat)),
      }),
    ).toMatch(/full/);
    expect(startRoomError({ players: [player(0)] })).toMatch(/2/);
  });

  it('adds a short distinguishing suffix to duplicate nicknames', () => {
    expect(uniqueNickname(['Apex', 'Apex #2'], 'Apex')).toBe('Apex #3');
  });
});
