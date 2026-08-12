import { describe, expect, it } from 'vitest';
import { createBeginnerDeck, countCardKinds, drawCards, shuffle } from './deck';
import { applyGameAction, createInitialGame, getPublicState } from './engine';
import { USA_BEGINNER_TRACK } from './constants';
import {
  chooseLandingPosition,
  chooseSpinoutPosition,
  crossedCorners,
  distanceToNextCorner,
  finishSort,
  isAdjacentOrBehind,
  nextCorner,
  positionSort,
} from './track';
import type { Card, GameState, PlayerState } from './types';

const fixedRandom = () => 0.42;
const players = [
  { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
  { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
  { id: 'p3', name: 'Yellow', seat: 2, color: '#f2c230' },
  { id: 'p4', name: 'Green', seat: 3, color: '#2f7a54' },
];
const sixPlayers = [
  ...players,
  { id: 'p5', name: 'Purple', seat: 4, color: '#7b4d9e' },
  { id: 'p6', name: 'Teal', seat: 5, color: '#2b9db2' },
];

function cardIds(state: GameState, playerId: string, count = 1): string[] {
  return state.players
    .find((player) => player.id === playerId)!
    .hand.slice(0, count)
    .map((card) => card.id);
}

function pass(state: GameState, playerId: string): GameState {
  return applyGameAction(state, { type: 'PASS_REACTION', playerId }, fixedRandom);
}

describe('beginner deck and card movement', () => {
  it('creates twelve Basic, three Stress, and three starting cards', () => {
    const deck = createBeginnerDeck('p1');
    expect(deck).toHaveLength(18);
    expect(countCardKinds(deck)).toEqual({
      BASIC: 12,
      STRESS: 3,
      HEAT: 0,
      STARTING_ZERO: 1,
      STARTING_FIVE: 1,
      STARTING_HEAT: 1,
    });
  });

  it('shuffles deterministically and reshuffles discard when drawing', () => {
    const cards = [
      { id: 'a', kind: 'BASIC' as const, value: 1 },
      { id: 'b', kind: 'BASIC' as const, value: 2 },
    ];
    expect(shuffle(cards, () => 0)).toEqual([
      { id: 'b', kind: 'BASIC', value: 2 },
      { id: 'a', kind: 'BASIC', value: 1 },
    ]);
    const player: PlayerState = {
      id: 'p',
      name: 'P',
      seat: 0,
      color: '#000',
      gear: 1,
      position: { space: 0, lane: 0 as const },
      hand: [],
      deck: [],
      discard: cards,
      engine: [],
      played: [],
      finished: false,
      finishRank: null,
      finishProgress: null,
      finishRound: null,
    };
    expect(drawCards(player, 1, fixedRandom)).toBe(1);
    expect(player.hand[0].kind).toBe('BASIC');
  });
});

describe('planning, shifting, and turn order', () => {
  it('starts in first gear and deals seven cards', () => {
    const state = createInitialGame(players.slice(0, 2), fixedRandom);
    expect(
      state.players.every(
        (player) => player.gear === 1 && player.hand.length === 7 && player.engine.length === 6,
      ),
    ).toBe(true);
  });

  it('supports six starting-grid seats and gives the last two cars Adrenaline', () => {
    const state = createInitialGame(sixPlayers, fixedRandom);
    expect(state.players.map((player) => player.position)).toEqual([
      { space: 0, lane: 0 },
      { space: 0, lane: 1 },
      { space: -1, lane: 0 },
      { space: -1, lane: 1 },
      { space: -2, lane: 0 },
      { space: -2, lane: 1 },
    ]);
    expect(state.adrenalineEligibleIds).toEqual(['p5', 'p6']);
  });

  it('rejects duplicate submissions and illegal card ownership', () => {
    const state = createInitialGame(players.slice(0, 2), fixedRandom);
    const first = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: cardIds(state, 'p1') },
      fixedRandom,
    );
    expect(() =>
      applyGameAction(
        first,
        { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: cardIds(state, 'p1') },
        fixedRandom,
      ),
    ).toThrow(/already submitted/);
    expect(() =>
      applyGameAction(
        state,
        { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: cardIds(state, 'p2') },
        fixedRandom,
      ),
    ).toThrow(/own hand/);
  });

  it('charges one Heat for a two-position shift', () => {
    const state = createInitialGame(players.slice(0, 2), fixedRandom);
    const next = applyGameAction(
      state,
      {
        type: 'SUBMIT_PLAN',
        playerId: 'p1',
        gear: 3,
        cardIds: state.players[0].hand
          .filter((card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT')
          .slice(0, 3)
          .map((card) => card.id),
      },
      fixedRandom,
    );
    expect(next.players[0].gear).toBe(3);
    expect(next.players[0].engine).toHaveLength(5);
    expect(next.players[0].discard.filter((card) => card.kind === 'HEAT')).toHaveLength(1);
  });

  it('resolves all submissions from the frontmost car and advances the round', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: cardIds(state, 'p1') },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: cardIds(state, 'p2') },
      fixedRandom,
    );
    expect(state.phase).toBe('PLAYER_REACTION');
    const active = state.activePlayerId!;
    state = pass(state, active);
    const resolvedPlayer = state.players.find((player) => player.id === active)!;
    expect(resolvedPlayer.played).toHaveLength(0);
    expect(resolvedPlayer.discard.length).toBeGreaterThan(0);
    expect(resolvedPlayer.hand).toHaveLength(7);
    state = pass(state, state.activePlayerId!);
    if (state.phase === 'PLAYER_REACTION') state = pass(state, state.activePlayerId!);
    expect(state.phase).toBe('PLANNING');
    expect(state.round).toBe(2);
  });
});

