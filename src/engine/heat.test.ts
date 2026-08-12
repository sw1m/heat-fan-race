import { describe, expect, it } from 'vitest';
import { createInitialGame } from './engine';
import { summarizeHeat } from './heat';

describe('Heat capacity and supply', () => {
  it('keeps the starter deck extra Heat outside the six course engine slots', () => {
    const state = createInitialGame(
      [
        { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
        { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
      ],
      () => 0.42,
    );
    const player = state.players[0];
    const summary = summarizeHeat(player, state.track.engineHeatCapacity ?? 0);

    expect(summary.engine).toBe(6);
    expect(summary.engineCapacity).toBe(6);
    expect(summary.total).toBe(7);
    expect(summary.available).toBe(7);
    expect(summary.extraDeckCards).toBe(1);
  });

  it('does not offer second-gear Cooldown while the course engine is full even when the extra card exists', () => {
    const state = createInitialGame(
      [
        { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
        { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
      ],
      () => 0.42,
    );
    const player = state.players[0];
    const summary = summarizeHeat(player, state.track.engineHeatCapacity ?? 0);

    expect(summary.total).toBe(7);
    expect(summary.engine).toBe(summary.engineCapacity);
    expect(summary.available).toBe(7);
  });
});
