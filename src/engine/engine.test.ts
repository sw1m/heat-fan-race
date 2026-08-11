import { describe, expect, it } from 'vitest';
import { createBeginnerDeck, countCardKinds, drawCards, shuffle } from './deck';
import { applyGameAction, createInitialGame, getPublicState } from './engine';
import { USA_BEGINNER_TRACK } from './constants';
import {
  chooseLandingPosition,
  crossedCorners,
  distanceToNextCorner,
  isAdjacentOrBehind,
  nextCorner,
  positionSort,
} from './track';
import type { Card, GameState, PlayerState } from './types';

const fixedRandom = () => 0.42;
const players = [
  { id: 'p1', name: 'Red', seat: 0, color: '#d44735' },
  { id: 'p2', name: 'Blue', seat: 1, color: '#245c8c' },
  { id: 'p3', name: 'Gold', seat: 2, color: '#ee9a2f' },
  { id: 'p4', name: 'Green', seat: 3, color: '#2f7a54' },
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
    expect(distanceToNextCorner(USA_BEGINNER_TRACK, 4)).toBe(6);
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

  it('allows passing through cars and identifies slipstream adjacency', () => {
    const board = [car('p1', 3, 0), car('p2', 6, 0)];
    expect(
      chooseLandingPosition(board, { space: 1, lane: 0 }, 5, USA_BEGINNER_TRACK, 'p3').space,
    ).toBe(6);
    expect(isAdjacentOrBehind([...board, car('p3', 5, 1)], board[0])).toBe(true);
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
    const heat: Card = { id: 'hand-heat', kind: 'HEAT' };
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
    expect(state.players[0].engine).toHaveLength(7);
    const publicState = getPublicState(state, 'p1');
    expect(JSON.stringify(publicState)).not.toContain('hand-heat');
    expect(JSON.stringify(publicState)).not.toContain('cardIds');
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
    state = applyGameAction(state, { type: 'BOOST', playerId: 'p1' }, fixedRandom);
    expect(state.players[0].engine.length).toBe(before - 1);
    expect(state.log.some((entry) => entry.text.includes('boosts'))).toBe(true);
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

  it('marks a car finished when normal movement crosses the finish line', () => {
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
    expect(state.players[0].finished).toBe(true);
    expect(state.players[0].finishRank).toBe(1);
  });
});
