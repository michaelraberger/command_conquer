import { nextInt, type RngCarrier } from './rng.js';

/** Terrain kinds. Dirt and grass are passable, the rest blocks movement. */
export const TERRAIN_DIRT = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_ROCK = 2;
export const TERRAIN_TREE = 3;
export const TERRAIN_GRASS = 4;

/** Resource field kinds (per cell, permanent — fields regrow on them). */
export const RESOURCE_NONE = 0;
export const RESOURCE_ORE = 1;
export const RESOURCE_GEMS = 2;

/** Minimal view of GameState needed by grid helpers (avoids import cycle). */
export interface GridView {
  mapWidth: number;
  mapHeight: number;
  terrain: Uint8Array;
  /** Unit id occupying/reserving each cell, 0 = free. */
  occupancy: Int32Array;
  /** Building id covering each cell, 0 = free. Static obstacles. */
  structures: Int32Array;
  /** For gate cells: owner id + 1 (so 0 = no gate). Own gates are passable to
   *  their owner; every other structure blocks. */
  gateOwner: Int32Array;
}

export function cellIndex(grid: GridView, cx: number, cy: number): number {
  return cy * grid.mapWidth + cx;
}

export function inBounds(grid: GridView, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.mapWidth && cy < grid.mapHeight;
}

export function isPassableKind(kind: number): boolean {
  return kind === TERRAIN_DIRT || kind === TERRAIN_GRASS;
}

/** Statically passable: walkable terrain and no building on the cell. */
export function isPassableTerrain(grid: GridView, cx: number, cy: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  return isPassableKind(grid.terrain[idx]!) && grid.structures[idx] === 0;
}

/**
 * Passability for a specific owner's ground unit: like isPassableTerrain, but a
 * gate belonging to `owner` is passable (it opens for its owner's units), while
 * every other structure — walls, buildings, enemy gates — still blocks.
 */
export function passableFor(grid: GridView, cx: number, cy: number, owner: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  if (!isPassableKind(grid.terrain[idx]!)) return false;
  if (grid.structures[idx] === 0) return true;
  return grid.gateOwner[idx] === owner + 1;
}

/** Sailable for ships: open water without a structure (shipyard blocks). */
export function isNavigableWater(grid: GridView, cx: number, cy: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  return grid.terrain[idx] === TERRAIN_WATER && grid.structures[idx] === 0;
}

/** Selectable map layouts. Islands make air (and later naval) units matter. */
export type MapType = 'BADLANDS' | 'RIVER' | 'ISLANDS';
export const MAP_TYPES: readonly MapType[] = ['BADLANDS', 'RIVER', 'ISLANDS'];
export const MAP_NAMES: Record<MapType, string> = {
  BADLANDS: 'Ödland',
  RIVER: 'Flusstal',
  ISLANDS: 'Inselgruppe',
};

/**
 * Base/island centre per player, keyed by total player count (2–6). Positions
 * are spread out and, on ISLANDS, chosen so one home island per player fits the
 * ocean. Player id `i` uses entry `i`.
 */
const SPAWN_LAYOUTS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  2: [[16, 16], [46, 46]],
  3: [[32, 15], [15, 48], [49, 48]],
  4: [[16, 16], [48, 16], [16, 48], [48, 48]],
  5: [[16, 16], [48, 16], [16, 48], [48, 48], [32, 32]],
  6: [[51, 32], [42, 48], [22, 48], [13, 32], [22, 16], [42, 16]],
};

/**
 * Spawn centres for a game with `playerCount` players (clamped to 2–6), scaled
 * from the 64² reference layout to the actual map size (so map size just spreads
 * the same arrangement out or in).
 */
export function spawnCenters(
  playerCount: number,
  width = 64,
  height = 64,
): ReadonlyArray<readonly [number, number]> {
  const base = SPAWN_LAYOUTS[Math.max(2, Math.min(6, playerCount))]!;
  if (width === 64 && height === 64) return base;
  return base.map(([x, y]) => [Math.round((x / 64) * width), Math.round((y / 64) * height)] as const);
}

