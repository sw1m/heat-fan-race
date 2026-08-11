import { USA_ENGINE_HEAT } from './constants';
import { applyGameAction } from './engine';
import { chooseLandingPosition, crossedCorners } from './track';
import type { Card, GameAction, GameState, PlayerState, RandomSource } from './types';

const BOT_ACTION_LIMIT = 2_000;
const PREVIEW_RANDOM: RandomSource = () => 0.5;

function isBot(player: PlayerState): boolean {
  return player.controller === 'BOT';
}

function humansHaveSubmitted(state: GameState): boolean {
  return state.players
    .filter((player) => !isBot(player) && !player.finished)
    .every((player) => Boolean(state.submitted[player.id]));
}

function isSpeedCard(card: Card): boolean {
  return card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE';
}

function heatInHand(player: PlayerState): number {
  return player.hand.filter((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT').length;
}

function expectedStressSpeed(player: PlayerState): number {
  const knownBasic = [...player.deck, ...player.discard].filter((card) => card.kind === 'BASIC');
  if (knownBasic.length === 0) return 2.5;
  return knownBasic.reduce((total, card) => total + (card.value ?? 0), 0) / knownBasic.length;
}

function estimatedSpeed(card: Card, player: PlayerState): number {
  if (isSpeedCard(card)) return card.value ?? 0;
  if (card.kind === 'STRESS') return expectedStressSpeed(player);
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

function cornerHeatCost(
  state: GameState,
  fromSpace: number,
  toSpace: number,
  speed: number,
): number {
  return crossedCorners(state.track, fromSpace, toSpace).reduce(
    (total, corner) => total + Math.max(0, speed - corner.speedLimit),
    0,
  );
}

function planScore(state: GameState, player: PlayerState, gear: number, cards: Card[]): number {
  const shiftHeat = Math.abs(gear - player.gear) === 2 ? 1 : 0;
  const availableHeat = Math.max(0, player.engine.length - shiftHeat);
  const stressCount = cards.filter((card) => card.kind === 'STRESS').length;
  const heatCount = cards.filter(
    (card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT',
  ).length;
  const cluttered = heatCount > 0 && cards.length - heatCount < gear;
  const speed = cluttered ? 0 : cards.reduce((sum, card) => sum + estimatedSpeed(card, player), 0);
  const landing = chooseLandingPosition(
    state.players,
    player.position,
    speed,
    state.track,
    player.id,
  );
  const desiredSpace = Math.min(state.track.finishSpace, player.position.space + speed);
  const blockedSpaces = Math.max(0, desiredSpace - landing.space);
  const heatCost = cornerHeatCost(state, player.position.space, landing.space, speed);
  const reachesFinish = desiredSpace >= state.track.finishSpace;

  let score = (landing.space - player.position.space) * 16;
  score += speed * 0.2;
  score -= blockedSpaces * 14;
  score -= heatCost * 8;
  score -= shiftHeat * 5;
  score -= stressCount * 1.5;
  score -= heatCount * 12;
  if (cluttered) score -= 20;
  if (heatCost > availableHeat) score -= 10_000 + (heatCost - availableHeat) * 100;
  else if (heatCost === availableHeat && !reachesFinish) score -= 8;
  if (reachesFinish) score += 100_000;
  if (landing.space === player.position.space && speed > 0) score -= 20;
  return score;
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

function reactionAction(playerId: string, option: string): GameAction | null {
  switch (option) {
    case 'ADRENALINE_SPEED':
      return { type: 'ADRENALINE_SPEED', playerId };
    case 'ADRENALINE_COOLDOWN':
      return { type: 'ADRENALINE_COOLDOWN', playerId };
    case 'BOOST':
      return { type: 'BOOST', playerId };
    case 'COOLDOWN':
      return { type: 'COOLDOWN', playerId };
    case 'SLIPSTREAM':
      return { type: 'SLIPSTREAM', playerId };
    case 'PASS_REACTION':
      return { type: 'PASS_REACTION', playerId };
    default:
      return null;
  }
}

function reactionScore(
  before: GameState,
  action: GameAction,
  after: GameState,
  playerId: string,
): number {
  const beforePlayer = before.players.find((player) => player.id === playerId)!;
  const afterPlayer = after.players.find((player) => player.id === playerId)!;
  const movement = afterPlayer.position.space - beforePlayer.position.space;
  const clearedHeat = heatInHand(beforePlayer) - heatInHand(afterPlayer);
  const reachedFinish =
    afterPlayer.position.space >= after.track.finishSpace || afterPlayer.finishProgress !== null;
  let score = movement * 18 + clearedHeat * 10;

  if (reachedFinish) score += 100_000;
  if (after.pending?.playerId === playerId) {
    const cornerCost = cornerHeatCost(
      after,
      after.pending.startSpace,
      after.pending.movedSpace,
      after.pending.speed,
    );
    score -= cornerCost * 8;
    if (cornerCost > afterPlayer.engine.length) score -= 10_000;
  }

  switch (action.type) {
    case 'BOOST':
      score -= 10 + (afterPlayer.engine.length < 2 ? 12 : 0);
      if (movement <= 0) score -= 30;
      break;
    case 'COOLDOWN':
    case 'ADRENALINE_COOLDOWN':
      score += 8;
      break;
    case 'ADRENALINE_SPEED':
      score += 2;
      break;
    case 'SLIPSTREAM':
      score += 5;
      break;
    default:
      break;
  }
  return score;
}

export function chooseBotReaction(state: GameState, playerId: string): GameAction | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const pending = state.pending;
  if (!player || !isBot(player) || !pending || pending.playerId !== playerId) return null;

  const candidates = pending.options
    .map((option) => reactionAction(playerId, option))
    .filter((action): action is GameAction => Boolean(action))
    .filter((action) => {
      if (action.type === 'COOLDOWN' || action.type === 'ADRENALINE_COOLDOWN') {
        return heatInHand(player) > 0 && player.engine.length < USA_ENGINE_HEAT;
      }
      if (action.type === 'BOOST') return player.engine.length > 0;
      return true;
    })
    .map((action) => {
      try {
        const after = applyGameAction(state, action, PREVIEW_RANDOM);
        return { action, score: reactionScore(state, action, after, playerId) };
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is { action: GameAction; score: number } => Boolean(candidate));

  if (candidates.length === 0) return null;
  const best = candidates.sort(
    (left, right) => right.score - left.score || left.action.type.localeCompare(right.action.type),
  )[0];
  return best.action;
}

export function advanceBotTurns(input: GameState, random: RandomSource = Math.random): GameState {
  let state = input;
  for (let index = 0; index < BOT_ACTION_LIMIT; index += 1) {
    if (state.phase === 'FINISHED' || state.winnerId !== null) return state;
    if (state.phase === 'PLANNING') {
      if (!humansHaveSubmitted(state)) return state;
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
