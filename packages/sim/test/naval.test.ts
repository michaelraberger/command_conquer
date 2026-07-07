import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  TERRAIN_WATER,
  TRANSPORT_CAPACITY,
  canPlaceBuilding,
  cellIndex,
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/**
 * Controlled battlefield: all dirt with a full-height sea channel in columns
 * 20–27, HQs on both sides so nobody auto-loses.
 */
function coast(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.ore.fill(0);
  state.resourceKind.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 20; x <= 27; x++) state.terrain[cellIndex(state, x, y)] = TERRAIN_WATER;
  }
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

const cellOf = (state: GameState, u: { cell: number }): { cx: number; cy: number } => ({
  cx: u.cell % state.mapWidth,
  cy: Math.floor(u.cell / state.mapWidth),
});

describe('naval movement', () => {
  it('ships sail the channel; ground units cannot enter it', () => {
    const state = coast();
    const boat = spawnUnit(state, 'GUNBOAT', 0, 22, 10);
    const tank = spawnUnit(state, 'TANK', 0, 15, 10);

    tick(state, [
      { type: 'MOVE', playerId: 0, unitIds: [boat.id], cx: 24, cy: 50 },
      { type: 'MOVE', playerId: 0, unitIds: [tank.id], cx: 24, cy: 50 },
    ]);
    for (let i = 0; i < 400 && (boat.path || tank.path); i++) tick(state);

    const b = cellOf(state, boat);
    expect(b.cx).toBe(24);
    expect(b.cy).toBe(50);
    // The tank stopped at the shore — never on a water cell.
    expect(state.terrain[tank.cell]).toBe(TERRAIN_DIRT);
    expect(cellOf(state, tank).cx).toBeLessThan(20);
  });

  it('a ship ordered onto land stays on water (shore stop)', () => {
    const state = coast();
    const boat = spawnUnit(state, 'GUNBOAT', 0, 22, 10);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [boat.id], cx: 35, cy: 10 }]);
    for (let i = 0; i < 300 && boat.path; i++) tick(state);
    expect(state.terrain[boat.cell]).toBe(TERRAIN_WATER);
  });
});

describe('shipyard', () => {
  it('must be placed on water within the build radius, never on land', () => {
    const state = coast();
    constructBuilding(state, 'POWER', 0, 17, 17); // shore building opens radius
    expect(canPlaceBuilding(state, 0, 'SHIPYARD', 20, 16)).toBe(true); // water, in radius
    expect(canPlaceBuilding(state, 0, 'SHIPYARD', 14, 16)).toBe(false); // land
    expect(canPlaceBuilding(state, 0, 'SHIPYARD', 22, 40)).toBe(false); // water, out of radius
    expect(canPlaceBuilding(state, 0, 'POWER', 20, 16)).toBe(false); // land building on water
  });

  it('produces ships that spawn on open water', () => {
    const state = coast();
    constructBuilding(state, 'POWER', 0, 8, 8);
    constructBuilding(state, 'SHIPYARD', 0, 21, 20);
    state.players[0]!.credits = 5000;
    const before = state.units.length;
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'GUNBOAT' }]);
    for (let i = 0; i < 200 && state.units.length === before; i++) tick(state);
    const boat = state.units[state.units.length - 1];
    expect(boat?.type).toBe('GUNBOAT');
    expect(state.terrain[boat!.cell]).toBe(TERRAIN_WATER);
  });
});

