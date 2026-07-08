import { describe, expect, it } from 'vitest';
import {
  constructBuilding,
  createGame,
  storageCapacity,
  storedInBuilding,
  tick,
} from '../src/index.js';

describe('ore storage cap', () => {
  it('capacity is the sum of a player\'s storage buildings', () => {
    const state = createGame(1);
    expect(storageCapacity(state, 0)).toBe(2000); // starting construction yard
    constructBuilding(state, 'REFINERY', 0, 20, 20);
    expect(storageCapacity(state, 0)).toBe(4000); // + refinery 2000
    constructBuilding(state, 'SILO', 0, 25, 25);
    expect(storageCapacity(state, 0)).toBe(5200); // + silo 1200
  });

  it('starting credits above capacity are never force-reduced', () => {
    const state = createGame(1); // 5000 credits, only a 2000-cap conyard
    expect(state.players[0]!.credits).toBe(5000);
    for (let i = 0; i < 50; i++) tick(state);
    expect(state.players[0]!.credits).toBe(5000);
  });

  it('harvested ore is wasted once the cap is reached', () => {
    const state = createGame(7); // has a starting harvester + ore
    constructBuilding(state, 'REFINERY', 0, 17, 19);
    const cap = storageCapacity(state, 0); // conyard + refinery = 4000
    state.players[0]!.credits = cap - 100; // 100 of room left
    for (let i = 0; i < 900; i++) tick(state);
    // Filled exactly to the cap; every further load evaporated.
    expect(state.players[0]!.credits).toBe(cap);
  });

  it('destroying a storage building forfeits the ore stored in it', () => {
    const state = createGame(1);
    constructBuilding(state, 'REFINERY', 0, 20, 20); // cap 4000
    state.players[0]!.credits = 4000; // storage full
    const silo = constructBuilding(state, 'SILO', 0, 25, 25); // cap 5200
    const stored = storedInBuilding(state, silo); // floor(4000 * 1200 / 5200)
    expect(stored).toBeGreaterThan(0);
    const before = state.players[0]!.credits;
    silo.hp = 0; // deathSystem removes it this tick
    tick(state);
    expect(state.buildings.some((b) => b.id === silo.id)).toBe(false);
    expect(state.players[0]!.credits).toBe(before - stored);
  });

  it('a destroyed building never pushes credits below zero', () => {
    const state = createGame(1);
    const ref = constructBuilding(state, 'REFINERY', 0, 20, 20);
    state.players[0]!.credits = 10; // almost nothing stored
    ref.hp = 0;
    tick(state);
    expect(state.players[0]!.credits).toBeGreaterThanOrEqual(0);
  });
});