/** Home-island radius shrinks as more islands must share the ocean. */
function islandRadius(playerCount: number): number {
  return playerCount <= 2 ? 12 : playerCount <= 4 ? 10 : playerCount === 5 ? 9 : 8;
}

/** True when a home island sits close enough to the centre to skip the islet. */
function centreTakenBy(
  spawns: ReadonlyArray<readonly [number, number]>,
  cx: number,
  cy: number,
): boolean {
  return spawns.some(([x, y]) => Math.abs(x - cx) <= 8 && Math.abs(y - cy) <= 8);
}

/**
 * Deterministic map generation. Uses the sim RNG, so the terrain is part of
 * the seeded game state; (seed, mapType, playerCount) fully determines the map.
 */
export function generateTerrain(
  width: number,
  height: number,
  rng: RngCarrier,
  mapType: MapType = 'BADLANDS',
  spawns: ReadonlyArray<readonly [number, number]> = SPAWN_LAYOUTS[2]!,
): Uint8Array {
  if (mapType === 'RIVER') return generateRiver(width, height, rng);
  if (mapType === 'ISLANDS') return generateIslands(width, height, rng, spawns);
  return generateBadlands(width, height, rng);
}

/** Classic badlands: dirt base, grass patches, lakes, rocks, tree clusters. */
function generateBadlands(width: number, height: number, rng: RngCarrier): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_DIRT);

  const stampBlob = (kind: number, minR: number, maxR: number): void => {
    const bx = 4 + nextInt(rng, width - 8);
    const by = 4 + nextInt(rng, height - 8);
    const r = minR + nextInt(rng, maxR - minR + 1);
    for (let cy = by - r; cy <= by + r; cy++) {
      for (let cx = bx - r; cx <= bx + r; cx++) {
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        const dx = cx - bx;
        const dy = cy - by;
        if (dx * dx + dy * dy <= r * r) terrain[cy * width + cx] = kind;
      }
    }
  };

  for (let i = 0; i < 10; i++) stampBlob(TERRAIN_GRASS, 2, 5); // grass first, others carve into it
  for (let i = 0; i < 5; i++) stampBlob(TERRAIN_WATER, 2, 4);
  for (let i = 0; i < 8; i++) {
    // Rock ridges: a center cell plus a few neighbors.
    const bx = 2 + nextInt(rng, width - 4);
    const by = 2 + nextInt(rng, height - 4);
    terrain[by * width + bx] = TERRAIN_ROCK;
    for (let n = 0; n < 5; n++) {
      const cx = bx + nextInt(rng, 3) - 1;
      const cy = by + nextInt(rng, 3) - 1;
      terrain[cy * width + cx] = TERRAIN_ROCK;
    }
  }
  scatterTrees(terrain, width, height, rng, 14);
  return terrain;
}

/** A wide meandering river splits the map; one narrow land bridge crosses it. */
function generateRiver(width: number, height: number, rng: RngCarrier): Uint8Array {
  // Start from a badlands-style land base with fewer lakes.
  const terrain = new Uint8Array(width * height).fill(TERRAIN_DIRT);
  const grassBlob = (): void => {
    const bx = 4 + nextInt(rng, width - 8);
    const by = 4 + nextInt(rng, height - 8);
    const r = 2 + nextInt(rng, 4);
    for (let cy = by - r; cy <= by + r; cy++) {
      for (let cx = bx - r; cx <= bx + r; cx++) {
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        const dx = cx - bx;
        const dy = cy - by;
        if (dx * dx + dy * dy <= r * r && terrain[cy * width + cx] === TERRAIN_DIRT) {
          terrain[cy * width + cx] = TERRAIN_GRASS;
        }
      }
    }
  };
  for (let i = 0; i < 8; i++) grassBlob();

  // Carve the river top→bottom around the map middle, meandering.
  const riverX: number[] = [];
  let x = Math.floor(width / 2) + nextInt(rng, 7) - 3;
  for (let y = 0; y < height; y++) {
    x += nextInt(rng, 3) - 1; // -1, 0, +1
    x = Math.max(12, Math.min(width - 13, x));
    riverX.push(x);
    const half = 2 + nextInt(rng, 2); // width 5–7 cells
    for (let cx = x - half; cx <= x + half; cx++) {
      terrain[y * width + cx] = TERRAIN_WATER;
    }
  }
  // One narrow land bridge — THE ground chokepoint; air flies anywhere.
  const bridgeY = 16 + nextInt(rng, height - 32);
  for (let y = bridgeY; y < bridgeY + 3 && y < height; y++) {
    for (let cx = riverX[y]! - 5; cx <= riverX[y]! + 5; cx++) {
      terrain[y * width + cx] = TERRAIN_DIRT;
    }
  }
  scatterTrees(terrain, width, height, rng, 10);
  return terrain;
}

