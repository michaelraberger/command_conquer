import { describe, expect, it } from 'vitest';
import {
  TERRAIN_BRIDGE,
  TERRAIN_WATER,
  canPlaceBuilding,
  createGame,
  emptyCustomMap,
  findPath,
  isBuildableKind,
  isNavigableWater,
  isOpenWater,
  isPassableKind,
  validateCustomMap,
  type CustomMapData,
} from '../src/index.js';

/** 48×48 dirt map with a vertical water channel at x=20..22 and a bridge
 *  row spanning it at y=24. */
function bridgeMap(): CustomMapData {
  const map = emptyCustomMap(48, 48, 'Brückentest');
  for (let y = 0; y < 48; y++) {
    for (let x = 20; x <= 22; x++) map.terrain[y * 48 + x] = TERRAIN_WATER;
  }
  for (let x = 20; x <= 22; x++) map.terrain[24 * 48 + x] = TERRAIN_BRIDGE;
  return map;
}

describe('Brücke (TERRAIN_BRIDGE)', () => {
  it('is passable but not buildable', () => {
    expect(isPassableKind(TERRAIN_BRIDGE)).toBe(true);
    expect(isBuildableKind(TERRAIN_BRIDGE)).toBe(false);
  });

  it('validates and keeps the banks ground-connected (no island map)', () => {
    const v = validateCustomMap(bridgeMap());
    expect(v.ok).toBe(true);
    expect(v.mapType).toBe('BADLANDS');
  });

  it('ground units drive over it, ships sail beneath it', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    // Ground: west bank → east bank crosses the bridge row.
    const ground = findPath(state, 10, 24, 30, 24, { avoidUnits: false, selfId: 0, owner: 0 });
    expect(ground).not.toBeNull();
    expect(ground!.some((c) => c.cx >= 20 && c.cx <= 22 && c.cy === 24)).toBe(true);
    // Naval: north → south passes straight through the bridge cell.
    const naval = findPath(state, 21, 10, 21, 40, { avoidUnits: false, selfId: 0, water: true });
    expect(naval).not.toBeNull();
    const last = naval![naval!.length - 1]!;
    expect(last.cx).toBe(21);
    expect(last.cy).toBe(40);
    expect(naval!.some((c) => c.cy === 24)).toBe(true);
  });

  it('navigable for ships but not open water for a shipyard', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    expect(isNavigableWater(state, 21, 24)).toBe(true);
    expect(isOpenWater(state, 21, 24)).toBe(false);
    expect(isOpenWater(state, 21, 10)).toBe(true);
  });

  it('blocks building placement on the bridge deck', () => {
    const map = bridgeMap();
    const [sx, sy] = map.spawns[0]!;
    // Bridge strip inside the build radius beside the spawn.
    for (let y = sy - 1; y <= sy + 1; y++) {
      for (let x = sx + 5; x <= sx + 7; x++) map.terrain[y * 48 + x] = TERRAIN_BRIDGE;
    }
    const state = createGame(7, { customMap: map });
    expect(canPlaceBuilding(state, 0, 'POWER', sx + 5, sy)).toBe(false);
    expect(canPlaceBuilding(state, 0, 'POWER', sx - 4, sy - 4)).toBe(true);
  });
});
