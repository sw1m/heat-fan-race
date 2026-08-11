import type { Card } from '../engine/types';

export type HandSortMode = 'MANUAL' | 'NUMERICAL';

function cardCategory(card: Card): number {
  if (card.kind === 'HEAT' || card.kind === 'STARTING_HEAT') return 1_000;
  if (card.kind === 'STRESS') return 1_001;
  return card.value ?? 0;
}

export function sortCardsNumerically(cards: readonly Card[]): Card[] {
  return [...cards].sort(
    (left, right) =>
      cardCategory(left) - cardCategory(right) ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  );
}

export function reconcileCardOrder(order: readonly string[], cards: readonly Card[]): string[] {
  const ids = cards.map((card) => card.id);
  const existing = order.filter((id) => ids.includes(id));
  return [...existing, ...ids.filter((id) => !existing.includes(id))];
}

export function moveCardInOrder(
  order: readonly string[],
  draggedId: string,
  targetId: string,
): string[] {
  if (draggedId === targetId) return [...order];
  const next = order.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return [...order];
  next.splice(targetIndex, 0, draggedId);
  return next;
}

