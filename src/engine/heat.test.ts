import { describe, expect, it } from 'vitest';
import { USA_BEGINNER_TRACK } from './constants';
import { applyGameAction, createInitialGame as createAuthoritativeGame } from './engine';
import { summarizeHeat } from './heat';
import { positionSort } from './track';
import type { GameState } from './types';

const fixedRandom = () => 0.42;

// These tests focus on Heat movement, so keep the local test setup's grid
// stable while the production constructor randomizes the official grid.
function createInitialGame(
  specs: Parameters<typeof createAuthoritativeGame>[0],
  random: () => number = fixedRandom,
): GameState {
  const state = createAuthoritativeGame(specs, random);
  [...state.players]
    .sort((left, right) => left.seat - right.seat)
    .forEach((player, index) => {
      player.position = USA_BEGINNER_TRACK.grid[index]!;
    });
  const ordered = [...state.players].sort(positionSort);
  state.adrenalineEligibleIds = ordered
    .slice(-(state.startingPlayerCount >= 5 ? 2 : 1))
    .map((player) => player.id);
  return state;
}

describe('Heat capacity and supply', () => {
  it('keeps the physical Stress reserve finite after dealing starting decks', () => {
    const twoCars = createInitialGame([
      { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
      { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
    ]);
    const sixCars = createInitialGame([
      { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
      { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
      { id: 'p3', name: 'Yellow', seat: 2, color: '#f2c230' },
      { id: 'p4', name: 'Green', seat: 3, color: '#2f7a54' },
      { id: 'p5', name: 'Purple', seat: 4, color: '#7b4d9e' },
      { id: 'p6', name: 'Teal', seat: 5, color: '#2b9db2' },
    ]);

    expect(twoCars.stressReserve).toBe(31);
    expect(sixCars.stressReserve).toBe(19);
  });

  it('adds the starter Heat card as an extra engine slot', () => {
    const state = createInitialGame(
      [
        { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
        { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
      ],
      fixedRandom,
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
      fixedRandom,
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
      fixedRandom,
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
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
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