/** Player islands in an ocean — ground armies cannot reach each other. */
function generateIslands(
  width: number,
  height: number,
  rng: RngCarrier,
  spawns: ReadonlyArray<readonly [number, number]>,
): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_WATER);
  const r = islandRadius(spawns.length);
  const midX = Math.round(width / 2);
  const midY = Math.round(height / 2);
  const centreTaken = centreTakenBy(spawns, midX, midY);

  const island = (bx: number, by: number, rad: number): void => {
    for (let cy = by - rad - 1; cy <= by + rad + 1; cy++) {
      for (let cx = bx - rad - 1; cx <= bx + rad + 1; cx++) {
        if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) continue;
        const dx = cx - bx;
        const dy = cy - by;
        // Jittered edge so coastlines don't look like perfect circles.
        const edge = rad * rad + nextInt(rng, 2 * rad + 1) - rad;
        if (dx * dx + dy * dy <= edge) terrain[cy * width + cx] = TERRAIN_DIRT;
      }
    }
  };

  // One home island per spawn, a contested center islet (unless a player sits
  // there), a few scenic ones.
  for (const [sx, sy] of spawns) island(sx, sy, r);
  if (!centreTaken) island(midX, midY, 6);
  for (let i = 0; i < 4; i++) {
    island(6 + nextInt(rng, width - 12), 6 + nextInt(rng, height - 12), 2 + nextInt(rng, 2));
  }
  // Greenery and cover on land only.
  for (let i = 0; i < 8; i++) {
    const bx = 2 + nextInt(rng, width - 4);
    const by = 2 + nextInt(rng, height - 4);
    const r = 1 + nextInt(rng, 3);
    for (let cy = by - r; cy <= by + r; cy++) {
      for (let cx = bx - r; cx <= bx + r; cx++) {
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        const idx = cy * width + cx;
        if (terrain[idx] === TERRAIN_DIRT) terrain[idx] = TERRAIN_GRASS;
      }
    }
  }
  scatterTrees(terrain, width, height, rng, 8);
  // Cliff the whole shoreline, then cut a few landable beach bays into it.
  treatCoasts(terrain, width, height, rng, spawns, r, centreTaken);
  return terrain;
}

/**
 * Coastal treatment for island maps: line the entire shoreline with impassable
 * cliffs (ROCK), then carve a handful of clear beach bays (DIRT) per island.
 * Ships can therefore only land at the bays, not anywhere along the coast.
 * Deterministic (runs in the seeded RNG stream) and only ever turns land into
 * other land — never water — so island separation and water share are kept.
 */
