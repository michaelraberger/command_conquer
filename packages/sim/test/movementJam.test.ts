import { describe, expect, it } from 'vitest';
import {
  INFANTRY_STACK,
  TERRAIN_DIRT,
  TERRAIN_ROCK,
  cellBlockedFor,
  cellIndex,
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  spawnUnit,
  tick,
  type GameState,
  type Unit,
} from '../src/index.js';

/** Bare dirt arena: no units, no buildings, no water — pure movement lab. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 1, 55); // keeps victory checks quiet
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** Paints rock everywhere in the rectangle except the given corridor row. */
function rockWithCorridor(state: GameState, y0: number, y1: number, corridorY: number): void {
  for (let y = y0; y <= y1; y++) {
    if (y === corridorY) continue;
    for (let x = 0; x < state.mapWidth; x++) {
      state.terrain[cellIndex(state, x, y)] = TERRAIN_ROCK;
    }
  }
}

function cellOf(state: GameState, u: Unit): { cx: number; cy: number } {
  const cx = u.cell % state.mapWidth;
  return { cx, cy: (u.cell - cx) / state.mapWidth };
}

describe('Anti-Stau: eingekeilte Einheiten kommen immer frei', () => {
  it('a harvester ringed by 8 idle own tanks still reaches a far cell (yield)', () => {
    const state = arena();
    const harv = spawnUnit(state, 'HARVESTER', 0, 20, 20);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        spawnUnit(state, 'TANK', 0, 20 + dx, 20 + dy);
      }
    }
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [harv.id], cx: 40, cy: 20 }]);
    let arrived = false;
    for (let t = 0; t < 600 && !arrived; t++) {
      tick(state);
      const { cx, cy } = cellOf(state, harv);
      arrived = cx === 40 && cy === 20;
    }
    expect(arrived).toBe(true);
  });

  it('never gives up: outlasts a blocker that only clears after 150 ticks', () => {
    const state = arena(8);
    rockWithCorridor(state, 9, 11, 10);
    const mover = spawnUnit(state, 'TANK', 0, 5, 10);
    const blocker = spawnUnit(state, 'TANK', 0, 12, 10);
    tick(state, [
      { type: 'MOVE', playerId: 0, unitIds: [mover.id], cx: 30, cy: 10 },
      { type: 'HOLD', playerId: 0, unitIds: [blocker.id] }, // refuses to yield
    ]);
    // 150 ticks of solid jam — the old engine gave up after ~3 repaths.
    for (let t = 0; t < 150; t++) tick(state);
    expect(cellOf(state, mover).cx).toBeLessThan(12); // still queued, not teleported
    // Blocker finally drives off; the mover must resume on its own.
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [blocker.id], cx: 55, cy: 10 }]);
    let arrived = false;
    for (let t = 0; t < 600 && !arrived; t++) {
      tick(state);
      const { cx, cy } = cellOf(state, mover);
      arrived = cx === 30 && cy === 10;
    }
    expect(arrived).toBe(true);
  });

  it('head-on in a 1-wide corridor: both tanks swap through and arrive', () => {
    const state = arena(9);
    rockWithCorridor(state, 9, 11, 10);
    const a = spawnUnit(state, 'TANK', 0, 8, 10);
    const b = spawnUnit(state, 'TANK', 0, 16, 10);
    tick(state, [
      { type: 'MOVE', playerId: 0, unitIds: [a.id], cx: 20, cy: 10 },
      { type: 'MOVE', playerId: 0, unitIds: [b.id], cx: 4, cy: 10 },
    ]);
    let bothArrived = false;
    for (let t = 0; t < 800 && !bothArrived; t++) {
      tick(state);
      const pa = cellOf(state, a);
      const pb = cellOf(state, b);
      bothArrived = pa.cx === 20 && pa.cy === 10 && pb.cx === 4 && pb.cy === 10;
    }
    expect(bothArrived).toBe(true);
  });

  it('a unit on HOLD never sidesteps; traffic routes around it', () => {
    const state = arena(10);
    const holder = spawnUnit(state, 'TANK', 0, 20, 20);
    const mover = spawnUnit(state, 'TANK', 0, 15, 20);
    const holdIdx = holder.cell;
    tick(state, [{ type: 'HOLD', playerId: 0, unitIds: [holder.id] }]);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [mover.id], cx: 25, cy: 20 }]);
    for (let t = 0; t < 400; t++) tick(state);
    expect(holder.cell).toBe(holdIdx); // did not budge
    expect(state.occupancy[holdIdx]).toBe(holder.id);
    const { cx, cy } = cellOf(state, mover);
    expect(cx).toBe(25);
    expect(cy).toBe(20);
  });
});

