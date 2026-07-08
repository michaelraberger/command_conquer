import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  storedInBuilding,
  tick,
  type GameState,
} from '../src/index.js';

/** Two-player game on open ground, no stray units. Player 1 is the enemy. */
function arena(seed = 1): GameState {
  const state = createGame(seed); // 2 players, teams 0 vs 1
  state.units = [];
  state.occupancy.fill(0);
  state.terrain.fill(TERRAIN_DIRT); // passable everywhere for deterministic pathing
  return state;
}

describe('spy (Spion) ore theft', () => {
  it('infiltrates an enemy refinery, steals its stored ore and is consumed', () => {
    const state = arena();
    const enemyRef = constructBuilding(state, 'REFINERY', 1, 30, 30);
    state.players[1]!.credits = 3000; // enemy has ore stored
    state.players[0]!.credits = 0; // room to receive the loot
    const spy = spawnUnit(state, 'SPION', 0, 28, 30);
    const stolen = storedInBuilding(state, enemyRef);
    expect(stolen).toBeGreaterThan(0);

    tick(state, [{ type: 'INFILTRATE', playerId: 0, unitIds: [spy.id], targetId: enemyRef.id }]);
    for (let i = 0; i < 120 && state.units.some((u) => u.id === spy.id); i++) tick(state);

    expect(state.units.some((u) => u.id === spy.id)).toBe(false); // spent
    expect(state.buildings.some((b) => b.id === enemyRef.id)).toBe(true); // building stands
    expect(state.players[1]!.credits).toBe(3000 - stolen); // enemy robbed
    expect(state.players[0]!.credits).toBe(stolen); // owner enriched (within cap)
  });

  it('steals from a silo too, capped by the thief\'s own storage', () => {
    const state = arena(2);
    const silo = constructBuilding(state, 'SILO', 1, 30, 30);
    state.players[1]!.credits = 3000;
    state.players[0]!.credits = 0; // only a 2000-cap conyard → gains are capped at 2000
    const spy = spawnUnit(state, 'SPION', 0, 28, 30);
    const stolen = storedInBuilding(state, silo);

    tick(state, [{ type: 'INFILTRATE', playerId: 0, unitIds: [spy.id], targetId: silo.id }]);
    for (let i = 0; i < 120 && state.units.some((u) => u.id === spy.id); i++) tick(state);

    expect(state.players[1]!.credits).toBe(3000 - stolen);
    expect(state.players[0]!.credits).toBe(Math.min(stolen, 2000));
  });

  it('cannot target an own building or an enemy building with no storage', () => {
    const state = arena(3);
    const ownRef = constructBuilding(state, 'REFINERY', 0, 20, 20);
    const enemyPower = constructBuilding(state, 'POWER', 1, 30, 30); // no storage
    const spy = spawnUnit(state, 'SPION', 0, 25, 20);

    tick(state, [{ type: 'INFILTRATE', playerId: 0, unitIds: [spy.id], targetId: ownRef.id }]);
    expect(spy.order).toBeNull();
    tick(state, [{ type: 'INFILTRATE', playerId: 0, unitIds: [spy.id], targetId: enemyPower.id }]);
    expect(spy.order).toBeNull();
  });

  it('stays deterministic through an infiltration', () => {
    const run = (): string => {
      const state = arena(9);
      constructBuilding(state, 'REFINERY', 1, 30, 30);
      state.players[1]!.credits = 2500;
      const spy = spawnUnit(state, 'SPION', 0, 27, 30);
      tick(state, [{ type: 'INFILTRATE', playerId: 0, unitIds: [spy.id], targetId: state.buildings.find((b) => b.owner === 1 && b.type === 'REFINERY')!.id }]);
      for (let i = 0; i < 100; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
