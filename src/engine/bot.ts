import { applyGameAction } from './engine';
import type { Card, GameAction, GameState, PlayerState, RandomSource } from './types';

const BOT_ACTION_LIMIT = 2_000;

function isBot(player: PlayerState): boolean {
  return player.controller === 'BOT';
}

function estimatedSpeed(card: Card): number {
  if (card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE') {
    return card.value ?? 0;
  }
  if (card.kind === 'STRESS') return 2.5;
  return 0;
}

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (values.length < count) return [];
  const result: T[][] = [];
  values.forEach((value, index) => {
    for (const tail of combinations(values.slice(index + 1), count - 1)) {
      result.push([value, ...tail]);
    }
  });
  return result;
}

function legalGear(player: PlayerState, gear: number): boolean {
  const delta = Math.abs(gear - player.gear);
  return delta <= 1 || (delta === 2 && player.engine.length > 0);
}

function planScore(state: GameState, player: PlayerState, gear: number, cards: Card[]): number {
  const speed = cards.reduce((sum, card) => sum + estimatedSpeed(card), 0);
  const nextCorner = state.track.corners.find((corner) => corner.lineSpace > player.position.space);
  const crossesCorner = nextCorner && player.position.space + speed >= nextCorner.lineSpace;
  const shiftHeat = Math.abs(gear - player.gear) === 2 ? 1 : 0;
  const availableHeat = Math.max(0, player.engine.length - shiftHeat);
  const overage = crossesCorner ? Math.max(0, speed - nextCorner.speedLimit) : 0;
  const unaffordablePenalty = overage > availableHeat ? 1_000 : 0;
  const heatPenalty = overage * 3 + shiftHeat * 2;
  const stressPenalty = cards.filter((card) => card.kind === 'STRESS').length * 0.15;
  return speed - heatPenalty - stressPenalty - unaffordablePenalty + gear * 0.01;
}

export function chooseBotPlan(state: GameState, playerId: string): GameAction {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || !isBot(player)) throw new Error('A bot plan requires a bot player.');
  if (state.phase !== 'PLANNING' || state.submitted[playerId]) {
    throw new Error('This bot cannot plan right now.');
  }

  const playable = player.hand.filter(
    (card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT',
  );
  const heat = player.hand.filter((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT');
  const candidates: Array<{ gear: number; cards: Card[]; score: number }> = [];

  for (let gear = 1; gear <= 4; gear += 1) {
    if (!legalGear(player, gear)) continue;
    const playableCount = Math.min(gear, playable.length);
    const heatCount = gear - playableCount;
    if (heatCount > heat.length) continue;
    const cardSets = combinations(playable, playableCount).flatMap((selectedPlayable) =>
      combinations(heat, heatCount).map((selectedHeat) => [...selectedPlayable, ...selectedHeat]),
    );
    cardSets.forEach((cards) => {
      candidates.push({ gear, cards, score: planScore(state, player, gear, cards) });
    });
  }

  const best = candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.gear - left.gear ||
      left.cards
        .map((card) => card.id)
        .join()
        .localeCompare(right.cards.map((card) => card.id).join()),
  )[0];
  if (!best) throw new Error('The bot has no legal plan.');
  return {
    type: 'SUBMIT_PLAN',
    playerId,
    gear: best.gear,
    cardIds: best.cards.map((card) => card.id),
  };
}

export function chooseBotReaction(state: GameState, playerId: string): GameAction | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const pending = state.pending;
  if (!player || !isBot(player) || !pending || pending.playerId !== playerId) return null;

  const options = pending.options;
  const hasHeatInHand = player.hand.some(
    (card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT',
  );
  if (options.includes('ADRENALINE_COOLDOWN') && hasHeatInHand) {
    return { type: 'ADRENALINE_COOLDOWN', playerId };
  }
  if (options.includes('ADRENALINE_SPEED')) return { type: 'ADRENALINE_SPEED', playerId };
  if (options.includes('COOLDOWN') && hasHeatInHand) return { type: 'COOLDOWN', playerId };
  if (options.includes('SLIPSTREAM')) return { type: 'SLIPSTREAM', playerId };
  if (options.includes('BOOST') && player.engine.length > 2) return { type: 'BOOST', playerId };
  if (options.includes('PASS_REACTION')) return { type: 'PASS_REACTION', playerId };
  return null;
}

export function advanceBotTurns(input: GameState, random: RandomSource = Math.random): GameState {
  let state = input;
  for (let index = 0; index < BOT_ACTION_LIMIT; index += 1) {
    if (state.phase === 'FINISHED') return state;
    if (state.phase === 'PLANNING') {
      const bot = state.players.find(
        (player) => isBot(player) && !player.finished && !state.submitted[player.id],
      );
      if (!bot) return state;
      state = applyGameAction(state, chooseBotPlan(state, bot.id), random);
      continue;
    }
    const activeBot = state.activePlayerId
      ? state.players.find((player) => player.id === state.activePlayerId && isBot(player))
      : null;
    if (!activeBot) return state;
    const reaction = chooseBotReaction(state, activeBot.id);
    if (!reaction) return state;
    state = applyGameAction(state, reaction, random);
  }
  throw new Error('Bot action limit exceeded; the race may be deadlocked.');
}