function treatCoasts(
  terrain: Uint8Array,
  width: number,
  height: number,
  rng: RngCarrier,
  spawns: ReadonlyArray<readonly [number, number]>,
  radius: number,
  centreTaken: boolean,
): void {
  const isWater = (cx: number, cy: number): boolean =>
    cx >= 0 && cy >= 0 && cx < width && cy < height && terrain[cy * width + cx] === TERRAIN_WATER;

  // 1. Every land cell touching water becomes a cliff.
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const idx = cy * width + cx;
      if (terrain[idx] === TERRAIN_WATER) continue;
      let coast = false;
      for (let dy = -1; dy <= 1 && !coast; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx !== 0 || dy !== 0) && isWater(cx + dx, cy + dy)) {
            coast = true;
            break;
          }
        }
      }
      if (coast) terrain[idx] = TERRAIN_ROCK;
    }
  }

  // 2. Carve beach bays: walk out from an island center in a few directions to
  // the first cliff cell, then clear a small blob of cliff back to open dirt.
  const DIRS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const carveBeach = (bx: number, by: number, dirX: number, dirY: number, reach: number): void => {
    for (let t = 1; t <= reach; t++) {
      const ax = bx + dirX * t;
      const ay = by + dirY * t;
      if (ax < 0 || ay < 0 || ax >= width || ay >= height) return;
      const cell = terrain[ay * width + ax]!;
      if (cell === TERRAIN_WATER) return; // no cliff found before the sea
      if (cell !== TERRAIN_ROCK) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const x = ax + dx;
          const y = ay + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          if (terrain[y * width + x] === TERRAIN_ROCK) terrain[y * width + x] = TERRAIN_DIRT;
        }
      }
      return;
    }
  };
  const beachIsland = (bx: number, by: number, r: number, count: number): void => {
    const start = nextInt(rng, 8);
    for (let k = 0; k < count; k++) {
      const [dx, dy] = DIRS[(start + k * 3) % 8]!;
      carveBeach(bx, by, dx, dy, r * 2 + 4);
    }
  };
  // Home islands get three bays each; the contested center islet gets two.
  for (const [sx, sy] of spawns) beachIsland(sx, sy, radius, 3);
  if (!centreTaken) beachIsland(Math.round(width / 2), Math.round(height / 2), 6, 2);
}

/** Tree clusters on walkable land (block movement, read as forest). */
function scatterTrees(
  terrain: Uint8Array,
  width: number,
  height: number,
  rng: RngCarrier,
  clusters: number,
): void {
  for (let i = 0; i < clusters; i++) {
    const bx = 2 + nextInt(rng, width - 4);
    const by = 2 + nextInt(rng, height - 4);
    const n = 2 + nextInt(rng, 4);
    for (let t = 0; t < n; t++) {
      const cx = bx + nextInt(rng, 3) - 1;
      const cy = by + nextInt(rng, 3) - 1;
      const idx = cy * width + cx;
      if (terrain[idx] === TERRAIN_DIRT || terrain[idx] === TERRAIN_GRASS) {
        terrain[idx] = TERRAIN_TREE;
      }
    }
  }
}

/** Force an area back to open dirt (used to keep spawn zones clear). */
export function clearArea(
  terrain: Uint8Array,
  width: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= width || y * width + x >= terrain.length) continue;
      terrain[y * width + x] = TERRAIN_DIRT;
    }
  }
}

/**
 * Stamps a roughly circular resource field around (cx, cy). Forces the ground
 * to dirt so the field is always harvestable/reachable. The cells stay
 * permanently "fertile" (resourceKind), so depleted fields regrow.
 */
export function stampResourcePatch(
  grid: {
    mapWidth: number;
    mapHeight: number;
    terrain: Uint8Array;
    ore: Uint16Array;
    resourceKind: Uint8Array;
  },
  rng: RngCarrier,
  cx: number,
  cy: number,
  radius: number,
  kind: number,
): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= grid.mapWidth || y >= grid.mapHeight) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const idx = y * grid.mapWidth + x;
      grid.terrain[idx] = TERRAIN_DIRT;
      grid.ore[idx] = 400 + nextInt(rng, 300);
      grid.resourceKind[idx] = kind;
    }
  }
}

/**
 * Cells at exactly ring distance r around a w×h footprint whose top-left cell
 * is (cx, cy), in deterministic row-major order.
 */
export function cellsAroundRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
): Array<{ cx: number; cy: number }> {
  const out: Array<{ cx: number; cy: number }> = [];
  for (let y = cy - r; y <= cy + h - 1 + r; y++) {
    for (let x = cx - r; x <= cx + w - 1 + r; x++) {
      const dx = x < cx ? cx - x : x > cx + w - 1 ? x - (cx + w - 1) : 0;
      const dy = y < cy ? cy - y : y > cy + h - 1 ? y - (cy + h - 1) : 0;
      if ((dx > dy ? dx : dy) === r) out.push({ cx: x, cy: y });
    }
  }
  return out;
}
