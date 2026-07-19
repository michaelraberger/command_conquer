import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  TERRAIN_ROCK,
  TRANSPORT_CAPACITY,
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

/** Empty battlefield with both HQs so nobody auto-loses. Terrain normalised
 *  to plain dirt so generator changes never shift the movement targets. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
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

  it('the combat helicopter engages enemy aircraft (targets: both)', () => {
    expect(unitRule('HELI').weapon!.targets).toBe('both');

    // Ordered air-to-air attack: the order is accepted and the rockets connect.
    const state = arena();
    const heli = spawnUnit(state, 'HELI', 0, 18, 18);
    const enemyLift = spawnUnit(state, 'AIRLIFT', 1, 20, 18);
    enemyLift.path = null;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [heli.id], targetId: enemyLift.id }]);
    expect(heli.order).not.toBeNull();
    runTicks(state, 60);
    expect(enemyLift.hp).toBeLessThan(unitRule('AIRLIFT').maxHp);

    // Still anti-ground: it engages a tank as before.
    const ground = arena();
    const h = spawnUnit(ground, 'HELI', 0, 18, 18);
    const tank = spawnUnit(ground, 'TANK', 1, 20, 18);
    tick(ground, [{ type: 'ATTACK', playerId: 0, unitIds: [h.id], targetId: tank.id }]);
    runTicks(ground, 60);
    expect(tank.hp).toBeLessThan(unitRule('TANK').maxHp);
  });

  it('rocket infantry hit both aircraft and the ground (targets: both)', () => {
    expect(unitRule('ROCKETEER').weapon!.targets).toBe('both');

    // Anti-air: an idle rocketeer auto-fires at a passing enemy helicopter.
    const air = arena();
    spawnUnit(air, 'ROCKETEER', 0, 18, 18);
    const heli = spawnUnit(air, 'HELI', 1, 20, 18); // enemy, within range 5
    heli.path = null;
    runTicks(air, 60);
    expect(heli.hp).toBeLessThan(unitRule('HELI').maxHp);

    // Still anti-ground: it also engages an enemy tank as before.
    const ground = arena();
    spawnUnit(ground, 'ROCKETEER', 0, 18, 18);
    const tank = spawnUnit(ground, 'TANK', 1, 20, 18);
    runTicks(ground, 60);
    expect(tank.hp).toBeLessThan(unitRule('TANK').maxHp);
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

describe('air transport', () => {
  it('lifts a squad, flies it over a barrier and drops it inland', () => {
    const state = arena();
    // Rock wall down column 30: no ground path from the near to the far side.
    for (let y = 0; y < state.mapHeight; y++) state.terrain[cellIndex(state, 30, y)] = TERRAIN_ROCK;
    const lift = spawnUnit(state, 'AIRLIFT', 0, 12, 20);
    const r1 = spawnUnit(state, 'RIFLEMAN', 0, 13, 20);
    const r2 = spawnUnit(state, 'RIFLEMAN', 0, 13, 21);
    r2.hp = 40; // damaged passenger keeps its hp through the airlift

    tick(state, [{ type: 'LOAD', playerId: 0, unitIds: [r1.id, r2.id], transportId: lift.id }]);
    for (let i = 0; i < 200 && lift.passengers.length < 2; i++) tick(state);
    expect(lift.passengers.length).toBe(2);
    // Aboard units have left the battlefield.
    expect(state.units.some((u) => u.id === r1.id)).toBe(false);

    // Fly straight across the wall to the far side — a ship or ground unit never
    // could. The transport ignores the rock.
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [lift.id], cx: 40, cy: 20 }]);
    for (let i = 0; i < 300 && lift.path; i++) tick(state);
    expect(lift.cell % state.mapWidth).toBeGreaterThan(30);

    // Drop the squad on the far side; passengers reappear on open land nearby.
    tick(state, [{ type: 'UNLOAD', playerId: 0, unitIds: [lift.id] }]);
    expect(lift.passengers.length).toBe(0);
    const dropped = state.units.filter((u) => u.id === r1.id || u.id === r2.id);
    expect(dropped.length).toBe(2);
    for (const u of dropped) expect(u.cell % state.mapWidth).toBeGreaterThan(30);
    expect(state.units.find((u) => u.id === r2.id)!.hp).toBe(40);
  });

  it('shares the transport capacity (max 5 aboard)', () => {
    const state = arena();
    const lift = spawnUnit(state, 'AIRLIFT', 0, 12, 20);
    const ids: number[] = [];
    for (let i = 0; i < TRANSPORT_CAPACITY + 1; i++) {
      ids.push(spawnUnit(state, 'RIFLEMAN', 0, 14, 16 + i).id);
    }
    tick(state, [{ type: 'LOAD', playerId: 0, unitIds: ids, transportId: lift.id }]);
    for (let i = 0; i < 300 && lift.passengers.length < TRANSPORT_CAPACITY; i++) tick(state);
    expect(lift.passengers.length).toBe(TRANSPORT_CAPACITY);
  });

  it('is an unarmed aircraft only anti-air can touch', () => {
    expect(unitRule('AIRLIFT').air).toBe(true);
    expect(unitRule('AIRLIFT').carrier).toBe(true);
    expect(unitRule('AIRLIFT').weapon).toBeNull();
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
