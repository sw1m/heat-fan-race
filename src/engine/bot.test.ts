import { describe, expect, it } from 'vitest';
import { advanceBotTurns, chooseBotPlan, chooseBotReaction } from './bot';
import { applyGameAction, createInitialGame } from './engine';
import type { GameState } from './types';

const fixedRandom = () => 0.42;
const human = {
  id: 'human',
  name: 'Human',
  seat: 0,
  color: '#d44735',
  controller: 'HUMAN' as const,
};
const bot = {
  id: 'bot',
  name: 'Bot 2',
  seat: 1,
  color: '#ee9a2f',
  controller: 'BOT' as const,
};
const blockerA = {
  id: 'blocker-a',
  name: 'Blocker A',
  seat: 2,
  color: '#245c8c',
  controller: 'BOT' as const,
};
const blockerB = {
  id: 'blocker-b',
  name: 'Blocker B',
  seat: 3,
  color: '#2f7a54',
  controller: 'BOT' as const,
};

function humanCard(state: GameState): string {
  return state.players
    .find((player) => player.id === human.id)!
    .hand.find((card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT')!.id;
}

describe('rules-following bot', () => {
  function reactionState(options: string[]): GameState {
    const state = createInitialGame([human, bot], fixedRandom);
    state.phase = 'PLAYER_REACTION';
    state.activePlayerId = bot.id;
    state.pending = {
      kind: 'GEAR_REACTION',
      playerId: bot.id,
      options,
      speed: 0,
      startSpace: 0,
      movedSpace: 0,
      adrenalineSpeedAvailable: false,
      adrenalineCooldownAvailable: false,
      boostAvailable: options.includes('BOOST'),
      cooldownAvailable: options.includes('COOLDOWN') ? 1 : 0,
      slipstreamAvailable: options.includes('SLIPSTREAM'),
      slipstreamUsed: false,
      crossedCornerIds: [],
    };
    return state;
  }

  it('chooses a plan that the authoritative engine accepts', () => {
    const state = createInitialGame([human, bot], fixedRandom);
    const action = chooseBotPlan(state, bot.id);
    expect(action.type).toBe('SUBMIT_PLAN');
    if (action.type !== 'SUBMIT_PLAN') throw new Error('Expected a submitted plan.');
    expect(action.cardIds).toHaveLength(action.gear);
    expect(() => applyGameAction(state, action, fixedRandom)).not.toThrow();
  });

  it('avoids a cluttered plan when blocking erases the value of the extra card', () => {
    const state = createInitialGame([human, bot, blockerA, blockerB], fixedRandom);
    const botPlayer = state.players.find((player) => player.id === bot.id)!;
    botPlayer.position = { space: 3, lane: 0 };
    botPlayer.hand = [
      { id: 'blocked-four', kind: 'BASIC', value: 4 },
      { id: 'hand-heat', kind: 'HEAT' },
    ];
    state.players.find((player) => player.id === blockerA.id)!.position = { space: 7, lane: 0 };
    state.players.find((player) => player.id === blockerB.id)!.position = { space: 7, lane: 1 };
    const action = chooseBotPlan(state, bot.id);
    expect(action).toEqual({
      type: 'SUBMIT_PLAN',
      playerId: bot.id,
      gear: 1,
      cardIds: ['blocked-four'],
    });
  });

  it('does not choose cooldown when the engine is already full', () => {
    const state = reactionState(['COOLDOWN', 'PASS_REACTION']);
    const botPlayer = state.players.find((player) => player.id === bot.id)!;
    botPlayer.hand = [{ id: 'hand-heat', kind: 'HEAT' }];
    expect(chooseBotReaction(state, bot.id)).toEqual({
      type: 'PASS_REACTION',
      playerId: bot.id,
    });
  });

  it('uses cooldown to clear Heat when the engine has room', () => {
    const state = reactionState(['COOLDOWN', 'PASS_REACTION']);
    const botPlayer = state.players.find((player) => player.id === bot.id)!;
    botPlayer.engine = botPlayer.engine.slice(0, 5);
    botPlayer.hand = [{ id: 'hand-heat', kind: 'HEAT' }];
    expect(chooseBotReaction(state, bot.id)).toEqual({
      type: 'COOLDOWN',
      playerId: bot.id,
    });
  });

  it('declines a boost that would turn a payable corner into a spinout', () => {
    const state = reactionState(['BOOST', 'PASS_REACTION']);
    const botPlayer = state.players.find((player) => player.id === bot.id)!;
    botPlayer.position = { space: 11, lane: 0 };
    botPlayer.gear = 3;
    botPlayer.engine = botPlayer.engine.slice(0, 3);
    botPlayer.hand = [];
    botPlayer.deck = [{ id: 'boost-four', kind: 'BASIC', value: 4 }];
    state.pending!.speed = 5;
    state.pending!.startSpace = 8;
    state.pending!.movedSpace = 11;
    state.pending!.crossedCornerIds = ['corner-1'];
    expect(chooseBotReaction(state, bot.id)).toEqual({
      type: 'PASS_REACTION',
      playerId: bot.id,
    });
  });

  it('waits for all human plans before locking the bot plan', () => {
    const state = createInitialGame([human, bot], fixedRandom);
    const waiting = advanceBotTurns(state, fixedRandom);
    expect(waiting).toBe(state);
    expect(waiting.submitted[bot.id]).toBeUndefined();

    const afterHuman = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: human.id, gear: 1, cardIds: [humanCard(state)] },
      fixedRandom,
    );
    const next = advanceBotTurns(afterHuman, fixedRandom);
    expect(next.phase).toBe('PLAYER_REACTION');
    expect(next.submitted[bot.id]).toBeDefined();
    expect(next.submitted[human.id]).toBeDefined();
    expect(next.activePlayerId).toBe(human.id);
  });

  it('resolves its reactions and returns control without deadlocking', () => {
    let state = createInitialGame([human, bot], fixedRandom);
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: human.id, gear: 1, cardIds: [humanCard(state)] },
      fixedRandom,
    );
    state = advanceBotTurns(state, fixedRandom);
    state = applyGameAction(state, { type: 'PASS_REACTION', playerId: human.id }, fixedRandom);
    state = advanceBotTurns(state, fixedRandom);
    expect(state.phase).toBe('PLANNING');
    expect(state.round).toBe(2);
    expect(state.submitted[bot.id]).toBeUndefined();
    expect(state.activePlayerId).toBeNull();
  });

  it('can complete a two-bot race using only legal engine actions', () => {
    const state = createInitialGame(
      [{ ...human, id: 'bot-1', name: 'Bot 1', controller: 'BOT' as const }, bot],
      fixedRandom,
    );
    const finished = advanceBotTurns(state, fixedRandom);
    expect(finished.phase).toBe('FINISHED');
    expect(finished.players.every((player) => player.finishRank !== null)).toBe(true);
  });

  it('keeps four finishers in distinct Hall of Fame positions', () => {
    const state = createInitialGame(
      [
        { ...human, id: 'bot-1', name: 'Bot 1', controller: 'BOT' as const },
        bot,
        { id: 'bot-3', name: 'Bot 3', seat: 2, color: '#245c8c', controller: 'BOT' as const },
        { id: 'bot-4', name: 'Bot 4', seat: 3, color: '#2f7a54', controller: 'BOT' as const },
      ],
      fixedRandom,
    );
    const finished = advanceBotTurns(state, fixedRandom);
    expect(finished.phase).toBe('FINISHED');
    expect(finished.players.map((player) => player.position.space).sort((a, b) => a - b)).toEqual([
      41, 42, 43, 44,
    ]);
  });
});
