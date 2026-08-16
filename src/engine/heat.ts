import type { Card, PlayerState } from './types.ts';

export function isHeatCard(card: Card): boolean {
  return card.kind === 'HEAT' || card.kind === 'STARTING_HEAT';
}

export interface HeatSummary {
  engine: number;
  courseCapacity: number;
  engineCapacity: number;
  total: number;
  available: number;
  inHand: number;
  inDeck: number;
  inDiscard: number;
  inPlayed: number;
  extraDeckCards: number;
  startingHeatLocation: 'ENGINE' | 'HAND' | 'DRAW PILE' | 'DISCARD' | 'PLAYED' | 'MISSING';
}

function startingHeatLocation(player: PlayerState): HeatSummary['startingHeatLocation'] {
  if (player.engine.some((card) => card.kind === 'STARTING_HEAT')) return 'ENGINE';
  if (player.hand.some((card) => card.kind === 'STARTING_HEAT')) return 'HAND';
  if (player.deck.some((card) => card.kind === 'STARTING_HEAT')) return 'DRAW PILE';
  if (player.discard.some((card) => card.kind === 'STARTING_HEAT')) return 'DISCARD';
  if (player.played.some((card) => card.kind === 'STARTING_HEAT')) return 'PLAYED';
  return 'MISSING';
}

/**
 * The course supplies the base number of engine slots. Special Heat cards in
 * the player's deck add one usable engine slot each, even while that card is
 * in the hand, draw pile, discard, or engine.
 *
 * `available` is Heat currently in the engine, hand, or draw pile. Cards in
 * discard/played are not immediately available to Cooldown or payment.
 */
export function countExtraEngineSlots(player: PlayerState): number {
  return [player.engine, player.hand, player.deck, player.discard, player.played]
    .flat()
    .filter((card) => card.kind === 'STARTING_HEAT').length;
}

export function engineHeatCapacityForPlayer(player: PlayerState, courseCapacity: number): number {
  return courseCapacity + countExtraEngineSlots(player);
}

export function summarizeHeat(player: PlayerState, courseCapacity: number): HeatSummary {
  const inHand = player.hand.filter(isHeatCard).length;
  const inDeck = player.deck.filter(isHeatCard).length;
  const inDiscard = player.discard.filter(isHeatCard).length;
  const inPlayed = player.played.filter(isHeatCard).length;
  const total = player.engine.length + inHand + inDeck + inDiscard + inPlayed;
  const extraDeckCards = countExtraEngineSlots(player);
  return {
    engine: player.engine.length,
    courseCapacity,
    engineCapacity: courseCapacity + extraDeckCards,
    total,
    available: player.engine.length + inHand + inDeck,
    inHand,
    inDeck,
    inDiscard,
    inPlayed,
    extraDeckCards,
    startingHeatLocation: startingHeatLocation(player),
  };
}
