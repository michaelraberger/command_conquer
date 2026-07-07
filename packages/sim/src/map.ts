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
 * Deterministic map generation. Uses the sim RNG, so the terrain is part of
 * the seeded game state; (seed, mapType) fully determines the map.
 */
export function generateTerrain(
  width: number,
  height: number,
  rng: RngCarrier,
  mapType: MapType = 'BADLANDS',
): Uint8Array {
  if (mapType === 'RIVER') return generateRiver(width, height, rng);
  if (mapType === 'ISLANDS') return generateIslands(width, height, rng);
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
function generateIslands(width: number, height: number, rng: RngCarrier): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_WATER);

  const island = (bx: number, by: number, r: number): void => {
    for (let cy = by - r - 1; cy <= by + r + 1; cy++) {
      for (let cx = bx - r - 1; cx <= bx + r + 1; cx++) {
        if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) continue;
        const dx = cx - bx;
        const dy = cy - by;
        // Jittered edge so coastlines don't look like perfect circles.
        const edge = r * r + nextInt(rng, 2 * r + 1) - r;
        if (dx * dx + dy * dy <= edge) terrain[cy * width + cx] = TERRAIN_DIRT;
      }
    }
  };

  // One home island per spawn, a contested center islet, a few scenic ones.
  island(16, 16, 12);
  island(46, 46, 12);
  island(32, 32, 6);
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
  return terrain;
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
