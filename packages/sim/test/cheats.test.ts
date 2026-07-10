import { describe, expect, it } from 'vitest';
import {
  CHEAT_MONEY,
  CHEAT_POWER,
  FOG_VISIBLE,
  MOTHERLOAD_CREDITS,
  MOTHERLOAD_POWER,
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

  it('MOTHERLOAD unlocks a prereq-gated unit for the cheater', () => {
    const state = createGame(1);
    // Player 0 starts with a CONYARD only — a TANK needs a FACTORY first.
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'TANK' }]);
    expect(state.players[0]!.queues.vehicle.item).toBeNull(); // gated off

    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MOTHERLOAD' }]);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'TANK' }]);
    expect(state.players[0]!.queues.vehicle.item).toBe('TANK'); // now buildable
  });

  it('MOTHERLOAD also reveals the whole map (like REVEAL)', () => {
    const state = createGame(1);
    expect(state.players[0]!.mapRevealed).toBe(false);
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MOTHERLOAD' }]);
    expect(state.players[0]!.mapRevealed).toBe(true);
    expect(state.players[1]!.mapRevealed).toBe(false); // opponent untouched
    tick(state);
    expect(state.fogs[0]!.every((f) => f === FOG_VISIBLE)).toBe(true);
  });

  it('MOTHERLOAD keeps credits and power topped up for the cheater only', () => {
    const state = createGame(2);
    const powerBefore = powerBalance(state, 0).produced;
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MOTHERLOAD' }]);

    expect(powerBalance(state, 0).produced).toBe(powerBefore + MOTHERLOAD_POWER);
    expect(powerBalance(state, 1).produced).toBe(powerBefore); // opponent untouched

    // Drain the cheater's credits — the next tick refills them.
    state.players[0]!.credits = 0;
    tick(state);
    expect(state.players[0]!.credits).toBe(MOTHERLOAD_CREDITS);
    expect(state.players[1]!.motherload).toBe(false);
  });

  it('cheats replay deterministically through the command log', () => {
    const run = (): string => {
      const state = createGame(42);
      tick(state, [
        { type: 'CHEAT', playerId: 0, cheat: 'MONEY' },
        { type: 'CHEAT', playerId: 0, cheat: 'REVEAL' },
        { type: 'CHEAT', playerId: 0, cheat: 'POWER' },
        { type: 'CHEAT', playerId: 0, cheat: 'MOTHERLOAD' },
      ]);
      for (let i = 0; i < 50; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
