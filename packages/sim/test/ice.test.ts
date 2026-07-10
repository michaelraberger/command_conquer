import { describe, expect, it } from 'vitest';
import {
  RESOURCE_ORE,
  TERRAIN_ICE,
  TERRAIN_WATER,
  canPlaceBuilding,
  createGame,
  emptyCustomMap,
  findPath,
  isBuildableKind,
  isPassableKind,
  tick,
  validateCustomMap,
  type CustomMapData,
  type GameState,
} from '../src/index.js';

/** 48×48 dirt map with a vertical water channel at x=20..22 splitting the
 *  spawns; optionally a one-cell-wide ice bridge frozen across it at y=24. */
function channelMap(withIceBridge: boolean): CustomMapData {
  const map = emptyCustomMap(48, 48, 'Eistest');
  for (let y = 0; y < 48; y++) {
    for (let x = 20; x <= 22; x++) map.terrain[y * 48 + x] = TERRAIN_WATER;
  }
  if (withIceBridge) {
    for (let x = 20; x <= 22; x++) map.terrain[24 * 48 + x] = TERRAIN_ICE;
  }
  return map;
}

describe('Eis (TERRAIN_ICE)', () => {
  it('is passable but not buildable', () => {
    expect(isPassableKind(TERRAIN_ICE)).toBe(true);
    expect(isBuildableKind(TERRAIN_ICE)).toBe(false);
  });

  it('an ice bridge keeps the spawns ground-connected (no island map)', () => {
    const split = validateCustomMap(channelMap(false));
    expect(split.ok).toBe(true);
    expect(split.mapType).toBe('ISLANDS');
    const bridged = validateCustomMap(channelMap(true));
    expect(bridged.ok).toBe(true);
    expect(bridged.mapType).toBe('BADLANDS');
  });

  it('rejects ice inside a spawn clear area', () => {
    const map = channelMap(true);
    const [sx, sy] = map.spawns[0]!;
    map.terrain[sy * 48 + sx + 2] = TERRAIN_ICE;
    const v = validateCustomMap(map);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('Startpunkt 1');
  });

  it('allows ore on ice (harvesters can drive onto it)', () => {
    const map = channelMap(true);
    const idx = 10 * 48 + 21;
    map.terrain[idx] = TERRAIN_ICE;
    map.ore[idx] = 500;
    map.resourceKind[idx] = RESOURCE_ORE;
    expect(validateCustomMap(map).ok).toBe(true);
  });

  it('ground units path across ice, ships are blocked by it', () => {
    const state = createGame(7, { customMap: channelMap(true) });
    // Ground: a path from the west bank to the east bank must cross the bridge.
    const ground = findPath(state, 10, 24, 30, 24, { avoidUnits: false, selfId: 0, owner: 0 });
    expect(ground).not.toBeNull();
    expect(ground!.some((c) => c.cx >= 20 && c.cx <= 22 && c.cy === 24)).toBe(true);
    // Naval: the frozen row splits the channel; best-effort pathing stops
    // before the ice instead of sailing through it.
    const naval = findPath(state, 21, 10, 21, 40, { avoidUnits: false, selfId: 0, water: true });
    expect(naval === null || naval.every((c) => c.cy < 24)).toBe(true);
  });

  it('slows ground units to ~60 % while crossing ice', () => {
    // Plain dirt map with an all-ice row at y=20; same straight run measured
    // once on dirt (y=24) and once on ice.
    const map = emptyCustomMap(48, 48, 'Eistempo');
    for (let x = 8; x <= 34; x++) map.terrain[20 * 48 + x] = TERRAIN_ICE;
    const state = createGame(7, { customMap: map });
    const tankId = state.units.find((u) => u.owner === 0 && u.type === 'TANK')!.id;

    const moveAndCount = (s: GameState, cx: number, cy: number): number => {
      tick(s, [{ type: 'MOVE', playerId: 0, unitIds: [tankId], cx, cy }]);
      for (let t = 1; t < 600; t++) {
        if (s.units.find((u) => u.id === tankId)!.path === null) return t;
        tick(s);
      }
      throw new Error('unit still moving after 600 ticks');
    };

    moveAndCount(state, 10, 24);
    const dirtTicks = moveAndCount(state, 30, 24); // 20 Zellen Erde
    moveAndCount(state, 10, 20);
    const iceTicks = moveAndCount(state, 30, 20); // 20 Zellen Eis
    // 60 % Tempo → ~1,66× so lange; großzügige Schranken gegen Rundungsrauschen.
    expect(iceTicks).toBeGreaterThan(dirtTicks * 1.4);
    expect(iceTicks).toBeLessThan(dirtTicks * 2);
  });

  it('blocks building placement on ice', () => {
    const map = channelMap(true);
    const [sx, sy] = map.spawns[0]!;
    // Freeze a strip right beside the spawn clear area, inside the build radius.
    for (let y = sy - 1; y <= sy + 1; y++) {
      for (let x = sx + 5; x <= sx + 7; x++) map.terrain[y * 48 + x] = TERRAIN_ICE;
    }
    const state = createGame(7, { customMap: map });
    expect(canPlaceBuilding(state, 0, 'POWER', sx + 5, sy)).toBe(false);
    expect(canPlaceBuilding(state, 0, 'POWER', sx - 4, sy - 4)).toBe(true);
  });
});
