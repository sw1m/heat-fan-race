import { describe, expect, it } from 'vitest';
import { advanceBotTurns, chooseBotPlan } from './bot';
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

function humanCard(state: GameState): string {
  return state.players
    .find((player) => player.id === human.id)!
    .hand.find((card) => card.kind !== 'HEAT' && card.kind !== 'STARTING_HEAT')!.id;
}

describe('rules-following bot', () => {
  it('chooses a plan that the authoritative engine accepts', () => {
    const state = createInitialGame([human, bot], fixedRandom);
    const action = chooseBotPlan(state, bot.id);
    expect(action.type).toBe('SUBMIT_PLAN');
    if (action.type !== 'SUBMIT_PLAN') throw new Error('Expected a submitted plan.');
    expect(action.cardIds).toHaveLength(action.gear);
    expect(() => applyGameAction(state, action, fixedRandom)).not.toThrow();
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
