import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  TERRAIN_ROCK,
  buildingRule,
  canPlaceBuilding,
  cellIndex,
  constructBuilding,
  createGame,
  deserialize,
  dockCell,
  footprintOf,
  hashState,
  serialize,
  tick,
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
  state.ore.fill(0); // placement checks reject ore cells
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

describe('Gebäude-Rotation (diagonale Iso-Spiegelung)', () => {
  it('a rotated refinery stamps a 2×3 footprint instead of 3×2', () => {
    const state = arena();
    const rule = buildingRule('REFINERY');
    expect([rule.width, rule.height]).toEqual([3, 2]); // baseline assumption
    const ref = constructBuilding(state, 'REFINERY', 0, 20, 20, true);
    expect(ref.rotated).toBe(true);
    expect(footprintOf(ref)).toEqual({ w: 2, h: 3 });
    // Stamped cells: 2 wide, 3 tall.
    expect(state.structures[cellIndex(state, 21, 22)]).toBe(ref.id); // inside
    expect(state.structures[cellIndex(state, 22, 20)]).toBe(0); // 3rd column empty
    expect(state.structures[cellIndex(state, 20, 22)]).toBe(ref.id); // 3rd row used
    // Center matches the effective dims.
    expect(ref.x).toBe(20 * 256 + 256); // cx + 2/2 cells
    expect(ref.y).toBe(20 * 256 + 384); // cy + 3/2 cells
    // The dock sits south of the SWAPPED footprint (3 tall).
    expect(dockCell(ref)).toEqual({ cx: 21, cy: 23 });
  });

  it('canPlaceBuilding honors the swapped footprint', () => {
    const state = arena();
    // A 2-cell-wide corridor at x 20..21, walled by rock left and right.
    for (let y = 15; y < 30; y++) {
      state.terrain[cellIndex(state, 19, y)] = TERRAIN_ROCK;
      state.terrain[cellIndex(state, 22, y)] = TERRAIN_ROCK;
    }
    constructBuilding(state, 'POWER', 0, 20, 15); // adjacency anchor in the corridor
    // Unrotated 3×2 refinery cannot fit the 2-wide corridor; rotated 2×3 can.
    expect(canPlaceBuilding(state, 0, 'REFINERY', 20, 18, false)).toBe(false);
    expect(canPlaceBuilding(state, 0, 'REFINERY', 20, 18, true)).toBe(true);
  });

  it('destroying a rotated building frees exactly its swapped cells', () => {
    const state = arena();
    const ref = constructBuilding(state, 'REFINERY', 0, 20, 20, true);
    ref.hp = 0;
    tick(state);
    expect(state.buildings.some((b) => b.id === ref.id)).toBe(false);
    for (let y = 20; y < 23; y++) {
      for (let x = 20; x < 22; x++) {
        expect(state.structures[cellIndex(state, x, y)]).toBe(0);
      }
    }
  });

  it('square buildings rotate purely cosmetically (same footprint)', () => {
    const state = arena();
    const p = constructBuilding(state, 'POWER', 0, 20, 20, true);
    expect(footprintOf(p)).toEqual({ w: 2, h: 2 });
    expect(p.rotated).toBe(true); // client mirrors the sprite
  });

  it('rotated survives serialize round trip; old saves backfill to false', () => {
    const state = arena();
    constructBuilding(state, 'REFINERY', 0, 20, 20, true);
    const copy = deserialize(serialize(state));
    expect(copy.buildings.find((b) => b.type === 'REFINERY')!.rotated).toBe(true);
    expect(hashState(copy)).toBe(hashState(state));

    const raw = JSON.parse(serialize(state)) as { buildings: Array<Record<string, unknown>> };
    for (const b of raw.buildings) delete b.rotated;
    const old = deserialize(JSON.stringify(raw));
    expect(old.buildings.every((b) => b.rotated === false)).toBe(true);
    tick(old); // and the game keeps running
  });

  it('a game with rotated buildings stays deterministic', () => {
    const run = (): string => {
      const state = arena(21);
      constructBuilding(state, 'REFINERY', 0, 20, 20, true);
      constructBuilding(state, 'BARRACKS', 0, 24, 20, true);
      for (let t = 0; t < 120; t++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
