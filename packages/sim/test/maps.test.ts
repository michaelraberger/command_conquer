import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  TERRAIN_ROCK,
  TERRAIN_WATER,
  createGame,
  findPath,
  hashState,
  type GameState,
  type MapType,
} from '../src/index.js';

function waterShare(state: GameState): number {
  let water = 0;
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] === TERRAIN_WATER) water++;
  }
  return water / state.terrain.length;
}

/** Counts coastal land cells (8-adjacent to water) of a given terrain kind. */
function coastalCellsOfKind(state: GameState, kind: number): number {
  const w = state.mapWidth;
  const h = state.mapHeight;
  let count = 0;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (state.terrain[cy * w + cx] !== kind) continue;
      let coast = false;
      for (let dy = -1; dy <= 1 && !coast; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if ((dx !== 0 || dy !== 0) && x >= 0 && y >= 0 && x < w && y < h) {
            if (state.terrain[y * w + x] === TERRAIN_WATER) coast = true;
          }
        }
      }
      if (coast) count++;
    }
  }
  return count;
}

/** Ground path from one spawn area toward the other (best-effort). */
function groundPathReaches(state: GameState, tx: number, ty: number): boolean {
  const path = findPath(state, 16, 20, tx, ty, { avoidUnits: false, selfId: 0 });
  if (!path) return false;
  const end = path[path.length - 1]!;
  return Math.max(Math.abs(end.cx - tx), Math.abs(end.cy - ty)) <= 2;
}

describe('map types', () => {
  it('each type is deterministic per seed and differs from the others', () => {
    const hash = (type: MapType, seed = 42): string => hashState(createGame(seed, { mapType: type }));
    for (const type of ['BADLANDS', 'RIVER', 'ISLANDS'] as const) {
      expect(hash(type)).toBe(hash(type)); // same seed+type → identical state
    }
    expect(hash('BADLANDS')).not.toBe(hash('RIVER'));
    expect(hash('RIVER')).not.toBe(hash('ISLANDS'));
  });

  it('islands are mostly water, badlands mostly land, river in between', () => {
    const badlands = waterShare(createGame(7, { mapType: 'BADLANDS' }));
    const river = waterShare(createGame(7, { mapType: 'RIVER' }));
    const islands = waterShare(createGame(7, { mapType: 'ISLANDS' }));
    expect(badlands).toBeLessThan(0.15);
    expect(river).toBeGreaterThan(badlands);
    expect(islands).toBeGreaterThan(0.4);
  });

  it('river still allows a ground crossing (the bridge chokepoint)', () => {
    const state = createGame(7, { mapType: 'RIVER' });
    expect(groundPathReaches(state, 46, 42)).toBe(true);
  });

  it('islands separate the players by ground completely', () => {
    const state = createGame(7, { mapType: 'ISLANDS' });
    expect(groundPathReaches(state, 46, 42)).toBe(false);
  });

  it('own ore is ground-reachable on every map (economy works)', () => {
    for (const type of ['BADLANDS', 'RIVER', 'ISLANDS'] as const) {
      const state = createGame(7, { mapType: type });
      expect(groundPathReaches(state, 23, 17)).toBe(true);
    }
  });

  it('island coasts mix cliffs and beaches (landing only at bays)', () => {
    for (const seed of [7, 42, 123]) {
      const state = createGame(seed, { mapType: 'ISLANDS' });
      // Most of the shoreline is impassable cliff...
      expect(coastalCellsOfKind(state, TERRAIN_ROCK)).toBeGreaterThan(20);
      // ...but there are a few clear beach cells to land on.
      expect(coastalCellsOfKind(state, TERRAIN_DIRT)).toBeGreaterThan(0);
    }
  });
});
