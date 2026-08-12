import { USA_ENGINE_HEAT } from './constants';
import { applyGameAction } from './engine';
import { engineHeatCapacityForPlayer } from './heat';
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

function availableHeat(player: PlayerState): number {
  return (
    player.engine.length +
    player.hand.filter((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT').length +
    player.deck.filter((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT').length
  );
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

function raceProgress(state: GameState, player: PlayerState): number {
  const startingSpace = Math.min(0, ...state.track.grid.map((position) => position.space));
  return Math.max(
    0,
    Math.min(
      1,
      (player.position.space - startingSpace) /
        Math.max(1, state.track.finishSpace - startingSpace),
    ),
  );
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

function projectedNextHand(player: PlayerState, cards: Card[]): Card[] {
  const selectedIds = new Set(cards.map((card) => card.id));
  const remainingHand = player.hand.filter((card) => !selectedIds.has(card.id));
  const drawCount = Math.min(cards.length, player.deck.length);
  const drawn = player.deck.slice(Math.max(0, player.deck.length - drawCount));
  return [...remainingHand, ...drawn];
}

function expectedCardSpeed(card: Card, player: PlayerState): number {
  return isSpeedCard(card)
    ? (card.value ?? 0)
    : card.kind === 'STRESS'
      ? expectedStressSpeed(player)
      : 0;
}

function expectedSpeedForGear(player: PlayerState, gear: number): number {
  const playable = player.hand
    .filter((card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT')
    .sort((left, right) => expectedCardSpeed(right, player) - expectedCardSpeed(left, player));
  if (playable.length < gear) return 0;
  return playable
    .slice(0, gear)
    .reduce((total, card) => total + expectedCardSpeed(card, player), 0);
}

function nextTurnProjection(
  state: GameState,
  player: PlayerState,
  gear: number,
  cards: Card[],
  landing: PlayerState['position'],
  currentHeatCost: number,
): { speed: number; heatCost: number; heatAvailable: number } {
  const shiftHeat = Math.abs(gear - player.gear) === 2 ? 1 : 0;
  const projectedEngine = Math.max(0, player.engine.length - shiftHeat - currentHeatCost);
  const projectedPlayer: PlayerState = {
    ...player,
    gear,
    position: landing,
    hand: projectedNextHand(player, cards),
    engine: player.engine.slice(0, projectedEngine),
  };
  const nextGearCandidates = [1, 2, 3, 4].filter((nextGear) =>
    legalGear(projectedPlayer, nextGear),
  );
  const speed = Math.max(
    0,
    ...nextGearCandidates.map((nextGear) => expectedSpeedForGear(projectedPlayer, nextGear)),
  );
  const heatCost = cornerHeatCost(state, landing.space, landing.space + speed, speed);
  const heatAvailableAfter = Math.max(
    0,
    availableHeat(player) -
      shiftHeat -
      currentHeatCost -
      cards.filter((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT').length,
  );
  return { speed, heatCost, heatAvailable: heatAvailableAfter };
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
  const desiredSpace = player.position.space + speed;
  const blockedSpaces = Math.max(0, desiredSpace - landing.space);
  const heatCost = cornerHeatCost(state, player.position.space, landing.space, speed);
  const reachesFinish = landing.space > state.track.finishSpace;
  const finishMargin = Math.max(0, landing.space - state.track.finishSpace);
  const progress = raceProgress(state, player);
  const earlyHeatConservation = 1 - progress;
  const projectedNext = nextTurnProjection(state, player, gear, cards, landing, heatCost);

  let score = (landing.space - player.position.space) * 16;
  score += speed * 0.2;
  score -= blockedSpaces * 14;
  // Heat is a resource to protect early and spend late. This also makes a
  // two-position shift carry a real early-race opportunity cost.
  score -= heatCost * (8 + earlyHeatConservation * 28);
  score -= shiftHeat * (5 + earlyHeatConservation * 22);
  score -= stressCount * 1.5;
  score -= heatCount * (12 + earlyHeatConservation * 24);
  if (cluttered) score -= 20;
  if (heatCost > availableHeat) score -= 10_000 + (heatCost - availableHeat) * 100;
  else if (heatCost === availableHeat && !reachesFinish) score -= 8;
  // Look one turn ahead: prefer a current gear that leaves a strong legal
  // next gear and enough Heat for the next corner.
  score += projectedNext.speed * 3.5;
  if (projectedNext.heatCost > projectedNext.heatAvailable) {
    score -=
      (projectedNext.heatCost - projectedNext.heatAvailable) * (12 + earlyHeatConservation * 20);
  }
  if (reachesFinish) {
    score += 100_000 + finishMargin * 2_000;
    // Near the finish, use the remaining available Heat instead of carrying
    // it past the line. This is intentionally a preference, not an illegal
    // guarantee: a Heat card still buried in the deck may be unreachable.
    score -= projectedNext.heatAvailable * (120 + progress * 1_000);
  } else if (progress > 0.7) {
    score -= projectedNext.heatAvailable * (progress - 0.7) * 80;
  }
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
  const heatSpent = Math.max(0, availableHeat(beforePlayer) - availableHeat(afterPlayer));
  const progress = raceProgress(before, beforePlayer);
  const reachedFinish =
    afterPlayer.position.space > after.track.finishSpace || afterPlayer.finishProgress !== null;
  const finishMargin = Math.max(
    0,
    (afterPlayer.finishProgress ?? afterPlayer.position.space) - after.track.finishSpace,
  );
  let score = movement * 18 + clearedHeat * 10;

  if (reachedFinish) {
    score += 100_000 + finishMargin * 2_000;
    score += heatSpent * 250;
    score -= availableHeat(afterPlayer) * (200 + finishMargin * 50);
  } else {
    score -= heatSpent * (10 + (1 - progress) * 24);
  }
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
        return (
          heatInHand(player) > 0 &&
          player.engine.length <
            engineHeatCapacityForPlayer(player, state.track.engineHeatCapacity ?? USA_ENGINE_HEAT)
        );
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
    if (state.phase === 'FINISHED') return state;
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
