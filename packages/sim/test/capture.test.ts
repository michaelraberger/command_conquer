import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_OWNER,
  TERRAIN_DIRT,
  buildingRule,
  cellIndex,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  storageCapacity,
  tick,
  type GameState,
} from '../src/index.js';

/** Two-player game on open ground, no stray units. Player 1 is the enemy. */
function arena(seed = 1): GameState {
  const state = createGame(seed);
  state.units = [];
  state.occupancy.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  return state;
}

describe('Ingenieur (CAPTURE)', () => {
  it('captures an enemy building: owner flips, engineer consumed, hp untouched', () => {
    const state = arena();
    const enemyPower = constructBuilding(state, 'POWER', 1, 30, 30);
    enemyPower.hp = 400; // pre-damaged — capture must not repair it
    const eng = spawnUnit(state, 'ENGINEER', 0, 28, 30);

    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: enemyPower.id }]);
    for (let i = 0; i < 150 && state.units.some((u) => u.id === eng.id); i++) tick(state);

    expect(state.units.some((u) => u.id === eng.id)).toBe(false); // consumed
    expect(enemyPower.owner).toBe(0);
    expect(enemyPower.hp).toBe(400);
    expect(state.buildings.some((b) => b.id === enemyPower.id)).toBe(true);
  });

  it('re-stamps the gateOwner grid when a GATE is captured', () => {
    const state = arena(2);
    const gate = constructBuilding(state, 'GATE', 1, 30, 30);
    const rule = buildingRule('GATE');
    const eng = spawnUnit(state, 'ENGINEER', 0, 27, 30);

    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: gate.id }]);
    for (let i = 0; i < 150 && state.units.some((u) => u.id === eng.id); i++) tick(state);

    expect(gate.owner).toBe(0);
    for (let y = gate.cy; y < gate.cy + rule.height; y++) {
      for (let x = gate.cx; x < gate.cx + rule.width; x++) {
        expect(state.gateOwner[cellIndex(state, x, y)]).toBe(0 + 1);
      }
    }
  });

  it('rejects own buildings and ignores non-engineer units', () => {
    const state = arena(3);
    const ownPower = constructBuilding(state, 'POWER', 0, 30, 30);
    const enemyPower = constructBuilding(state, 'POWER', 1, 40, 40);
    const eng = spawnUnit(state, 'ENGINEER', 0, 28, 30);
    const tank = spawnUnit(state, 'TANK', 0, 28, 32);

    tick(state, [
      { type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: ownPower.id },
      { type: 'CAPTURE', playerId: 0, unitIds: [tank.id], targetId: enemyPower.id },
    ]);
    expect(eng.order).toBeNull(); // own building: command dropped
    expect(tank.order).toBeNull(); // tanks can't capture

    for (let i = 0; i < 60; i++) tick(state);
    expect(ownPower.owner).toBe(0);
    expect(enemyPower.owner).toBe(1);
    expect(state.units.some((u) => u.id === eng.id)).toBe(true); // not consumed
  });

  it('captures a neutral Bohrturm: +500 once, then +10/s — even above storage cap', () => {
    const state = arena(4);
    const spike = constructBuilding(state, 'ERZ_BOHRTURM', NEUTRAL_OWNER, 30, 30);
    const eng = spawnUnit(state, 'ENGINEER', 0, 28, 31);
    const cap = storageCapacity(state, 0);
    state.players[0]!.credits = cap + 1000; // already over the silo limit

    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: spike.id }]);
    for (let i = 0; i < 150 && state.units.some((u) => u.id === eng.id); i++) tick(state);

    expect(spike.owner).toBe(0);
    const afterBonus = state.players[0]!.credits;
    expect(afterBonus).toBe(cap + 1000 + 500); // lump ignores the cap

    // Advance exactly 30 ticks past the next full second boundary → +20 drip.
    while (state.tick % 15 !== 0) tick(state);
    const base = state.players[0]!.credits;
    for (let i = 0; i < 30; i++) tick(state);
    expect(state.players[0]!.credits).toBe(base + 20);
  });

  it('the order dissolves when someone else captures the target first', () => {
    const state = arena(5);
    const spike = constructBuilding(state, 'ERZ_BOHRTURM', NEUTRAL_OWNER, 30, 30);
    const near = spawnUnit(state, 'ENGINEER', 0, 28, 31);
    const far = spawnUnit(state, 'ENGINEER', 0, 10, 10);

    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [near.id, far.id], targetId: spike.id }]);
    for (let i = 0; i < 200 && state.units.some((u) => u.id === near.id); i++) tick(state);

    expect(spike.owner).toBe(0);
    for (let i = 0; i < 20; i++) tick(state);
    const survivor = state.units.find((u) => u.id === far.id);
    expect(survivor).toBeDefined(); // second engineer survives …
    expect(survivor!.order).toBeNull(); // … and drops the stale order
  });
});

describe('neutrale Gebäude', () => {
  it('are not auto-attacked, but an explicit ATTACK still hurts them', () => {
    const state = arena(6);
    const spike = constructBuilding(state, 'ERZ_BOHRTURM', NEUTRAL_OWNER, 30, 30);
    constructBuilding(state, 'TESLA', 1, 34, 30); // enemy defense right next door
    const tank = spawnUnit(state, 'TANK', 0, 27, 30); // idle tank beside it
    state.players[1]!.powerBonus = 1000; // tesla fully powered

    const hp = spike.hp;
    for (let i = 0; i < 60; i++) tick(state);
    expect(spike.hp).toBe(hp); // nobody fired at the neutral tower

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: spike.id }]);
    for (let i = 0; i < 120 && spike.hp === hp; i++) tick(state);
    expect(spike.hp).toBeLessThan(hp); // deliberate attack works
  });

  it('do not keep an eliminated player alive or block victory', () => {
    const state = arena(7);
    constructBuilding(state, 'ERZ_BOHRTURM', NEUTRAL_OWNER, 30, 30);
    // Wipe player 1 (arena kept the two conyards from createGame).
    state.buildings = state.buildings.filter((b) => b.owner !== 1);
    for (let i = 0; i < 5; i++) tick(state);
    expect(state.winner).toBe(0); // neutral tower doesn't keep the game alive
  });

  it('capture + income stay deterministic (bit-identical runs)', () => {
    const run = (): string => {
      const state = arena(8);
      const spike = constructBuilding(state, 'ERZ_BOHRTURM', NEUTRAL_OWNER, 30, 30);
      const eng = spawnUnit(state, 'ENGINEER', 0, 28, 31);
      tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: spike.id }]);
      for (let i = 0; i < 200; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
