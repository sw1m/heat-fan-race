import { BASIC_VALUES, STARTING_HAND_SIZE } from './constants';
import type { Card, CardKind, PlayerState, RandomSource } from './types';

export function createCard(kind: CardKind, id: string, value?: number): Card {
  return { id, kind, ...(value === undefined ? {} : { value }) };
}

export function createBeginnerDeck(playerId: string): Card[] {
  const cards: Card[] = [];
  for (const value of BASIC_VALUES) {
    for (let copy = 0; copy < 3; copy += 1) {
      cards.push(createCard('BASIC', `${playerId}-basic-${value}-${copy}`, value));
    }
  }
  for (let copy = 0; copy < 3; copy += 1) {
    cards.push(createCard('STRESS', `${playerId}-stress-${copy}`));
  }
  cards.push(createCard('STARTING_ZERO', `${playerId}-upgrade-zero`, 0));
  cards.push(createCard('STARTING_FIVE', `${playerId}-upgrade-five`, 5));
  cards.push(createCard('STARTING_HEAT', `${playerId}-upgrade-heat`));
  return cards;
}

export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function drawCards(
  player: PlayerState,
  count: number,
  random: RandomSource = Math.random,
): number {
  let drawn = 0;
  while (drawn < count) {
    if (player.deck.length === 0 && player.discard.length > 0) {
      player.deck = shuffle(player.discard, random);
      player.discard = [];
    }
    const next = player.deck.pop();
    if (!next) break;
    player.hand.push(next);
    drawn += 1;
  }
  return drawn;
}

export function replenishHand(player: PlayerState, random: RandomSource = Math.random): number {
  return drawCards(player, Math.max(0, STARTING_HAND_SIZE - player.hand.length), random);
}

export function countCardKinds(cards: readonly Card[]): Record<CardKind, number> {
  const counts: Record<CardKind, number> = {
    BASIC: 0,
    STRESS: 0,
    HEAT: 0,
    STARTING_ZERO: 0,
    STARTING_FIVE: 0,
    STARTING_HEAT: 0,
  };
  for (const card of cards) counts[card.kind] += 1;
  return counts;
}
