import { describe, expect, it } from 'vitest';
import {
  CHEAT_MONEY,
  CHEAT_POWER,
  FOG_VISIBLE,
  createGame,
  hashState,
  powerBalance,
  tick,
} from '../src/index.js';

describe('cheats', () => {
  it('MONEY grants credits, stacking per use', () => {
    const state = createGame(1);
    const before = state.players[0]!.credits;
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MONEY' }]);
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MONEY' }]);
    // Two cheats minus whatever production drained (nothing queued → exact).
    expect(state.players[0]!.credits).toBe(before + 2 * CHEAT_MONEY);
    expect(state.players[1]!.credits).toBe(before); // only the cheater profits
  });

  it('POWER adds a flat bonus to the power balance', () => {
    const state = createGame(2);
    const before = powerBalance(state, 0).produced;
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'POWER' }]);
    expect(powerBalance(state, 0).produced).toBe(before + CHEAT_POWER);
    expect(powerBalance(state, 1).produced).toBe(before);
  });

  it('REVEAL keeps the whole map permanently visible for the cheater only', () => {
    const state = createGame(3);
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'REVEAL' }]);
    for (let i = 0; i < 6; i++) tick(state); // past the fog refresh interval
    expect(state.fogs[0]!.every((f) => f === FOG_VISIBLE)).toBe(true);
    expect(state.fogs[1]!.every((f) => f === FOG_VISIBLE)).toBe(false);
    for (let i = 0; i < 30; i++) tick(state); // stays revealed, never decays
    expect(state.fogs[0]!.every((f) => f === FOG_VISIBLE)).toBe(true);
  });

  it('cheats replay deterministically through the command log', () => {
    const run = (): string => {
      const state = createGame(42);
      tick(state, [
        { type: 'CHEAT', playerId: 0, cheat: 'MONEY' },
        { type: 'CHEAT', playerId: 0, cheat: 'REVEAL' },
        { type: 'CHEAT', playerId: 0, cheat: 'POWER' },
      ]);
      for (let i = 0; i < 50; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
