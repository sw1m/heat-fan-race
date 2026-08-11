import { describe, expect, it } from 'vitest';
import { moveCardInOrder, reconcileCardOrder, sortCardsNumerically } from './hand-order';
import type { Card } from '../engine/types';

const cards: Card[] = [
  { id: 'stress', kind: 'STRESS' },
  { id: 'heat', kind: 'STARTING_HEAT' },
  { id: 'five', kind: 'STARTING_FIVE', value: 5 },
  { id: 'basic-2', kind: 'BASIC', value: 2 },
  { id: 'zero', kind: 'STARTING_ZERO', value: 0 },
  { id: 'basic-1', kind: 'BASIC', value: 1 },
];

describe('hand ordering', () => {
  it('sorts numeric cards first, then Heat, then Stress', () => {
    expect(sortCardsNumerically(cards).map((card) => card.id)).toEqual([
      'zero',
      'basic-1',
      'basic-2',
      'five',
      'heat',
      'stress',
    ]);
  });

  it('keeps existing manual order while adding newly drawn cards', () => {
    expect(reconcileCardOrder(['basic-2', 'zero'], cards).slice(0, 4)).toEqual([
      'basic-2',
      'zero',
      'stress',
      'heat',
    ]);
  });

  it('moves a dragged card before the target card', () => {
    expect(moveCardInOrder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });
});
