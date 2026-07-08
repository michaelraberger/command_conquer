import { describe, expect, it } from 'vitest';
import {
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  tick,
  type BalanceConfig,
  type GameState,
} from '../src/index.js';

/** Soviet player with a factory + techcenter and fast, cheap 'armor' research. */
function labGame(): GameState {
  const balance: BalanceConfig = { research: { armor: { cost: 100, time: 10 } } };
  const state = createGame(1, { factions: ['SOVIETS'], balance });
  constructBuilding(state, 'FACTORY', 0, 18, 18);
  constructBuilding(state, 'TECHCENTER', 0, 22, 18);
  state.players[0]!.credits = 5000;
  return state;
}

describe('tech research', () => {
  it('gates advanced units until their tech is researched', () => {
    const state = labGame();
    // MAMMOTH needs 'armor' — not researched yet, so it cannot be queued.
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'MAMMOTH' }]);
    expect(state.players[0]!.queues.vehicle.item).toBeNull();

    // Research it: credits drain over the research time, then it completes.
    const before = state.players[0]!.credits;
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'armor' }]);
    expect(state.players[0]!.research?.tech).toBe('armor');
    for (let i = 0; i < 15 && state.players[0]!.research !== null; i++) tick(state);
    expect(state.players[0]!.researched).toContain('armor');
    expect(state.players[0]!.research).toBeNull();
    expect(state.players[0]!.credits).toBe(before - 100);

    // Now the mammoth can be built.
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'MAMMOTH' }]);
    expect(state.players[0]!.queues.vehicle.item).toBe('MAMMOTH');
  });

  it('researches one tech at a time', () => {
    const state = labGame();
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'armor' }]);
    // A second start is ignored while one is in progress.
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'tesla' }]);
    expect(state.players[0]!.research?.tech).toBe('armor');
  });

  it('cannot research a tech of the wrong faction', () => {
    const balance: BalanceConfig = { research: { artillery: { cost: 100, time: 10 } } };
    const state = createGame(1, { factions: ['SOVIETS'], balance });
    constructBuilding(state, 'TECHCENTER', 0, 22, 18);
    // 'artillery' is an Allied tech — a Soviet player can't research it.
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'artillery' }]);
    expect(state.players[0]!.research).toBeNull();
  });

  it('needs a Techzentrum to research at all', () => {
    const state = createGame(1, { factions: ['SOVIETS'] });
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'armor' }]);
    expect(state.players[0]!.research).toBeNull();
  });

  it('cancelling research refunds what was paid', () => {
    const state = labGame();
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'armor' }]);
    for (let i = 0; i < 5; i++) tick(state);
    const mid = state.players[0]!.credits;
    tick(state, [{ type: 'RESEARCH_CANCEL', playerId: 0 }]);
    expect(state.players[0]!.research).toBeNull();
    expect(state.players[0]!.credits).toBeGreaterThan(mid); // got some back
  });

  it('research state round-trips through serialization', () => {
    const state = labGame();
    tick(state, [{ type: 'RESEARCH_START', playerId: 0, tech: 'armor' }]);
    for (let i = 0; i < 4; i++) tick(state);
    const copy = deserialize(serialize(state));
    for (let i = 0; i < 20; i++) { tick(state); tick(copy); }
    expect(hashState(copy)).toBe(hashState(state));
    expect(copy.players[0]!.researched).toEqual(state.players[0]!.researched);
  });
});
