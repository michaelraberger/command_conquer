import {
  RESOURCE_GEMS,
  RESOURCE_NONE,
  RESOURCE_ORE,
  TERRAIN_BRIDGE,
  TERRAIN_DIRT,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  TERRAIN_TREE,
  TERRAIN_WATER,
  isBuildableKind,
  type CustomMapData,
} from '@cac/sim';

/**
 * Deterministic building blocks for campaign maps. Each mission builds its
 * CustomMapData in code (pure functions, fixed seeds) instead of shipping
 * ~100 KB JSON layers per map; the result is byte-identical on every call and
 * still runs through validateCustomMap in createGame and the campaign tests.
 */

export { RESOURCE_GEMS, RESOURCE_ORE, TERRAIN_BRIDGE, TERRAIN_DIRT, TERRAIN_GRASS, TERRAIN_ROCK, TERRAIN_TREE, TERRAIN_WATER };

/** Tiny deterministic RNG (mulberry32) for scatter decoration. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newMap(
  width: number,
  height: number,
  name: string,
  base: number = TERRAIN_GRASS,
): CustomMapData {
  const size = width * height;
  return {
    version: 1,
    name,
    width,
    height,
    terrain: new Array<number>(size).fill(base),
    ore: new Array<number>(size).fill(0),
    resourceKind: new Array<number>(size).fill(RESOURCE_NONE),
    spawns: [],
    mapType: 'BADLANDS',
    neutralBuildings: [],
  };
}

export function fillRect(
  map: CustomMapData,
  x: number,
  y: number,
  w: number,
  h: number,
  terrain: number,
): void {
  for (let cy = Math.max(0, y); cy < Math.min(map.height, y + h); cy++) {
    for (let cx = Math.max(0, x); cx < Math.min(map.width, x + w); cx++) {
      map.terrain[cy * map.width + cx] = terrain;
    }
  }
}

/** Clears decoration back to open ground (spawn areas, base plots, roads). */
export function clearRect(map: CustomMapData, x: number, y: number, w: number, h: number, terrain = TERRAIN_DIRT): void {
  fillRect(map, x, y, w, h, terrain);
  for (let cy = Math.max(0, y); cy < Math.min(map.height, y + h); cy++) {
    for (let cx = Math.max(0, x); cx < Math.min(map.width, x + w); cx++) {
      const idx = cy * map.width + cx;
      map.ore[idx] = 0;
      map.resourceKind[idx] = RESOURCE_NONE;
    }
  }
}

/** Scatters single-cell decoration (rocks/trees) on open ground. */
export function scatter(
  map: CustomMapData,
  terrain: number,
  count: number,
  seed: number,
  margin = 2,
): void {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const cx = margin + Math.floor(rand() * (map.width - 2 * margin));
    const cy = margin + Math.floor(rand() * (map.height - 2 * margin));
    const idx = cy * map.width + cx;
    if (!isBuildableKind(map.terrain[idx]!)) continue;
    if (map.resourceKind[idx] !== RESOURCE_NONE) continue;
    map.terrain[idx] = terrain;
  }
}

/** Round resource patch (ore/gems) on passable ground. */
export function orePatch(
  map: CustomMapData,
  cx: number,
  cy: number,
  radius: number,
  kind: number = RESOURCE_ORE,
  amount = 600,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 1 || y < 1 || x >= map.width - 1 || y >= map.height - 1) continue;
      const idx = y * map.width + x;
      if (!isBuildableKind(map.terrain[idx]!)) continue;
      map.ore[idx] = amount;
      map.resourceKind[idx] = kind;
    }
  }
}

/**
 * Vertical river (a water column) with bridge decks at the given y rows.
 * Bridges are 1 cell wide here — chokepoints by design.
 */
export function riverVertical(
  map: CustomMapData,
  x: number,
  width: number,
  bridgesAtY: number[] = [],
): void {
  fillRect(map, x, 0, width, map.height, TERRAIN_WATER);
  for (const by of bridgesAtY) fillRect(map, x, by, width, 1, TERRAIN_BRIDGE);
}

export function riverHorizontal(
  map: CustomMapData,
  y: number,
  height: number,
  bridgesAtX: number[] = [],
): void {
  fillRect(map, 0, y, map.width, height, TERRAIN_WATER);
  for (const bx of bridgesAtX) fillRect(map, bx, y, 1, height, TERRAIN_BRIDGE);
}

/** Registers spawns and stamps their clear zones (validateCustomMap radius 4). */
export function setSpawns(map: CustomMapData, spawns: Array<[number, number]>): void {
  map.spawns = spawns;
  for (const [sx, sy] of spawns) clearRect(map, sx - 4, sy - 4, 9, 9, TERRAIN_GRASS);
}

/** Rocky map frame so armies don't hug the void at the edge. */
export function frame(map: CustomMapData, thickness = 1): void {
  fillRect(map, 0, 0, map.width, thickness, TERRAIN_ROCK);
  fillRect(map, 0, map.height - thickness, map.width, thickness, TERRAIN_ROCK);
  fillRect(map, 0, 0, thickness, map.height, TERRAIN_ROCK);
  fillRect(map, map.width - thickness, 0, thickness, map.height, TERRAIN_ROCK);
}
