import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  buildingRule,
  constructBuilding,
  createGame,
  startProduction,
  tick,
  type BuildingType,
  type GameState,
} from '../src/index.js';

/** Empty dirt battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  state.ore.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

describe.each(['RADAR', 'TECHCENTER'] as BuildingType[])('%s ist ein Unikat', (type) => {
  it('rejects a second build while one stands, allows rebuilding after loss', () => {
    expect(buildingRule(type).unique).toBe(true);
    const state = arena();
    state.players[0]!.credits = 50000;
    // Motherload skips prereq gates but deliberately NOT the unique gate —
    // isolates exactly the check under test (same trick as ironCurtain.test).
    state.players[0]!.motherload = true;
    const standing = constructBuilding(state, type, 0, 20, 20);

    startProduction(state, 0, type);
    expect(state.players[0]!.queues.building.item).toBeNull(); // rejected

    standing.hp = 0;
    tick(state); // deathSystem removes it
    startProduction(state, 0, type);
    expect(state.players[0]!.queues.building.item).toBe(type); // rebuild ok
  });

  it('only blocks the OWNING player — the enemy builds their own', () => {
    const state = arena();
    state.players[1]!.credits = 50000;
    state.players[1]!.motherload = true;
    constructBuilding(state, type, 0, 20, 20); // player 0 owns one
    startProduction(state, 1, type);
    expect(state.players[1]!.queues.building.item).toBe(type);
  });
});
