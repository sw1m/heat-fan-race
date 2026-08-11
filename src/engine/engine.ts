import { USA_BEGINNER_TRACK, USA_ENGINE_HEAT, STARTING_HAND_SIZE } from './constants';
import { createBeginnerDeck, drawCards, replenishHand, shuffle } from './deck';
import {
  crossedCorners,
  chooseLandingPosition,
  isAdjacentOrBehind,
  orderedPlayers,
  positionSort,
} from './track';
import type { Card, GameAction, GameLogEntry, GameState, PlayerState, RandomSource } from './types';

const now = () => Date.now();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function log(state: GameState, text: string, playerId?: string): void {
  const entry: GameLogEntry = {
    id: `${state.round}-${state.log.length + 1}`,
    round: state.round,
    text,
    playerId,
  };
  state.log = [entry, ...state.log].slice(0, 80);
}

function findPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error('Player is not in this race.');
  return player;
}

function payHeat(player: PlayerState): boolean {
  const heat = player.engine.pop();
  if (!heat) return false;
  player.discard.push(heat);
  return true;
}

function addHeatToEngine(player: PlayerState, count: number): number {
  let moved = 0;
  for (let index = player.hand.length - 1; index >= 0 && moved < count; index -= 1) {
    if (player.hand[index].kind === 'HEAT' || player.hand[index].kind === 'STARTING_HEAT') {
      player.engine.push(player.hand.splice(index, 1)[0]);
      moved += 1;
    }
  }
  return moved;
}

function cardInHand(player: PlayerState, cardId: string): boolean {
  return player.hand.some((card) => card.id === cardId);
}

function basicSpeed(card: Card): number {
  return card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE'
    ? (card.value ?? 0)
    : 0;
}

function isBasicSpeed(card: Card): boolean {
  return card.kind === 'BASIC';
}

function discardPlayedCards(player: PlayerState): number {
  const discarded = player.played.length;
  if (discarded > 0) player.discard.push(...player.played.splice(0));
  return discarded;
}

function revealBasicSpeed(player: PlayerState, random: RandomSource): number {
  while (true) {
    if (player.deck.length === 0 && player.discard.length > 0) {
      player.deck = shuffle(player.discard, random);
      player.discard = [];
    }
    const card = player.deck.pop();
    if (!card) return 0;
    if (isBasicSpeed(card)) {
      player.played.push(card);
      return basicSpeed(card);
    }
    player.discard.push(card);
  }
}

function movePlayer(
  state: GameState,
  player: PlayerState,
  movement: number,
): { start: number; end: number } {
  const start = player.position.space;
  player.position = chooseLandingPosition(
    state.players,
    player.position,
    movement,
    state.track,
    player.id,
  );
  return { start, end: player.position.space };
}

function availableAdrenaline(state: GameState, playerId: string): boolean {
  return state.adrenalineEligibleIds.includes(playerId);
}

function startPlayerResolution(state: GameState, playerId: string, random: RandomSource): void {
  const player = findPlayer(state, playerId);
  const plan = state.submitted[playerId];
  if (!plan) throw new Error('This player has not submitted a plan.');
  state.activePlayerId = playerId;
  state.phase = 'PLAYER_REACTION';
  const selected: Card[] = [];
  for (const cardId of plan.cardIds) {
    const cardIndex = player.hand.findIndex((card) => card.id === cardId);
    if (cardIndex < 0) throw new Error('A submitted card is no longer in the player hand.');
    selected.push(player.hand.splice(cardIndex, 1)[0]);
  }
  player.played.push(...selected);
  const cluttered = selected.some((card) => card.kind === 'HEAT');
  if (cluttered) {
    player.gear = 1;
    discardPlayedCards(player);
    log(state, `${player.name} had a cluttered hand and stays put in 1st gear.`, player.id);
    finishPlayerTurn(state, random);
    return;
  }
  let speed = 0;
  for (const card of selected) {
    if (card.kind === 'STRESS') speed += revealBasicSpeed(player, random);
    else speed += basicSpeed(card);
  }
  const moved = movePlayer(state, player, speed);
  const corners = crossedCorners(state.track, moved.start, moved.end);
  const adrenaline = availableAdrenaline(state, player.id);
  state.pending = {
    kind: adrenaline ? 'ADRENALINE' : 'GEAR_REACTION',
    playerId: player.id,
    options: adrenaline ? ['ADRENALINE_SPEED', 'ADRENALINE_COOLDOWN', 'PASS_REACTION'] : [],
    speed,
    startSpace: moved.start,
    movedSpace: moved.end,
    adrenalineSpeedAvailable: adrenaline,
    adrenalineCooldownAvailable: adrenaline,
    boostAvailable: player.gear >= 3 && player.engine.length > 0,
    cooldownAvailable: player.gear === 1 ? 3 : player.gear === 2 ? 1 : 0,
    slipstreamAvailable:
      isAdjacentOrBehind(state.players, player) && moved.end < state.track.finishSpace,
    crossedCornerIds: corners.map((corner) => corner.id),
  };
  log(
    state,
    `${player.name} reveals speed ${speed} and moves to space ${player.position.space}.`,
    player.id,
  );
  if (!adrenaline) openGearReaction(state);
}

