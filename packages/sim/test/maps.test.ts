import { describe, expect, it } from 'vitest';
import {
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
});