describe('Infanterie-Stapeln: 3 pro Kachel', () => {
  it('three riflemen share one cell; a fourth spawn is refused', () => {
    const state = arena(11);
    const idx = cellIndex(state, 20, 20);
    for (let i = 0; i < INFANTRY_STACK; i++) spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    expect(state.occupancy[idx]).toBe(-INFANTRY_STACK);
    expect(() => spawnUnit(state, 'RIFLEMAN', 0, 20, 20)).toThrow();
    // A vehicle can never spawn into or enter an occupied infantry cell.
    expect(() => spawnUnit(state, 'TANK', 0, 20, 20)).toThrow();
  });

  it('a rifleman walks INTO a partial pack; a full pack turns him away', () => {
    const state = arena(12);
    const idx = cellIndex(state, 20, 20);
    spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    const joiner = spawnUnit(state, 'RIFLEMAN', 0, 24, 20);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [joiner.id], cx: 20, cy: 20 }]);
    for (let t = 0; t < 200 && joiner.path; t++) tick(state);
    expect(joiner.cell).toBe(idx);
    expect(state.occupancy[idx]).toBe(-3);
  });

  it('a full pack on HOLD blocks a tank for good', () => {
    const state = arena(13);
    const idx = cellIndex(state, 20, 20);
    const pack: Unit[] = [];
    for (let i = 0; i < 3; i++) pack.push(spawnUnit(state, 'RIFLEMAN', 0, 20, 20));
    const tank = spawnUnit(state, 'TANK', 0, 24, 20);
    expect(cellBlockedFor(state, tank, idx)).toBe(true);
    tick(state, [{ type: 'HOLD', playerId: 0, unitIds: pack.map((u) => u.id) }]);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [tank.id], cx: 20, cy: 20 }]);
    for (let t = 0; t < 300; t++) tick(state);
    expect(tank.cell).not.toBe(idx);
    expect(state.occupancy[idx]).toBe(-3);
  });

  it('pack bookkeeping through deaths: -3 → -2 → 0', () => {
    const state = arena(14);
    const idx = cellIndex(state, 20, 20);
    const pack: Unit[] = [];
    for (let i = 0; i < 3; i++) pack.push(spawnUnit(state, 'RIFLEMAN', 0, 20, 20));
    pack[0]!.hp = 0;
    tick(state);
    expect(state.occupancy[idx]).toBe(-2);
    pack[1]!.hp = 0;
    pack[2]!.hp = 0;
    tick(state);
    expect(state.occupancy[idx]).toBe(0);
  });

  it('serialize → deserialize keeps packs and hashes identical', () => {
    const state = arena(15);
    for (let i = 0; i < 3; i++) spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    spawnUnit(state, 'TANK', 0, 22, 20);
    const copy = deserialize(serialize(state));
    expect(hashState(copy)).toBe(hashState(state));
    for (let t = 0; t < 50; t++) {
      tick(state);
      tick(copy);
    }
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('9 riflemen ordered to one point pack onto 3 cells', () => {
    const state = arena(17);
    const ids: number[] = [];
    for (let i = 0; i < 9; i++) {
      ids.push(spawnUnit(state, 'RIFLEMAN', 0, 10 + i, 10).id);
    }
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: ids, cx: 30, cy: 30 }]);
    for (let t = 0; t < 400; t++) tick(state);
    const men = state.units.filter((u) => u.type === 'RIFLEMAN');
    const cells = new Set(men.map((u) => u.cell));
    expect(men).toHaveLength(9);
    expect(cells.size).toBe(3); // 3 per tile, tightly packed
    for (const c of cells) expect(state.occupancy[c]).toBe(-3);
  });

  it('a mixed group: infantry clumps at the click, the tank parks beside', () => {
    const state = arena(18);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(spawnUnit(state, 'RIFLEMAN', 0, 10 + i, 10).id);
    const tank = spawnUnit(state, 'TANK', 0, 14, 10);
    ids.push(tank.id);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: ids, cx: 30, cy: 30 }]);
    for (let t = 0; t < 400; t++) tick(state);
    const men = state.units.filter((u) => u.type === 'RIFLEMAN');
    const packCell = cellIndex(state, 30, 30);
    for (const m of men) expect(m.cell).toBe(packCell); // all three on the click
    expect(tank.cell).not.toBe(packCell);
    expect(state.occupancy[tank.cell]).toBe(tank.id);
  });

  it('a jam plus stacked infantry stays deterministic across two runs', () => {
    const run = (): string => {
      const state = arena(16);
      const harv = spawnUnit(state, 'HARVESTER', 0, 20, 20);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          spawnUnit(state, 'RIFLEMAN', 0, 20 + dx, 20 + dy);
          spawnUnit(state, 'RIFLEMAN', 0, 20 + dx, 20 + dy);
        }
      }
      tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [harv.id], cx: 40, cy: 20 }]);
      for (let t = 0; t < 300; t++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
