import type { Card, PlayerState } from './types';

export function isHeatCard(card: Card): boolean {
  return card.kind === 'HEAT' || card.kind === 'STARTING_HEAT';
}

export interface HeatSummary {
  engine: number;
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
 * Heat has two different limits in the basic game: the course supplies a
 * fixed number of engine slots, while a player's deck may contain additional
 * Heat cards outside those slots.
 *
 * `available` is Heat currently in the engine, hand, or draw pile. Cards in
 * discard/played are not immediately available to Cooldown or payment.
 */
export function summarizeHeat(player: PlayerState, engineCapacity: number): HeatSummary {
  const inHand = player.hand.filter(isHeatCard).length;
  const inDeck = player.deck.filter(isHeatCard).length;
  const inDiscard = player.discard.filter(isHeatCard).length;
  const inPlayed = player.played.filter(isHeatCard).length;
  const total = player.engine.length + inHand + inDeck + inDiscard + inPlayed;
  return {
    engine: player.engine.length,
    engineCapacity,
    total,
    available: player.engine.length + inHand + inDeck,
    inHand,
    inDeck,
    inDiscard,
    inPlayed,
    extraDeckCards: Math.max(0, total - engineCapacity),
    startingHeatLocation: startingHeatLocation(player),
  };
}
