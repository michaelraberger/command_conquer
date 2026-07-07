import { describe, expect, it } from 'vitest';
import {
  cellCenter,
  cellIndex,
  createGame,
  tick,
  type GameState,
  type Unit,
} from '../src/index.js';

function unitById(state: GameState, id: number): Unit {
  const unit = state.units.find((u) => u.id === id);
  if (!unit) throw new Error(`no unit ${id}`);
  return unit;
}

function runUntilIdle(state: GameState, ids: number[], maxTicks = 400): void {
  for (let t = 0; t < maxTicks; t++) {
    if (ids.every((id) => unitById(state, id).path === null)) return;
    tick(state);
  }
  throw new Error(`units still moving after ${maxTicks} ticks`);
}

/** Ids of the player's starting tanks (id 1 is the construction yard). */
function tankIds(state: GameState): number[] {
  return state.units.filter((u) => u.owner === 0 && u.type === 'TANK').map((u) => u.id);
}

describe('movement', () => {
  it('a single unit drives to the ordered cell and updates occupancy', () => {
    const state = createGame(7);
    const id = tankIds(state)[0]!;
    // (20,12): inside the cleared spawn zone and away from harvester traffic.
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [id], cx: 20, cy: 12 }]);
    runUntilIdle(state, [id]);

    const unit = unitById(state, id);
    expect(unit.x).toBe(cellCenter(20));
    expect(unit.y).toBe(cellCenter(12));
    const idx = cellIndex(state, 20, 12);
    expect(unit.cell).toBe(idx);
    expect(state.occupancy[idx]).toBe(id);
  });

  it('two units ordered to one cell settle on distinct cells at rest', () => {
    const state = createGame(7);
    const [idA, idB] = tankIds(state);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [idA!, idB!], cx: 20, cy: 18 }]);
    runUntilIdle(state, [idA!, idB!]);

    const a = unitById(state, idA!);
    const b = unitById(state, idB!);
    expect(a.cell).not.toBe(b.cell);
    // Both at rest exactly on their cell centers.
    for (const u of [a, b]) {
      const cx = u.cell % state.mapWidth;
      const cy = (u.cell - cx) / state.mapWidth;
      expect(u.x).toBe(cellCenter(cx));
      expect(u.y).toBe(cellCenter(cy));
    }
  });

  it('ignores move commands for units the player does not own', () => {
    const state = createGame(7);
    const enemy = state.units.find((u) => u.owner === 1)!;
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [enemy.id], cx: 20, cy: 16 }]);
    expect(unitById(state, enemy.id).path).toBeNull();
  });
});