describe('submarines', () => {
  it('only antiSub weapons hit the sub; the sub sinks surface ships', () => {
    const state = coast();
    const boat = spawnUnit(state, 'GUNBOAT', 0, 22, 20); // no antiSub
    const sub = spawnUnit(state, 'SUB', 1, 22, 23); // in everyone's range
    boat.path = null;

    // An explicit attack on the submerged sub is refused.
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [boat.id], targetId: sub.id }]);
    expect(boat.order).toBeNull();

    runTicks(state, 120);
    expect(sub.hp).toBe(unitRule('SUB').maxHp); // untouched under water
    expect(boat.hp).toBeLessThan(unitRule('GUNBOAT').maxHp); // torpedoed

    // The destroyer's depth charges do reach it.
    const destroyer = spawnUnit(state, 'DESTROYER', 0, 22, 21);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [destroyer.id], targetId: sub.id }]);
    runTicks(state, 60);
    expect(sub.hp).toBeLessThan(unitRule('SUB').maxHp);
  });

  it('torpedoes never engage land targets or buildings', () => {
    const state = coast();
    const sub = spawnUnit(state, 'SUB', 1, 22, 10);
    const tank = spawnUnit(state, 'TANK', 0, 19, 10); // right at the shore
    const hq = state.buildings.find((b) => b.owner === 0)!;

    tick(state, [{ type: 'ATTACK', playerId: 1, unitIds: [sub.id], targetId: tank.id }]);
    expect(sub.order).toBeNull(); // refused: not a ship
    tick(state, [{ type: 'ATTACK', playerId: 1, unitIds: [sub.id], targetId: hq.id }]);
    expect(sub.order).toBeNull(); // refused: building
    runTicks(state, 60);
    expect(tank.hp).toBe(unitRule('TANK').maxHp); // guard fire never triggered
  });
});

describe('transport ship', () => {
  it('loads ground units, ferries them and unloads on the far shore', () => {
    const state = coast();
    const transport = spawnUnit(state, 'TRANSPORT', 0, 21, 20);
    const r1 = spawnUnit(state, 'RIFLEMAN', 0, 17, 20);
    const r2 = spawnUnit(state, 'RIFLEMAN', 0, 17, 21);
    r2.hp = 42; // damaged passengers keep their hp across the trip

    tick(state, [
      { type: 'LOAD', playerId: 0, unitIds: [r1.id, r2.id], transportId: transport.id },
    ]);
    for (let i = 0; i < 200 && transport.passengers.length < 2; i++) tick(state);
    expect(transport.passengers.length).toBe(2);
    expect(state.units.some((u) => u.id === r1.id || u.id === r2.id)).toBe(false);

    // Serialization carries passengers (replays/multiplayer stay in sync).
    expect(hashState(deserialize(serialize(state)))).toBe(hashState(state));

    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [transport.id], cx: 26, cy: 44 }]);
    for (let i = 0; i < 400 && transport.path; i++) tick(state);

    tick(state, [{ type: 'UNLOAD', playerId: 0, unitIds: [transport.id] }]);
    expect(transport.passengers.length).toBe(0);
    const out1 = state.units.find((u) => u.id === r1.id)!;
    const out2 = state.units.find((u) => u.id === r2.id)!;
    expect(state.terrain[out1.cell]).toBe(TERRAIN_DIRT);
    expect(out2.hp).toBe(42);
    // They really crossed: east of the channel now.
    expect(cellOf(state, out1).cx).toBeGreaterThan(27);
  });

  it('enforces the passenger capacity', () => {
    const state = coast();
    const transport = spawnUnit(state, 'TRANSPORT', 0, 21, 20);
    const ids: number[] = [];
    for (let i = 0; i < TRANSPORT_CAPACITY + 1; i++) {
      ids.push(spawnUnit(state, 'RIFLEMAN', 0, 18, 16 + i).id);
    }
    tick(state, [{ type: 'LOAD', playerId: 0, unitIds: ids, transportId: transport.id }]);
    runTicks(state, 300);
    expect(transport.passengers.length).toBe(TRANSPORT_CAPACITY);
    // The unlucky straggler is still ashore with its order cleared.
    const left = state.units.filter((u) => ids.includes(u.id));
    expect(left.length).toBe(1);
    expect(left[0]!.order).toBeNull();
  });
});

describe('naval determinism', () => {
  it('stays deterministic through a naval battle with boarding', () => {
    const run = (): string => {
      const state = coast(123);
      const transport = spawnUnit(state, 'TRANSPORT', 0, 21, 18);
      const rifle = spawnUnit(state, 'RIFLEMAN', 0, 18, 18);
      const destroyer = spawnUnit(state, 'DESTROYER', 0, 22, 12);
      spawnUnit(state, 'SUB', 1, 23, 30);
      spawnUnit(state, 'GUNBOAT', 1, 24, 32);
      tick(state, [
        { type: 'LOAD', playerId: 0, unitIds: [rifle.id], transportId: transport.id },
        { type: 'ATTACK_MOVE', playerId: 0, unitIds: [destroyer.id], cx: 24, cy: 34 },
      ]);
      runTicks(state, 250);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
