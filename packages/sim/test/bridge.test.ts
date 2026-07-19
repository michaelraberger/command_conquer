import { describe, expect, it } from 'vitest';
import {
  TERRAIN_BRIDGE,
  TERRAIN_BRIDGE_WRECK,
  TERRAIN_WATER,
  canPlaceBuilding,
  cellIndex,
  createGame,
  deserialize,
  emptyCustomMap,
  findPath,
  isBuildableKind,
  isNavigableWater,
  isOpenWater,
  isPassableKind,
  serialize,
  spawnUnit,
  tick,
  validateCustomMap,
  type CustomMapData,
  type GameState,
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

/** Ticks until the span at (cx,cy) is gone (or the safety budget runs out). */
function shellSpan(state: GameState, cx: number, cy: number): void {
  const span = state.buildings.find((b) => b.type === 'BRIDGE' && b.cx === cx && b.cy === cy)!;
  const tank = spawnUnit(state, 'TANK', 0, cx - 5, cy);
  tick(state, [
    { type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: span.id },
  ]);
  // Tough spans (heavy armor, 1000 hp): one tank needs ~22 shells.
  for (let i = 0; i < 1200 && state.buildings.some((b) => b.id === span.id); i++) {
    tick(state, []);
  }
}

describe('Zerstörbare Brücken', () => {
  it('spawns one neutral, non-blocking span per bridge cell', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    const spans = state.buildings.filter((b) => b.type === 'BRIDGE');
    expect(spans).toHaveLength(3);
    for (const s of spans) {
      expect(s.owner).toBe(-1);
      // Never in the structures grid: units drive over, ships sail beneath.
      expect(state.structures[cellIndex(state, s.cx, s.cy)]).toBe(0);
    }
  });

  it('a shelled span collapses into an impassable wreck that ships can cross', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    shellSpan(state, 21, 24);
    expect(state.buildings.some((b) => b.type === 'BRIDGE' && b.cx === 21)).toBe(false);
    expect(state.terrain[cellIndex(state, 21, 24)]).toBe(TERRAIN_BRIDGE_WRECK);
    expect(isPassableKind(TERRAIN_BRIDGE_WRECK)).toBe(false);
    expect(isNavigableWater(state, 21, 24)).toBe(true);
    // The ground route across the row is severed once the middle span is out:
    // best-effort pathing stops at the west side of the gap (cx ≤ 20).
    const ground = findPath(state, 10, 24, 30, 24, { avoidUnits: false, selfId: 0, owner: 0 });
    expect(ground).not.toBeNull();
    expect(ground![ground!.length - 1]!.cx).toBeLessThanOrEqual(20);
  });

  it('drops ground units standing on the collapsing span', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 21, 24);
    // Hold position so auto-defense doesn't walk the victim off the deck.
    tick(state, [{ type: 'HOLD', playerId: 1, unitIds: [victim.id] }]);
    shellSpan(state, 21, 24);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
  });

  it('the river map crossing is a real bridge with spans (2-player fast path)', () => {
    const state = createGame(7, { mapType: 'RIVER' });
    const cells: number[] = [];
    for (let i = 0; i < state.terrain.length; i++) {
      if (state.terrain[i] === TERRAIN_BRIDGE) cells.push(i);
    }
    expect(cells.length).toBeGreaterThan(0);
    const spans = state.buildings.filter((b) => b.type === 'BRIDGE');
    expect(spans).toHaveLength(cells.length);
  });

  it('bridge spans survive a save/load roundtrip exactly once', () => {
    const state = createGame(7, { customMap: bridgeMap() });
    const loaded = deserialize(serialize(state));
    expect(loaded.buildings.filter((b) => b.type === 'BRIDGE')).toHaveLength(3);
    // Roundtrip must reproduce the state EXACTLY — no spans invented on load
    // (saves from before the feature keep indestructible decks).
    const legacy = deserialize(
      serialize({ ...state, buildings: state.buildings.filter((b) => b.type !== 'BRIDGE') }),
    );
    expect(legacy.buildings.filter((b) => b.type === 'BRIDGE')).toHaveLength(0);
  });
});
