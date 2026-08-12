import { describe, expect, it } from 'vitest';
import { applyGameAction, createInitialGame } from './engine';
import { summarizeHeat } from './heat';

describe('Heat capacity and supply', () => {
  it('adds the starter Heat card as an extra engine slot', () => {
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
    expect(summary.courseCapacity).toBe(6);
    expect(summary.engineCapacity).toBe(7);
    expect(summary.total).toBe(7);
    expect(summary.available).toBe(7);
    expect(summary.extraDeckCards).toBe(1);
    expect(['HAND', 'DRAW PILE']).toContain(summary.startingHeatLocation);
  });

  it('keeps the extra engine slot available when the starter Heat is in hand', () => {
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
    expect(summary.engine).toBe(6);
    expect(summary.engineCapacity).toBe(7);
    expect(summary.available).toBe(7);
    expect(summary.startingHeatLocation).toBe('HAND');
  });

  it('keeps the actual starter Heat card usable after it is drawn', () => {
    let state = createInitialGame(
      [
        { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
        { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
      ],
      () => 0.42,
    );
    const player = state.players[0];
    const startingHeatHandIndex = player.hand.findIndex((card) => card.kind === 'STARTING_HEAT');
    let startingHeat =
      startingHeatHandIndex >= 0 ? player.hand.splice(startingHeatHandIndex, 1)[0] : undefined;
    if (!startingHeat) {
      const startingHeatDeckIndex = player.deck.findIndex((card) => card.kind === 'STARTING_HEAT');
      expect(startingHeatDeckIndex).toBeGreaterThanOrEqual(0);
      startingHeat = player.deck.splice(startingHeatDeckIndex, 1)[0];
    }
    expect(startingHeat?.kind).toBe('STARTING_HEAT');
    const speedCards = player.hand.filter((card) => card.kind === 'BASIC').slice(0, 2);
    const retainedHandCards = player.hand.filter(
      (card) => !speedCards.some((selected) => selected.id === card.id),
    );
    player.hand = [...speedCards, startingHeat];
    player.deck.push(...retainedHandCards);
    state.players[1].hand = [state.players[1].hand.find((card) => card.kind === 'BASIC')!];

    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 2, cardIds: speedCards.map((card) => card.id) },
      () => 0.42,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      () => 0.42,
    );

    expect(state.pending?.options).toContain('COOLDOWN');
    state = applyGameAction(state, { type: 'COOLDOWN', playerId: 'p1' }, () => 0.42);
    const after = summarizeHeat(state.players[0], state.track.engineHeatCapacity ?? 0);
    expect(after.engine).toBe(7);
    expect(after.engineCapacity).toBe(7);
    expect(after.total).toBe(7);
    expect(after.startingHeatLocation).toBe('ENGINE');
  });
});