function openGearReaction(state: GameState): void {
  const pending = state.pending;
  if (!pending) return;
  const player = findPlayer(state, pending.playerId);
  pending.kind = 'GEAR_REACTION';
  pending.options = ['PASS_REACTION'];
  if (pending.boostAvailable) pending.options.unshift('BOOST');
  if (
    pending.cooldownAvailable > 0 &&
    player.hand.some((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT')
  ) {
    pending.options.unshift('COOLDOWN');
  }
  if (pending.slipstreamAvailable) pending.options.unshift('SLIPSTREAM');
}

function refreshCrossedCorners(state: GameState): void {
  if (!state.pending) return;
  state.pending.crossedCornerIds = crossedCorners(
    state.track,
    state.pending.startSpace,
    state.pending.movedSpace,
  ).map((corner) => corner.id);
}

function applyCornerChecks(
  state: GameState,
  player: PlayerState,
  speed: number,
  random: RandomSource,
): void {
  const pending = state.pending;
  const corners = pending
    ? state.track.corners.filter((corner) => pending.crossedCornerIds.includes(corner.id))
    : [];
  for (const corner of corners) {
    const over = Math.max(0, speed - corner.speedLimit);
    if (over === 0) {
      log(state, `${player.name} clears ${corner.label} at the limit.`, player.id);
      continue;
    }
    let paid = 0;
    while (paid < over && payHeat(player)) paid += 1;
    if (paid === over) {
      log(state, `${player.name} pays ${over} Heat at ${corner.label}.`, player.id);
      continue;
    }
    const originalGear = player.gear;
    player.engine = [];
    player.gear = 1;
    player.position = chooseLandingPosition(
      state.players,
      { space: corner.lineSpace - 1, lane: player.position.lane },
      0,
      state.track,
      player.id,
    );
    const stressCount = originalGear >= 3 ? 2 : 1;
    for (let index = 0; index < stressCount; index += 1)
      player.hand.push({ id: `${player.id}-spin-stress-${state.round}-${index}`, kind: 'STRESS' });
    discardPlayedCards(player);
    log(
      state,
      `${player.name} spins out at ${corner.label}, resets to 1st gear, and takes ${stressCount} Stress.`,
      player.id,
    );
    break;
  }
  player.finished = player.position.space >= state.track.finishSpace;
  if (player.finished) log(state, `${player.name} crosses the finish line.`, player.id);
  void random;
}

function finishPlayerTurn(state: GameState, random: RandomSource): void {
  const player = state.activePlayerId ? findPlayer(state, state.activePlayerId) : null;
  if (!player) return;
  if (state.pending && state.pending.kind !== 'ADRENALINE')
    applyCornerChecks(state, player, state.pending.speed, random);
  const discarded = discardPlayedCards(player);
  const drawn = replenishHand(player, random);
  if (discarded > 0 || drawn > 0) {
    log(
      state,
      `${player.name} discards ${discarded} played card${discarded === 1 ? '' : 's'} and draws ${drawn} back to a hand of ${player.hand.length}.`,
      player.id,
    );
  }
  state.pending = null;
  const nextIndex = state.resolutionIndex + 1;
  if (nextIndex < state.resolutionOrder.length) {
    state.resolutionIndex = nextIndex;
    startPlayerResolution(state, state.resolutionOrder[nextIndex], random);
    return;
  }
  state.phase = 'ROUND_CLEANUP';
  const justFinished = state.players
    .filter((candidate) => candidate.finished && candidate.finishRank === null)
    .sort(positionSort);
  const alreadyRanked = state.players.filter((candidate) => candidate.finishRank !== null).length;
  justFinished.forEach((candidate, index) => {
    candidate.finishRank = alreadyRanked + index + 1;
  });
  if (state.players.every((candidate) => candidate.finished)) {
    state.winnerId =
      [...state.players].sort((a, b) => (a.finishRank ?? 99) - (b.finishRank ?? 99))[0]?.id ?? null;
    state.phase = 'FINISHED';
    state.activePlayerId = null;
    log(state, 'The race is finished. Final standings are locked.');
    return;
  }
  beginPlanning(state, random);
}

function beginPlanning(state: GameState, random: RandomSource): void {
  state.round += 1;
  state.phase = 'PLANNING';
  state.activePlayerId = null;
  state.resolutionIndex = 0;
  state.resolutionOrder = [];
  state.submitted = {};
  const active = state.players.filter((player) => !player.finished);
  const ordered = [...active].sort(positionSort);
  state.adrenalineEligibleIds = ordered.length > 0 ? [ordered[ordered.length - 1].id] : [];
  log(state, `Round ${state.round}: shift gears and choose cards simultaneously.`);
  void random;
}

function allSubmitted(state: GameState): boolean {
  return state.players
    .filter((player) => !player.finished)
    .every((player) => Boolean(state.submitted[player.id]));
}

function submitPlan(
  state: GameState,
  playerId: string,
  gear: number,
  cardIds: string[],
  random: RandomSource,
): void {
  if (state.phase !== 'PLANNING') throw new Error('Plans are not open right now.');
  const player = findPlayer(state, playerId);
  if (player.finished) throw new Error('Finished players cannot submit a plan.');
  if (state.submitted[playerId]) throw new Error('This player already submitted a plan.');
  if (!Number.isInteger(gear) || gear < 1 || gear > 4)
    throw new Error('Gear must be between 1 and 4.');
  const delta = Math.abs(gear - player.gear);
  if (delta > 1 && delta !== 2) throw new Error('Normal shifting changes one position.');
  if (delta === 2 && player.engine.length === 0)
    throw new Error('Two-position shifting costs 1 Heat.');
  if (delta === 2 && !payHeat(player)) throw new Error('Two-position shifting costs 1 Heat.');
  if (new Set(cardIds).size !== cardIds.length)
    throw new Error('A card can only be selected once.');
  if (cardIds.length !== gear) throw new Error(`Gear ${gear} requires exactly ${gear} cards.`);
  const playableCount = player.hand.filter(
    (card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT',
  ).length;
  const includesOnlyOwned = cardIds.every((cardId) => cardInHand(player, cardId));
  if (!includesOnlyOwned) throw new Error('You can only play cards from your own hand.');
  const heatPlaceholders = cardIds.filter(
    (cardId) =>
      player.hand.find((card) => card.id === cardId)?.kind === 'HEAT' ||
      player.hand.find((card) => card.id === cardId)?.kind === 'STARTING_HEAT',
  ).length;
  if (heatPlaceholders > 0 && playableCount >= gear)
    throw new Error('Heat cards cannot be played while enough playable cards are available.');
  player.gear = gear;
  state.submitted[playerId] = { gear, cardIds, submittedAt: now() };
  log(
    state,
    `${player.name} locked in ${gear} card${gear === 1 ? '' : 's'} in gear ${gear}.`,
    player.id,
  );
  if (!allSubmitted(state)) return;
  state.resolutionOrder = orderedPlayers(state.players).map((candidate) => candidate.id);
  state.resolutionIndex = 0;
  state.phase = 'RESOLVING_PLAYER';
  startPlayerResolution(state, state.resolutionOrder[0], random);
}

export function createInitialGame(
  playerSpecs: Array<{
    id: string;
    name: string;
    seat: number;
    color: string;
    controller?: 'HUMAN' | 'BOT';
  }>,
  random: RandomSource = Math.random,
): GameState {
  const players: PlayerState[] = playerSpecs.map((spec, index) => {
    const deck = shuffle(createBeginnerDeck(spec.id), random);
    const player: PlayerState = {
      ...spec,
      gear: 1,
      position: USA_BEGINNER_TRACK.grid[index] ?? { space: -2, lane: (index % 2) as 0 | 1 },
      hand: [],
      deck,
      discard: [],
      engine: Array.from({ length: USA_ENGINE_HEAT }, (_, heatIndex) => ({
        id: `${spec.id}-engine-heat-${heatIndex}`,
        kind: 'HEAT' as const,
      })),
      played: [],
      finished: false,
      finishRank: null,
    };
    drawCards(player, STARTING_HAND_SIZE, random);
    return player;
  });
  const state: GameState = {
    version: 1,
    phase: 'PLANNING',
    round: 1,
    track: USA_BEGINNER_TRACK,
    players,
    resolutionOrder: [],
    resolutionIndex: 0,
    activePlayerId: null,
    submitted: {},
    adrenalineEligibleIds: [],
    pending: null,
    nextCardId: 1,
    winnerId: null,
    log: [],
  };
  const ordered = orderedPlayers(state.players);
  state.adrenalineEligibleIds = ordered.length > 0 ? [ordered[ordered.length - 1].id] : [];
  log(state, 'Race ready: everyone starts in 1st gear with seven cards.');
  return state;
}

export function applyGameAction(
  input: GameState,
  action: GameAction,
  random: RandomSource = Math.random,
): GameState {
  const state = clone(input);
  const player = findPlayer(state, action.playerId);
  if (
    state.activePlayerId &&
    action.playerId !== state.activePlayerId &&
    action.type !== 'SUBMIT_PLAN'
  ) {
    throw new Error('It is not this player’s reaction.');
  }
  switch (action.type) {
    case 'SUBMIT_PLAN':
      submitPlan(state, action.playerId, action.gear, action.cardIds, random);
      return state;
    case 'ADRENALINE_SPEED':
      if (
        !state.pending ||
        state.pending.kind !== 'ADRENALINE' ||
        !state.pending.adrenalineSpeedAvailable
      )
        throw new Error('Adrenaline speed is unavailable.');
      state.pending.adrenalineSpeedAvailable = false;
      state.pending.speed += 1;
      movePlayer(state, player, 1);
      state.pending.movedSpace = player.position.space;
      refreshCrossedCorners(state);
      state.pending.options = state.pending.options.filter(
        (option) => option !== 'ADRENALINE_SPEED',
      );
      log(state, `${player.name} uses Adrenaline for +1 speed.`, player.id);
      openGearReaction(state);
      return state;
    case 'ADRENALINE_COOLDOWN':
      if (
        !state.pending ||
        state.pending.kind !== 'ADRENALINE' ||
        !state.pending.adrenalineCooldownAvailable
      )
        throw new Error('Adrenaline cooldown is unavailable.');
      state.pending.adrenalineCooldownAvailable = false;
      addHeatToEngine(player, 1);
      state.pending.options = state.pending.options.filter(
        (option) => option !== 'ADRENALINE_COOLDOWN',
      );
      log(state, `${player.name} uses Adrenaline to cool down 1 Heat.`, player.id);
      openGearReaction(state);
      return state;
    case 'BOOST': {
      if (!state.pending || state.pending.kind !== 'GEAR_REACTION' || !state.pending.boostAvailable)
        throw new Error('Boost is unavailable.');
      if (!payHeat(player)) throw new Error('Boost requires 1 Heat in the engine.');
      const boostSpeed = revealBasicSpeed(player, random);
      const boostMove = movePlayer(state, player, boostSpeed);
      state.pending.speed += boostSpeed;
      state.pending.movedSpace = boostMove.end;
      refreshCrossedCorners(state);
      state.pending.boostAvailable = false;
      log(state, `${player.name} boosts for +${boostSpeed} speed.`, player.id);
      openGearReaction(state);
      return state;
    }
    case 'COOLDOWN': {
      if (
        !state.pending ||
        state.pending.kind !== 'GEAR_REACTION' ||
        state.pending.cooldownAvailable <= 0
      )
        throw new Error('Cooldown is unavailable.');
      const cooled = addHeatToEngine(player, state.pending.cooldownAvailable);
      state.pending.cooldownAvailable = 0;
      log(state, `${player.name} cools ${cooled} Heat back into the engine.`, player.id);
      openGearReaction(state);
      return state;
    }
    case 'SLIPSTREAM':
      if (
        !state.pending ||
        state.pending.kind !== 'GEAR_REACTION' ||
        !state.pending.slipstreamAvailable
      )
        throw new Error('Slipstream is unavailable.');
      if (player.position.space + 2 >= state.track.finishSpace)
        throw new Error('Slipstream cannot cross the finish line.');
      movePlayer(state, player, 2);
      state.pending.movedSpace = player.position.space;
      refreshCrossedCorners(state);
      state.pending.slipstreamAvailable = false;
      log(state, `${player.name} slipstreams 2 spaces.`, player.id);
      openGearReaction(state);
      return state;
    case 'PASS_REACTION':
      if (!state.pending) throw new Error('There is no reaction to pass.');
      if (state.pending.kind === 'ADRENALINE') openGearReaction(state);
      else finishPlayerTurn(state, random);
      return state;
  }
}

export function getPublicState(
  state: GameState,
  viewerId: string,
): Omit<GameState, 'players' | 'submitted'> & {
  submitted: Record<string, boolean>;
  players: Array<
    Omit<PlayerState, 'hand' | 'deck' | 'discard' | 'engine' | 'played'> & {
      handCount: number;
      deckCount: number;
      discardCount: number;
      engineHeat: number;
      submitted: boolean;
    }
  >;
} {
  void viewerId;
  return {
    ...state,
    submitted: Object.fromEntries(
      state.players.map((player) => [player.id, Boolean(state.submitted[player.id])]),
    ),
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      seat: player.seat,
      gear: player.gear,
      position: player.position,
      finished: player.finished,
      finishRank: player.finishRank,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      discardCount: player.discard.length,
      engineHeat: player.engine.length,
      submitted: Boolean(state.submitted[player.id]),
    })),
  };
}
