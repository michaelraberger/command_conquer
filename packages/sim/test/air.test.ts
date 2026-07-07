import { describe, expect, it } from 'vitest';
import {
  TERRAIN_ROCK,
  cellCenter,
  cellIndex,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Empty battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

describe('air movement', () => {
  it('aircraft fly straight over impassable terrain a ground unit cannot cross', () => {
    const state = arena();
    // Full rock barrier down column 20 — no ground path to the far side.
    for (let y = 0; y < state.mapHeight; y++) state.terrain[cellIndex(state, 20, y)] = TERRAIN_ROCK;
    const heli = spawnUnit(state, 'HELI', 0, 15, 20);
    const tank = spawnUnit(state, 'TANK', 0, 15, 22);

    tick(state, [
      { type: 'MOVE', playerId: 0, unitIds: [heli.id], cx: 25, cy: 20 },
      { type: 'MOVE', playerId: 0, unitIds: [tank.id], cx: 25, cy: 22 },
    ]);
    for (let i = 0; i < 300 && (heli.path || tank.path); i++) tick(state);

    // Helicopter flew over the barrier and reached the far side.
    expect(heli.x).toBe(cellCenter(25));
    expect(heli.y).toBe(cellCenter(20));
    // Tank is stuck on the near side (never crossed column 20).
    expect(tank.cell % state.mapWidth).toBeLessThan(20);
  });

  it('aircraft never claim a ground cell (units stack freely)', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const h1 = spawnUnit(state, 'HELI', 0, 18, 18);
    const h2 = spawnUnit(state, 'HELI', 0, 18, 18);
    expect(state.units.map((u) => u.id).sort()).toEqual([tank.id, h1.id, h2.id].sort());
    // The ground cell belongs to the tank only.
    expect(state.occupancy[cellIndex(state, 18, 18)]).toBe(tank.id);
  });
});

describe('air vs ground targeting', () => {
  it('ground weapons cannot hit aircraft', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const heli = spawnUnit(state, 'HELI', 1, 20, 18); // enemy, in tank range

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: heli.id }]);
    expect(tank.order).toBeNull(); // refused
    heli.path = null; // keep it parked in range
    runTicks(state, 40);
    expect(heli.hp).toBe(unitRule('HELI').maxHp); // tank never scratched it
  });

  it('flak shreds aircraft but ignores ground units', () => {
    const state = arena();
    spawnUnit(state, 'FLAK', 0, 18, 18);
    const enemyHeli = spawnUnit(state, 'HELI', 1, 20, 18);
    const enemyTank = spawnUnit(state, 'TANK', 1, 18, 20);
    enemyHeli.path = null;

    runTicks(state, 30);
    expect(enemyHeli.hp).toBeLessThan(unitRule('HELI').maxHp); // flak hit the aircraft
    expect(enemyTank.hp).toBe(unitRule('TANK').maxHp); // flak can't touch the ground
  });

  it('the flak tower defends against aircraft', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 1, 50, 50); // keep the tower powered
    constructBuilding(state, 'FLAKTOWER', 1, 30, 30);
    const heli = spawnUnit(state, 'HELI', 0, 31, 30); // adjacent, in range
    heli.path = null;
    runTicks(state, 20);
    expect(heli.hp).toBeLessThan(unitRule('HELI').maxHp);
  });
});

describe('air production', () => {
  it('the helipad produces aircraft', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 0, 8, 8); // avoid the low-power build penalty
    constructBuilding(state, 'HELIPAD', 0, 15, 15);
    state.players[0]!.credits = 5000;
    const before = state.units.length;
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'HELI' }]);
    for (let i = 0; i < 200 && state.units.length === before; i++) tick(state);
    const made = state.units[state.units.length - 1];
    expect(made?.type).toBe('HELI');
    expect(unitRule('HELI').air).toBe(true);
  });
});

describe('air determinism', () => {
  it('stays deterministic through an air battle', () => {
    const run = (): string => {
      const state = arena(123);
      spawnUnit(state, 'HELI', 0, 18, 18);
      spawnUnit(state, 'JET', 0, 18, 20);
      const ids = state.units.filter((u) => u.owner === 0).map((u) => u.id);
      spawnUnit(state, 'FLAK', 1, 30, 19);
      spawnUnit(state, 'TANK', 1, 30, 22);
      tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: ids, cx: 30, cy: 20 }]);
      runTicks(state, 200);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