describe('track display helpers', () => {
  it('finds the next corner and its remaining distance', () => {
    expect(nextCorner(USA_BEGINNER_TRACK, 4)?.id).toBe('corner-1');
    expect(distanceToNextCorner(USA_BEGINNER_TRACK, 4)).toBe(5);
    expect(distanceToNextCorner(USA_BEGINNER_TRACK, 9)).toBe(0);
    expect(distanceToNextCorner(USA_BEGINNER_TRACK, 36)).toBeNull();
  });
});

describe('track rules', () => {
  const car = (id: string, space: number, lane: 0 | 1): PlayerState => ({
    id,
    name: id,
    seat: Number(id.slice(1)) || 0,
    color: '#000',
    gear: 1,
    position: { space, lane },
    hand: [],
    deck: [],
    discard: [],
    engine: [],
    played: [],
    finished: false,
    finishRank: null,
    finishProgress: null,
    finishRound: null,
  });

  it('finds multiple corners in order and limits spaces to two cars', () => {
    expect(crossedCorners(USA_BEGINNER_TRACK, 8, 31).map((corner) => corner.id)).toEqual([
      'corner-1',
      'corner-2',
      'corner-3',
    ]);
    const board = [car('p1', 5, 0), car('p2', 5, 1)];
    expect(
      chooseLandingPosition(board, { space: 1, lane: 0 }, 4, USA_BEGINNER_TRACK, 'p3'),
    ).toEqual({ space: 4, lane: 0 });
    expect(
      chooseLandingPosition(board, { space: 1, lane: 0 }, 4, USA_BEGINNER_TRACK, 'p1'),
    ).toEqual({ space: 5, lane: 0 });
  });

  it('puts a second landing car in the open lane and stops at a full block', () => {
    const oneCar = [car('p1', 5, 0)];
    expect(
      chooseLandingPosition(oneCar, { space: 1, lane: 1 }, 4, USA_BEGINNER_TRACK, 'p2'),
    ).toEqual({ space: 5, lane: 1 });

    const fullSpace = [...oneCar, car('p2', 5, 1)];
    expect(
      chooseLandingPosition(fullSpace, { space: 4, lane: 1 }, 1, USA_BEGINNER_TRACK, 'p3'),
    ).toEqual({ space: 4, lane: 1 });
    expect(
      chooseLandingPosition(fullSpace, { space: 4, lane: 1 }, 0, USA_BEGINNER_TRACK, 'p3'),
    ).toEqual({ space: 4, lane: 1 });
  });

  it('puts a spinout in the first available space before the corner', () => {
    const board = [car('p1', 9, 0), car('p2', 9, 1), car('p3', 8, 0)];
    expect(
      chooseSpinoutPosition(board, 10, USA_BEGINNER_TRACK, 'p4', { space: 12, lane: 1 }),
    ).toEqual({ space: 8, lane: 1 });
  });

  it('keeps a four-car sequential landing legal when every car targets one space', () => {
    let state = createInitialGame(players, fixedRandom);
    state.players.forEach((player, index) => {
      player.position = { space: 3, lane: (index % 2) as 0 | 1 };
      player.hand = [{ id: `${player.id}-speed-two`, kind: 'BASIC', value: 2 }];
    });

    for (const player of state.players) {
      state = applyGameAction(
        state,
        { type: 'SUBMIT_PLAN', playerId: player.id, gear: 1, cardIds: [player.hand[0].id] },
        fixedRandom,
      );
    }

    while (state.phase === 'PLAYER_REACTION') {
      state = pass(state, state.activePlayerId!);
    }

    const occupancy = new Map<number, number>();
    state.players.forEach((player) => {
      occupancy.set(player.position.space, (occupancy.get(player.position.space) ?? 0) + 1);
    });
    expect(Math.max(...occupancy.values())).toBeLessThanOrEqual(2);
    expect(state.players.map((player) => player.position.space).sort((a, b) => a - b)).toEqual([
      4, 4, 5, 5,
    ]);
  });

  it('keeps four simultaneous spinouts within two cars per space', () => {
    let state = createInitialGame(players, fixedRandom);
    state.players.forEach((player, index) => {
      player.position = { space: 7, lane: (index % 2) as 0 | 1 };
      player.engine = [];
      player.hand = [{ id: `${player.id}-speed-five`, kind: 'STARTING_FIVE', value: 5 }];
    });

    for (const player of state.players) {
      state = applyGameAction(
        state,
        { type: 'SUBMIT_PLAN', playerId: player.id, gear: 1, cardIds: [player.hand[0].id] },
        fixedRandom,
      );
    }

    while (state.phase === 'PLAYER_REACTION') {
      state = pass(state, state.activePlayerId!);
    }

    const occupancy = new Map<number, number>();
    state.players.forEach((player) => {
      occupancy.set(player.position.space, (occupancy.get(player.position.space) ?? 0) + 1);
    });
    expect(Math.max(...occupancy.values())).toBeLessThanOrEqual(2);
    expect(state.players.map((player) => player.position.space).sort((a, b) => a - b)).toEqual([
      8, 8, 9, 9,
    ]);
  });

  it('allows passing through cars and only identifies immediate slipstream adjacency', () => {
    const board = [car('p1', 3, 0), car('p2', 6, 0)];
    expect(
      chooseLandingPosition(board, { space: 1, lane: 0 }, 5, USA_BEGINNER_TRACK, 'p3').space,
    ).toBe(6);
    expect(isAdjacentOrBehind([...board, car('p3', 5, 1)], board[0])).toBe(false);
    expect(isAdjacentOrBehind([...board, car('p4', 4, 1)], board[0])).toBe(true);
  });

  it('uses the inside lane as the tie-breaker', () => {
    expect(positionSort(car('p1', 10, 0), car('p2', 10, 1))).toBeLessThan(0);
  });
});

