import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_HAND_SIZE,
  USA_BEGINNER_TRACK,
  USA_ENGINE_HEAT,
} from './constants';
import { createBeginnerDeck, drawCards, replenishHand, shuffle } from './deck';
import { engineHeatCapacityForPlayer, isHeatCard } from './heat';
import {
  crossedCorners,
  chooseLandingPosition,
  chooseSpinoutPosition,
  finishSort,
  isAdjacentOrBehind,
  orderedPlayers,
  positionSort,
} from './track';
import type {
  Card,
  GameAction,
  GameLogEntry,
  GameState,
  PendingReaction,
  PlayerState,
  RandomSource,
} from './types';

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
  state.log = [entry, ...state.log];
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

function courseHeatCapacity(state: GameState): number {
  return state.track.engineHeatCapacity ?? USA_ENGINE_HEAT;
}

function engineCapacity(state: GameState, player: PlayerState): number {
  return engineHeatCapacityForPlayer(player, courseHeatCapacity(state));
}

function canCoolDown(player: PlayerState, count: number, capacity: number): boolean {
  return count > 0 && player.engine.length < capacity && player.hand.some(isHeatCard);
}

function addHeatToEngine(player: PlayerState, count: number, capacity: number): number {
  let moved = 0;
  for (
    let index = player.hand.length - 1;
    index >= 0 && moved < count && player.engine.length < capacity;
    index -= 1
  ) {
    if (isHeatCard(player.hand[index])) {
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

function canSlipstream(state: GameState, player: PlayerState): boolean {
  return (
    isAdjacentOrBehind(state.players, player) &&
    player.position.space + 2 <= state.track.finishSpace
  );
}

export function isOptionalDiscardCard(card: Card): boolean {
  return card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE';
}

function discardPlayedCards(player: PlayerState): number {
  const discarded = player.played.length;
  if (discarded > 0) player.discard.push(...player.played.splice(0));
  return discarded;
}

function discardHandCards(player: PlayerState, cardIds: string[]): number {
  if (cardIds.length === 0) throw new Error('Select at least one card to discard.');
  if (new Set(cardIds).size !== cardIds.length)
    throw new Error('A card can only be discarded once.');
  const cards = cardIds.map((cardId) => player.hand.find((card) => card.id === cardId));
  const selectedCards = cards.filter((card): card is Card => Boolean(card));
  if (selectedCards.length !== cards.length)
    throw new Error('You can only discard cards from your own hand.');
  if (selectedCards.some((card) => !isOptionalDiscardCard(card)))
    throw new Error('Heat and Stress cards cannot be discarded from your hand.');
  const selected = new Set(cardIds);
  player.hand = player.hand.filter((card) => !selected.has(card.id));
  player.discard.push(...selectedCards);
  return selectedCards.length;
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
  const destination = start + Math.max(0, movement);
  player.position = chooseLandingPosition(
    state.players,
    player.position,
    movement,
    state.track,
    player.id,
  );
  if (player.position.space > state.track.finishSpace && destination > state.track.finishSpace) {
    // Keep the finish marker synchronized with the actual final landing. A
    // racer can cross the line, then Boost or Slipstream farther in the same
    // reaction window.
    player.finishProgress = player.position.space;
  }
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
  const cluttered = selected.some(isHeatCard);
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
  const capacity = engineCapacity(state, player);
  const adrenalineCooldownAvailable = adrenaline && canCoolDown(player, 1, capacity);
  state.pending = {
    kind: adrenaline ? 'ADRENALINE' : 'GEAR_REACTION',
    playerId: player.id,
    options: [],
    speed,
    startSpace: moved.start,
    movedSpace: moved.end,
    adrenalineSpeedAvailable: adrenaline,
    adrenalineCooldownAvailable,
    // Adrenaline Cooldown may fill an empty engine before Boost is chosen.
    boostAvailable: player.gear >= 3,
    cooldownAvailable: player.gear === 1 ? 3 : player.gear === 2 ? 1 : 0,
    slipstreamAvailable: canSlipstream(state, player),
    slipstreamUsed: false,
    crossedCornerIds: corners.map((corner) => corner.id),
  };
  if (adrenaline) {
    state.pending.options = reactionOptions(state, state.pending, player);
  }
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
  pending.options = reactionOptions(state, pending, player);
}

function isReactionWindow(pending: PendingReaction | null): pending is PendingReaction {
  return pending?.kind === 'ADRENALINE' || pending?.kind === 'GEAR_REACTION';
}

function reactionOptions(
  state: GameState,
  pending: PendingReaction,
  player: PlayerState,
): string[] {
  const options = ['PASS_REACTION'];
  if (pending.boostAvailable && player.engine.length > 0) options.unshift('BOOST');
  if (
    pending.cooldownAvailable > 0 &&
    canCoolDown(player, pending.cooldownAvailable, engineCapacity(state, player))
  ) {
    options.unshift('COOLDOWN');
  }
  pending.slipstreamAvailable = !pending.slipstreamUsed && canSlipstream(state, player);
  if (pending.slipstreamAvailable) options.unshift('SLIPSTREAM');
  if (pending.adrenalineSpeedAvailable) options.unshift('ADRENALINE_SPEED');
  if (
    pending.adrenalineCooldownAvailable &&
    canCoolDown(player, 1, engineCapacity(state, player))
  ) {
    options.unshift('ADRENALINE_COOLDOWN');
  }
  return options;
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
    player.finishProgress = null;
    player.position = chooseSpinoutPosition(
      state.players,
      corner.lineSpace,
      state.track,
      player.id,
      player.position,
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
  player.finished = player.position.space > state.track.finishSpace;
  if (player.finished) {
    player.finishProgress ??= player.position.space;
    player.finishRound ??= state.round;
    log(state, `${player.name} crosses the finish line.`, player.id);
  }
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
    .sort(finishSort);
  const alreadyRanked = state.players.filter((candidate) => candidate.finishRank !== null).length;
  justFinished.forEach((candidate, index) => {
    candidate.finishRank = alreadyRanked + index + 1;
    candidate.position = {
      // Keep the actual landing distance visible after the car crosses the line.
      // Finished cars no longer participate in blocking, so these post-finish
      // positions are safe to retain as the end-of-turn result.
      // Position is the source of truth for the end-of-turn finish tiebreak.
      space: candidate.position.space,
      lane: candidate.position.lane,
    };
  });
  if (state.winnerId === null && justFinished.length > 0) {
    state.winnerId = justFinished[0].id;
    log(
      state,
      `${justFinished[0].name} is first after the finish-line tie-break. The race continues for the remaining places.`,
      justFinished[0].id,
    );
  }
  const laterFinishers = justFinished.filter((candidate) => candidate.id !== state.winnerId);
  if (laterFinishers.length > 0) {
    log(
      state,
      `${laterFinishers.map((candidate) => candidate.name).join(', ')} finish${laterFinishers.length === 1 ? 'es' : ''}; the race continues for the remaining places.`,
    );
  }
  if (state.players.every((candidate) => candidate.finished)) {
    state.winnerId ??= [...state.players].sort(finishSort)[0]?.id ?? null;
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
  const adrenalineCount = ordered.length >= 5 ? 2 : 1;
  state.adrenalineEligibleIds = ordered.slice(-adrenalineCount).map((player) => player.id);
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

function submitOptionalDiscard(
  state: GameState,
  playerId: string,
  cardIds: string[],
  random: RandomSource,
): void {
  if (!state.pending || state.pending.kind !== 'GEAR_REACTION')
    throw new Error('Optional discard is not open right now.');
  const player = findPlayer(state, playerId);
  const discarded = discardHandCards(player, cardIds);
  log(
    state,
    `${player.name} optionally discards ${discarded} card${discarded === 1 ? '' : 's'} from hand.`,
    player.id,
  );
  finishPlayerTurn(state, random);
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
  if (playerSpecs.length < MIN_PLAYERS || playerSpecs.length > MAX_PLAYERS) {
    throw new Error(`A race needs ${MIN_PLAYERS}-${MAX_PLAYERS} players.`);
  }
  const players: PlayerState[] = playerSpecs.map((spec, index) => {
    const deck = shuffle(createBeginnerDeck(spec.id), random);
    const player: PlayerState = {
      ...spec,
      gear: 1,
      position: USA_BEGINNER_TRACK.grid[index] ?? { space: -2, lane: (index % 2) as 0 | 1 },
      hand: [],
      deck,
      discard: [],
      engine: Array.from(
        { length: USA_BEGINNER_TRACK.engineHeatCapacity ?? USA_ENGINE_HEAT },
        (_, heatIndex) => ({
          id: `${spec.id}-engine-heat-${heatIndex}`,
          kind: 'HEAT' as const,
        }),
      ),
      played: [],
      finished: false,
      finishRank: null,
      finishProgress: null,
      finishRound: null,
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
  const adrenalineCount = ordered.length >= 5 ? 2 : 1;
  state.adrenalineEligibleIds = ordered.slice(-adrenalineCount).map((player) => player.id);
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
    case 'DISCARD_CARDS':
      submitOptionalDiscard(state, action.playerId, action.cardIds, random);
      return state;
    case 'ADRENALINE_SPEED': {
      const pending = state.pending;
      if (!isReactionWindow(pending) || !pending.adrenalineSpeedAvailable)
        throw new Error('Adrenaline speed is unavailable.');
      pending.adrenalineSpeedAvailable = false;
      pending.speed += 1;
      movePlayer(state, player, 1);
      pending.movedSpace = player.position.space;
      refreshCrossedCorners(state);
      pending.options = pending.options.filter((option) => option !== 'ADRENALINE_SPEED');
      log(state, `${player.name} uses Adrenaline for +1 speed.`, player.id);
      openGearReaction(state);
      return state;
    }
    case 'ADRENALINE_COOLDOWN': {
      const pending = state.pending;
      if (!isReactionWindow(pending) || !pending.adrenalineCooldownAvailable)
        throw new Error('Adrenaline cooldown is unavailable.');
      if (!canCoolDown(player, 1, engineCapacity(state, player)))
        throw new Error('Adrenaline cooldown is unavailable while the engine is full.');
      pending.adrenalineCooldownAvailable = false;
      if (addHeatToEngine(player, 1, engineCapacity(state, player)) !== 1)
        throw new Error('Adrenaline cooldown needs Heat in your hand.');
      pending.options = pending.options.filter((option) => option !== 'ADRENALINE_COOLDOWN');
      log(state, `${player.name} uses Adrenaline to cool down 1 Heat.`, player.id);
      openGearReaction(state);
      return state;
    }
    case 'BOOST': {
      const pending = state.pending;
      if (!isReactionWindow(pending) || !pending.boostAvailable)
        throw new Error('Boost is unavailable.');
      if (!payHeat(player)) throw new Error('Boost requires 1 Heat in the engine.');
      const boostSpeed = revealBasicSpeed(player, random);
      const boostMove = movePlayer(state, player, boostSpeed);
      pending.speed += boostSpeed;
      pending.movedSpace = boostMove.end;
      refreshCrossedCorners(state);
      pending.boostAvailable = false;
      log(
        state,
        `${player.name} boosts for +${boostSpeed} speed and moves to space ${player.position.space}.`,
        player.id,
      );
      openGearReaction(state);
      return state;
    }
    case 'COOLDOWN': {
      const pending = state.pending;
      if (!isReactionWindow(pending) || pending.cooldownAvailable <= 0)
        throw new Error('Cooldown is unavailable.');
      if (!canCoolDown(player, 1, engineCapacity(state, player)))
        throw new Error('Cooldown is unavailable while the engine is full.');
      const cooled = addHeatToEngine(
        player,
        pending.cooldownAvailable,
        engineCapacity(state, player),
      );
      if (cooled === 0) throw new Error('Cooldown needs Heat in your hand.');
      pending.cooldownAvailable = 0;
      log(state, `${player.name} cools ${cooled} Heat back into the engine.`, player.id);
      openGearReaction(state);
      return state;
    }
    case 'SLIPSTREAM': {
      const pending = state.pending;
      if (!isReactionWindow(pending) || !pending.slipstreamAvailable)
        throw new Error('Slipstream is unavailable.');
      if (player.position.space + 2 > state.track.finishSpace)
        throw new Error('Slipstream cannot cross the finish line.');
      movePlayer(state, player, 2);
      pending.movedSpace = player.position.space;
      refreshCrossedCorners(state);
      pending.slipstreamAvailable = false;
      pending.slipstreamUsed = true;
      log(state, `${player.name} slipstreams 2 spaces.`, player.id);
      openGearReaction(state);
      return state;
    }
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
      finishProgress: player.finishProgress,
      finishRound: player.finishRound,
      handCount: player.hand.length,
      deckCount: player.deck.length,
      discardCount: player.discard.length,
      engineHeat: player.engine.length,
      engineHeatCapacity: engineCapacity(state, player),
      submitted: Boolean(state.submitted[player.id]),
    })),
  };
}
