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

  it('submits during planning and waits for the human player', () => {
    const state = createInitialGame([human, bot], fixedRandom);
    const next = advanceBotTurns(state, fixedRandom);
    expect(next.phase).toBe('PLANNING');
    expect(next.submitted[bot.id]).toBeDefined();
    expect(next.submitted[human.id]).toBeUndefined();
  });

  it('resolves its reactions and returns control without deadlocking', () => {
    let state = advanceBotTurns(createInitialGame([human, bot], fixedRandom), fixedRandom);
    state = applyGameAction(
      state,
      { type: 'SUBMIT_PLAN', playerId: human.id, gear: 1, cardIds: [humanCard(state)] },
      fixedRandom,
    );
    state = applyGameAction(state, { type: 'PASS_REACTION', playerId: human.id }, fixedRandom);
    state = advanceBotTurns(state, fixedRandom);
    expect(state.phase).toBe('PLANNING');
    expect(state.round).toBe(2);
    expect(state.submitted[bot.id]).toBeDefined();
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
});
