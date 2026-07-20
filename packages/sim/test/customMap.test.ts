import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_OWNER,
  RESOURCE_ORE,
  TERRAIN_DIRT,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  TERRAIN_WATER,
  applyBalance,
  createGame,
  deserialize,
  emptyCustomMap,
  hashState,
  serialize,
  tick,
  validateCustomMap,
  type BalanceConfig,
  type CustomMapData,
} from '../src/index.js';

/** A small valid authored map: dirt everywhere, ore beside both spawns. */
function makeMap(): CustomMapData {
  const map = emptyCustomMap(48, 48, 'Testkarte');
  const stamp = (cx: number, cy: number): void => {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) {
        const idx = y * map.width + x;
        map.ore[idx] = 500;
        map.resourceKind[idx] = RESOURCE_ORE;
      }
    }
  };
  const [s0, s1] = map.spawns;
  stamp(s0![0] + 6, s0![1] + 6);
  stamp(s1![0] - 6, s1![1] - 6);
  return map;
}

describe('validateCustomMap', () => {
  it('accepts a plain valid map as BADLANDS', () => {
    const v = validateCustomMap(makeMap());
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.mapType).toBe('BADLANDS');
  });

  it('rejects wrong sizes and wrong layer lengths', () => {
    const map = makeMap();
    expect(validateCustomMap({ ...map, width: 50 }).ok).toBe(false);
    expect(validateCustomMap({ ...map, width: 100 }).ok).toBe(false);
    expect(validateCustomMap({ ...map, terrain: map.terrain.slice(1) }).ok).toBe(false);
  });

  it('accepts every legal side length up to 192', () => {
    for (const size of [48, 64, 96, 128, 144, 192]) {
      const map = emptyCustomMap(size, size, `Größe ${size}`);
      expect(validateCustomMap(map).ok).toBe(true);
    }
  });

  it('rejects fewer than 2 spawns, edge-hugging and clustered spawns', () => {
    const map = makeMap();
    expect(validateCustomMap({ ...map, spawns: [map.spawns[0]!] }).ok).toBe(false);
    expect(validateCustomMap({ ...map, spawns: [[1, 8], map.spawns[1]!] }).ok).toBe(false);
    const [sx, sy] = map.spawns[0]!;
    expect(validateCustomMap({ ...map, spawns: [[sx, sy], [sx + 5, sy + 5]] }).ok).toBe(false);
  });

  it('rejects a blocked spawn area', () => {
    const map = makeMap();
    const [sx, sy] = map.spawns[0]!;
    map.terrain[(sy + 2) * map.width + (sx + 2)] = TERRAIN_ROCK;
    const v = validateCustomMap(map);
    expect(v.ok).toBe(false);
    expect(v.errors.join(' ')).toContain('Startpunkt 1');
  });

  it('rejects ore on impassable terrain', () => {
    const map = makeMap();
    const idx = 24 * map.width + 24;
    map.terrain[idx] = TERRAIN_WATER;
    map.ore[idx] = 300;
    expect(validateCustomMap(map).ok).toBe(false);
  });

  it('derives RIVER from water share and ISLANDS from separation', () => {
    const river = makeMap();
    // Vertical water band (~25% of the map) that still leaves a land bridge.
    for (let y = 0; y < river.height; y++) {
      for (let x = 20; x < 32; x++) {
        if (y < 40) river.terrain[y * river.width + x] = TERRAIN_WATER;
      }
    }
    const rv = validateCustomMap(river);
    expect(rv.ok).toBe(true);
    expect(rv.mapType).toBe('RIVER');

    const islands = makeMap();
    for (let y = 0; y < islands.height; y++) {
      for (let x = 22; x < 26; x++) islands.terrain[y * islands.width + x] = TERRAIN_WATER;
    }
    const iv = validateCustomMap(islands);
    expect(iv.ok).toBe(true);
    expect(iv.mapType).toBe('ISLANDS');
    expect(iv.warnings.join(' ')).toContain('Inselkarte');
  });

  it('warns when a spawn has no ore nearby', () => {
    const map = emptyCustomMap(48, 48);
    const v = validateCustomMap(map);
    expect(v.ok).toBe(true);
    expect(v.warnings.some((w) => w.includes('kein Erz'))).toBe(true);
  });
});