describe('stress, boost, cooldown, finish, and hidden state', () => {
  it('resolves Stress until a Basic speed card and discards non-Basic reveals', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    const p1 = state.players[0];
    const stress = p1.hand.find((card) => card.kind === 'STRESS')!;
    p1.hand = [stress];
    p1.deck = [
      { id: 'basic-4', kind: 'BASIC', value: 4 },
      { id: 'zero', kind: 'STARTING_ZERO', value: 0 },
    ];
    p1.discard = [];
    state.players[1].hand = [state.players[1].hand[0]];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: [stress.id] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: cardIds(state, 'p2') },
      fixedRandom,
    );
    expect(state.log.some((entry) => entry.text.includes('speed 4'))).toBe(true);
    expect(state.players[0].discard.some((card) => card.id === 'zero')).toBe(true);
  });

  it('permits cooldown from hand and keeps public state free of private card arrays', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].engine = state.players[0].engine.slice(0, 5);
    const heat: Card = { id: 'hand-heat', kind: 'STARTING_HEAT' };
    state.players[0].hand = [state.players[0].hand.find((card) => card.kind === 'BASIC')!, heat];
    state.players[1].hand = [state.players[1].hand[0]];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: [state.players[0].hand[0].id] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
    );
    state = applyGameAction(state, { type: 'COOLDOWN', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].engine).toHaveLength(6);
    const publicState = getPublicState(state, 'p1');
    expect(JSON.stringify(publicState)).not.toContain('hand-heat');
    expect(JSON.stringify(publicState)).not.toContain('cardIds');
  });

  it('offers one cooldown after shifting into second gear', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    const p1 = state.players[0];
    p1.engine = p1.engine.slice(0, 5);
    const speedCards = p1.hand
      .filter(
        (card) =>
          card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE',
      )
      .slice(0, 2);
    const heat = p1.hand.find((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT')!;
    p1.hand = [...speedCards, heat];
    state.players[1].hand = [state.players[1].hand.find((card) => card.kind === 'BASIC')!];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 2, cardIds: speedCards.map((card) => card.id) },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
    );

    expect(state.pending?.playerId).toBe('p1');
    expect(state.pending?.cooldownAvailable).toBe(1);
    expect(state.pending?.options).toContain('COOLDOWN');

    state = applyGameAction(state, { type: 'COOLDOWN', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].engine).toHaveLength(6);
    expect(state.players[0].hand.map((card) => card.id)).not.toContain(heat.id);
    expect(state.pending?.options).not.toContain('COOLDOWN');
  });

  it('does not offer second-gear cooldown while the effective seven-slot engine is full', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    const p1 = state.players[0];
    const starterHeat = p1.hand.find((card) => card.kind === 'STARTING_HEAT');
    if (!starterHeat) {
      const starterHeatIndex = p1.deck.findIndex((card) => card.kind === 'STARTING_HEAT');
      expect(starterHeatIndex).toBeGreaterThanOrEqual(0);
      p1.engine.push(p1.deck.splice(starterHeatIndex, 1)[0]);
    } else {
      p1.engine.push(p1.hand.splice(p1.hand.indexOf(starterHeat), 1)[0]);
    }
    const speedCards = p1.hand
      .filter(
        (card) =>
          card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE',
      )
      .slice(0, 2);
    let heat = p1.hand.find((card) => card.kind === 'HEAT');
    if (!heat) {
      heat = { id: 'test-engine-full-heat', kind: 'HEAT' };
    }
    p1.hand = [...speedCards, heat];
    state.players[1].hand = [state.players[1].hand.find((card) => card.kind === 'BASIC')!];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 2, cardIds: speedCards.map((card) => card.id) },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
    );

    expect(state.players[0].engine).toHaveLength(7);
    expect(state.pending?.cooldownAvailable).toBe(1);
    expect(state.pending?.options).not.toContain('COOLDOWN');
  });

  it('uses the selected course capacity instead of a fixed USA capacity', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    const p1 = state.players[0];
    state.track = { ...state.track, engineHeatCapacity: 5 };
    p1.engine = p1.engine.slice(0, 4);
    const speedCards = p1.hand
      .filter(
        (card) =>
          card.kind === 'BASIC' || card.kind === 'STARTING_ZERO' || card.kind === 'STARTING_FIVE',
      )
      .slice(0, 2);
    const heat = p1.hand.find((card) => card.kind === 'HEAT' || card.kind === 'STARTING_HEAT')!;
    p1.hand = [...speedCards, heat];
    state.players[1].hand = [state.players[1].hand.find((card) => card.kind === 'BASIC')!];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 2, cardIds: speedCards.map((card) => card.id) },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
    );

    expect(state.pending?.options).toContain('COOLDOWN');
    state = applyGameAction(state, { type: 'COOLDOWN', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].engine).toHaveLength(5);
  });

  it('treats the starting Heat card as Heat when a hand is cluttered', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].hand = [{ id: 'starter-heat', kind: 'STARTING_HEAT' }];
    state.players[1].hand = [{ id: 'other-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['starter-heat'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['other-one'] },
      fixedRandom,
    );
    expect(state.players[0].position.space).toBe(0);
    expect(state.players[0].discard.map((card) => card.id)).toContain('starter-heat');
    expect(state.log.some((entry) => entry.text.includes('cluttered hand'))).toBe(true);
  });

  it('ranks finishers by finish order and keeps the winner deterministic', () => {
    const state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].finished = true;
    state.players[0].finishRank = 1;
    state.players[1].finished = true;
    state.players[1].finishRank = 2;
    state.winnerId = 'p1';
    expect(state.winnerId).toBe('p1');
    expect(state.players.map((player) => player.finishRank)).toEqual([1, 2]);
  });

  it('resolves Boost as an optional gear reaction and pays engine Heat', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 1, lane: 0 };
    state.players[1].position = { space: -1, lane: 0 };
    state.players[0].gear = 2;
    state.players[0].hand = state.players[0].hand
      .filter((card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT')
      .slice(0, 3);
    state.players[0].deck = [{ id: 'boost-basic', kind: 'BASIC', value: 2 }];
    state.players[1].hand = [state.players[1].hand.find((card) => card.kind === 'BASIC')!];
    state = applyGameAction(
      state,
      {
        type: 'SUBMIT_PLAN',
        playerId: 'p1',
        gear: 3,
        cardIds: state.players[0].hand.map((card) => card.id),
      },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [state.players[1].hand[0].id] },
      fixedRandom,
    );
    expect(state.pending?.options).toContain('BOOST');
    const before = state.players[0].engine.length;
    const beforeBoostSpace = state.players[0].position.space;
    const beforeBoostSpeed = state.pending?.speed ?? 0;
    state = applyGameAction(state, { type: 'BOOST', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].engine.length).toBe(before - 1);
    expect(state.players[0].position.space).toBe(beforeBoostSpace + 2);
    expect(state.pending?.speed).toBe(beforeBoostSpeed + 2);
    expect(state.players[0].played.some((card) => card.id === 'boost-basic')).toBe(true);
    expect(state.log.some((entry) => entry.text.includes('boosts'))).toBe(true);
  });

  it('keeps Boost available after using Adrenaline speed', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 3, lane: 0 };
    state.players[1].position = { space: 0, lane: 0 };
    state.players[1].gear = 3;
    state.players[1].engine = state.players[1].engine.slice(0, 1);
    state.players[0].hand = [{ id: 'front-one', kind: 'BASIC', value: 1 }];
    state.players[1].hand = [
      { id: 'adrenaline-one', kind: 'BASIC', value: 1 },
      { id: 'adrenaline-two', kind: 'BASIC', value: 1 },
      { id: 'adrenaline-three', kind: 'BASIC', value: 1 },
    ];
    state.players[1].deck = [{ id: 'adrenaline-boost', kind: 'BASIC', value: 2 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['front-one'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      {
        type: 'SUBMIT_PLAN',
        playerId: 'p2',
        gear: 3,
        cardIds: ['adrenaline-one', 'adrenaline-two', 'adrenaline-three'],
      },
      fixedRandom,
    );
    state = pass(state, 'p1');
    expect(state.pending?.kind).toBe('ADRENALINE');

    state = applyGameAction(state, { type: 'ADRENALINE_SPEED', playerId: 'p2' }, fixedRandom);
    expect(state.pending?.kind).toBe('GEAR_REACTION');
    expect(state.pending?.options).toContain('BOOST');
    state = applyGameAction(state, { type: 'BOOST', playerId: 'p2' }, fixedRandom);
    expect(state.players[1].engine).toHaveLength(0);
    expect(state.players[1].played.map((card) => card.id)).toContain('adrenaline-boost');
  });

  it('allows Adrenaline Cooldown to enable Boost in the same reaction window', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 3, lane: 0 };
    state.players[1].position = { space: 0, lane: 0 };
    state.players[1].gear = 3;
    state.players[1].engine = [];
    state.players[0].hand = [{ id: 'front-cool-one', kind: 'BASIC', value: 1 }];
    state.players[1].hand = [
      { id: 'cooldown-one', kind: 'BASIC', value: 1 },
      { id: 'cooldown-two', kind: 'BASIC', value: 1 },
      { id: 'cooldown-three', kind: 'BASIC', value: 1 },
      { id: 'cooldown-heat', kind: 'STARTING_HEAT' },
    ];
    state.players[1].deck = [{ id: 'cooldown-boost', kind: 'BASIC', value: 2 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['front-cool-one'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      {
        type: 'SUBMIT_PLAN',
        playerId: 'p2',
        gear: 3,
        cardIds: ['cooldown-one', 'cooldown-two', 'cooldown-three'],
      },
      fixedRandom,
    );
    state = pass(state, 'p1');
    expect(state.pending?.options).toContain('ADRENALINE_COOLDOWN');

    state = applyGameAction(state, { type: 'ADRENALINE_COOLDOWN', playerId: 'p2' }, fixedRandom);
    expect(state.pending?.options).toContain('BOOST');
    state = applyGameAction(state, { type: 'BOOST', playerId: 'p2' }, fixedRandom);
    expect(state.players[1].engine).toHaveLength(0);
    expect(state.players[1].played.map((card) => card.id)).toContain('cooldown-boost');
  });

  it('pays a corner overage and spins out when the engine cannot pay', () => {
    let paying = createInitialGame(players.slice(0, 2), fixedRandom);
    paying.players[0].position = { space: 9, lane: 0 };
    paying.players[1].position = { space: -1, lane: 0 };
    paying.players[0].hand = [{ id: 'five', kind: 'STARTING_FIVE', value: 5 }];
    paying.players[1].hand = [paying.players[1].hand.find((card) => card.kind === 'BASIC')!];
    paying = applyGameAction(
      paying,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['five'] },
      fixedRandom,
    );
    paying = applyGameAction(
      paying,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [paying.players[1].hand[0].id] },
      fixedRandom,
    );
    paying = pass(paying, 'p1');
    expect(paying.players[0].engine).toHaveLength(5);

    let spinning = createInitialGame(players.slice(0, 2), fixedRandom);
    spinning.players[0].position = { space: 9, lane: 0 };
    spinning.players[0].gear = 3;
    spinning.players[0].engine = [];
    spinning.players[1].position = { space: -1, lane: 0 };
    spinning.players[0].hand = [
      { id: 'spin-1', kind: 'STARTING_FIVE', value: 5 },
      { id: 'spin-2', kind: 'BASIC', value: 1 },
      { id: 'spin-3', kind: 'BASIC', value: 1 },
    ];
    spinning.players[1].hand = [spinning.players[1].hand.find((card) => card.kind === 'BASIC')!];
    spinning = applyGameAction(
      spinning,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 3, cardIds: ['spin-1', 'spin-2', 'spin-3'] },
      fixedRandom,
    );
    spinning = applyGameAction(
      spinning,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: [spinning.players[1].hand[0].id] },
      fixedRandom,
    );
    spinning = pass(spinning, 'p1');
    expect(spinning.players[0].gear).toBe(1);
    expect(spinning.players[0].position.space).toBe(9);
    expect(spinning.players[0].hand.filter((card) => card.kind === 'STRESS')).toHaveLength(2);
  });

  it('offers Slipstream without increasing corner-check speed and grants Adrenaline to last', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 1, lane: 0 };
    state.players[1].position = { space: 1, lane: 1 };
    state.players[0].hand = [{ id: 'zero-slip', kind: 'STARTING_ZERO', value: 0 }];
    state.players[1].hand = [{ id: 'two', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['zero-slip'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['two'] },
      fixedRandom,
    );
    expect(state.pending?.options).toContain('SLIPSTREAM');
    state = applyGameAction(state, { type: 'SLIPSTREAM', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].position.space).toBe(3);
    state = pass(state, 'p1');
    expect(state.pending?.kind).toBe('ADRENALINE');
    state = applyGameAction(state, { type: 'ADRENALINE_SPEED', playerId: 'p2' }, fixedRandom);
    expect(state.players[1].position.space).toBe(3);
  });

  it('does not offer Slipstream when the nearest car is more than one space ahead', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 1, lane: 0 };
    state.players[1].position = { space: 3, lane: 1 };
    state.players[0].hand = [{ id: 'far-zero', kind: 'STARTING_ZERO', value: 0 }];
    state.players[1].hand = [{ id: 'far-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['far-zero'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['far-one'] },
      fixedRandom,
    );
    expect(state.pending?.options).not.toContain('SLIPSTREAM');
  });

  it('does not offer Slipstream when two spaces would cross the finish line', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: USA_BEGINNER_TRACK.finishSpace - 1, lane: 0 };
    state.players[1].position = { space: USA_BEGINNER_TRACK.finishSpace, lane: 1 };
    state.players[0].hand = [{ id: 'finish-slip', kind: 'STARTING_ZERO', value: 0 }];
    state.players[1].hand = [{ id: 'finish-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['finish-slip'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['finish-one'] },
      fixedRandom,
    );
    expect(state.pending?.options).not.toContain('SLIPSTREAM');
  });

  it('allows optional discard of numeric hand cards but keeps Heat and Stress', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].hand = [
      { id: 'played-one', kind: 'BASIC', value: 1 },
      { id: 'optional-two', kind: 'BASIC', value: 2 },
      { id: 'kept-heat', kind: 'HEAT' },
      { id: 'kept-stress', kind: 'STRESS' },
    ];
    state.players[0].deck = Array.from({ length: 5 }, (_, index) => ({
      id: `draw-${index}`,
      kind: 'BASIC' as const,
      value: 1,
    }));
    state.players[1].hand = [{ id: 'other-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['played-one'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['other-one'] },
      fixedRandom,
    );
    expect(() =>
      applyGameAction(
        state,
        { type: 'DISCARD_CARDS', playerId: 'p1', cardIds: ['kept-heat'] },
        fixedRandom,
      ),
    ).toThrow(/Heat and Stress/);
    state = applyGameAction(
      state,
      { type: 'DISCARD_CARDS', playerId: 'p1', cardIds: ['optional-two'] },
      fixedRandom,
    );
    const player = state.players[0];
    expect(player.hand.slice(0, 2).map((card) => card.id)).toEqual(['kept-heat', 'kept-stress']);
    expect(player.hand).toHaveLength(7);
    expect(player.discard.map((card) => card.id)).toEqual(['optional-two', 'played-one']);
    expect(() =>
      applyGameAction(
        state,
        { type: 'DISCARD_CARDS', playerId: 'p1', cardIds: ['kept-stress'] },
        fixedRandom,
      ),
    ).toThrow(/not this player/);
  });

  it('does not finish a car that lands on the painted finish space', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 39, lane: 0 };
    state.players[1].position = { space: -1, lane: 0 };
    state.players[0].hand = [{ id: 'finish-one', kind: 'BASIC', value: 1 }];
    state.players[1].hand = [{ id: 'other-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['finish-one'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['other-one'] },
      fixedRandom,
    );
    state = pass(state, 'p1');
    state = pass(state, 'p2');
    if (state.phase === 'PLAYER_REACTION') state = pass(state, 'p2');
    expect(state.players[0].finished).toBe(false);
    expect(state.players[0].finishRank).toBeNull();
    expect(state.players[0].position.space).toBe(USA_BEGINNER_TRACK.finishSpace);
  });

  it('marks a car finished only after it lands beyond the painted finish space', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 39, lane: 0 };
    state.players[1].position = { space: -1, lane: 0 };
    state.players[0].hand = [{ id: 'finish-two', kind: 'BASIC', value: 2 }];
    state.players[1].hand = [{ id: 'other-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['finish-two'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['other-one'] },
      fixedRandom,
    );
    state = pass(state, state.activePlayerId!);
    state = pass(state, state.activePlayerId!);
    while (state.phase === 'PLAYER_REACTION') state = pass(state, state.activePlayerId!);

    expect(state.players[0].finished).toBe(true);
    expect(state.players[0].finishRank).toBe(1);
    expect(state.players[0].finishRound).toBe(1);
    expect(state.players[0].position.space).toBe(41);
    expect(state.winnerId).toBe('p1');
    expect(state.phase).toBe('PLANNING');
  });

  it('retains the complete event log for race review', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.log = Array.from({ length: 80 }, (_, index) => ({
      id: `old-${index}`,
      round: 1,
      text: `Earlier event ${index}`,
    }));
    const firstCard = state.players[0].hand[0];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: [firstCard.id] },
      fixedRandom,
    );
    expect(state.log).toHaveLength(81);
    expect(state.log[0].text).toContain('locked in');
    expect(state.log[1].id).toBe('old-0');
    expect(state.log.at(-1)?.id).toBe('old-79');
  });

  it('ranks same-round finishers by distance beyond the line before lane ties', () => {
    let state = createInitialGame(players.slice(0, 2), fixedRandom);
    state.players[0].position = { space: 39, lane: 1 };
    state.players[1].position = { space: 39, lane: 0 };
    state.adrenalineEligibleIds = ['p1'];
    state.players[0].hand = [{ id: 'finish-four', kind: 'BASIC', value: 4 }];
    state.players[1].hand = [{ id: 'finish-one', kind: 'BASIC', value: 1 }];
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p1', gear: 1, cardIds: ['finish-four'] },
      fixedRandom,
    );
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: 'p2', gear: 1, cardIds: ['finish-one'] },
      fixedRandom,
    );
    state = pass(state, 'p2');
    state = pass(state, 'p1');
    state = pass(state, 'p1');
    expect(state.phase).toBe('PLANNING');
    expect(state.players[0].finishProgress).toBe(43);
    expect(state.players[0].finishRound).toBe(1);
    expect(state.players[1].finishProgress).toBeNull();
    expect(state.players[0].position.space).toBe(43);
    expect(state.players[1].position.space).toBe(40);
    expect(state.players[0].finishRank).toBe(1);
    expect(state.players[1].finishRank).toBeNull();
    expect(state.winnerId).toBe('p1');
    expect(finishSort(state.players[0], state.players[1])).toBeLessThan(0);
  });
});