describe('createGame with customMap', () => {
  it('uses the authored layout verbatim (outside base footprints)', () => {
    const map = makeMap();
    map.terrain[0] = TERRAIN_WATER;
    map.terrain[1] = TERRAIN_GRASS;
    const state = createGame(7, { customMap: map, opponents: 1, ai: true });

    expect(state.mapWidth).toBe(48);
    expect(state.mapHeight).toBe(48);
    expect(state.mapType).toBe('BADLANDS');
    expect(state.spawns).toEqual(map.spawns);
    // Corner cells are far from both spawns — must be untouched.
    expect(state.terrain[0]).toBe(TERRAIN_WATER);
    expect(state.terrain[1]).toBe(TERRAIN_GRASS);
    // Authored ore survives; both players got a base + starting units.
    const oreIdx = (map.spawns[0]![1] + 6) * 48 + (map.spawns[0]![0] + 6);
    expect(state.ore[oreIdx]).toBe(500);
    expect(state.buildings.filter((b) => b.type === 'CONYARD').length).toBe(2);
    expect(state.units.length).toBeGreaterThan(0);
    // The input map must not be mutated (layers are copied, not aliased).
    expect(map.terrain[(map.spawns[0]![1] - 1) * 48 + map.spawns[0]![0]]).toBe(TERRAIN_DIRT);
    expect(map.ore[oreIdx]).toBe(500);
  });

  it('caps the player count at the map spawn count', () => {
    const state = createGame(7, { customMap: makeMap(), opponents: 5, ai: true });
    expect(state.players.length).toBe(2);
    expect(state.fogs.length).toBe(2);
  });

  it('throws on an invalid map', () => {
    const map = makeMap();
    map.spawns = [map.spawns[0]!];
    expect(() => createGame(7, { customMap: map })).toThrow(/Ungültige Karte/);
  });

  it('is deterministic and serialize/deserialize round-trips', () => {
    const opts = { customMap: makeMap(), opponents: 1, ai: true } as const;
    const a = createGame(99, opts);
    const b = createGame(99, opts);
    for (let t = 0; t < 300; t++) {
      tick(a, []);
      tick(b, []);
    }
    expect(hashState(a)).toBe(hashState(b));

    const restored = deserialize(serialize(a));
    expect(hashState(restored)).toBe(hashState(a));
    for (let t = 0; t < 100; t++) {
      tick(a, []);
      tick(restored, []);
    }
    expect(hashState(restored)).toBe(hashState(a));
  });

  it('resume must re-apply the balance snapshot (applyBalance is global)', () => {
    const balance: BalanceConfig = { units: { TANK: { speed: 30 } } };
    const opts = { customMap: makeMap(), opponents: 1, ai: true, balance } as const;

    const original = createGame(5, opts);
    for (let t = 0; t < 150; t++) tick(original, []);
    const saved = serialize(original);

    // A different game meanwhile resets the module-global balance to defaults —
    // exactly what happens when the user plays another match before resuming.
    createGame(6, { customMap: makeMap() });

    const restored = deserialize(saved);
    applyBalance(balance); // the resume path MUST do this before ticking
    for (let t = 0; t < 150; t++) {
      tick(original, []);
      tick(restored, []);
    }
    expect(hashState(restored)).toBe(hashState(original));
  });
});

describe('neutralBuildings (Erz-Bohrturm)', () => {
  it('accepts a valid tower and createGame constructs it with owner -1', () => {
    const map = makeMap();
    map.neutralBuildings = [{ type: 'ERZ_BOHRTURM', cx: 22, cy: 22 }];
    expect(validateCustomMap(map).ok).toBe(true);

    const state = createGame(7, { customMap: map });
    const spike = state.buildings.find((b) => b.type === 'ERZ_BOHRTURM');
    expect(spike).toBeDefined();
    expect(spike!.owner).toBe(NEUTRAL_OWNER);
    // Footprint stamped into the structures grid like any building.
    expect(state.structures[22 * map.width + 22]).toBe(spike!.id);
  });

  it('rejects unknown types, out-of-bounds and blocked ground', () => {
    const base = makeMap();

    const unknown = { ...base, neutralBuildings: [{ type: 'NUKESILO', cx: 22, cy: 22 }] };
    expect(validateCustomMap(unknown).ok).toBe(false);

    const outside = { ...base, neutralBuildings: [{ type: 'ERZ_BOHRTURM', cx: 47, cy: 22 }] };
    expect(validateCustomMap(outside).ok).toBe(false);

    const wet = makeMap();
    wet.terrain[22 * wet.width + 22] = TERRAIN_WATER;
    wet.neutralBuildings = [{ type: 'ERZ_BOHRTURM', cx: 22, cy: 22 }];
    expect(validateCustomMap(wet).ok).toBe(false);
  });

  it('rejects overlap with each other and with spawn clear zones', () => {
    const overlapping = makeMap();
    overlapping.neutralBuildings = [
      { type: 'ERZ_BOHRTURM', cx: 22, cy: 22 },
      { type: 'ERZ_BOHRTURM', cx: 23, cy: 23 },
    ];
    expect(validateCustomMap(overlapping).ok).toBe(false);

    const inSpawnZone = makeMap();
    const [sx, sy] = inSpawnZone.spawns[0]!;
    inSpawnZone.neutralBuildings = [{ type: 'ERZ_BOHRTURM', cx: sx + 2, cy: sy + 2 }];
    expect(validateCustomMap(inSpawnZone).ok).toBe(false);
  });

  it('maps without the field stay valid (backward compatible)', () => {
    const map = makeMap();
    expect('neutralBuildings' in map).toBe(false);
    expect(validateCustomMap(map).ok).toBe(true);
    const state = createGame(7, { customMap: map });
    expect(state.buildings.every((b) => b.owner >= 0)).toBe(true);
  });
});
