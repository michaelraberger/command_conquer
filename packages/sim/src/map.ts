import { nextInt, type RngCarrier } from './rng.js';
import { unitRule, type UnitType } from './rules.js';

/** Terrain kinds. Dirt, grass, ice, sand and bridges are passable, the rest
 *  blocks movement. Ice is a frozen surface: ground units cross it slowly,
 *  nothing can be built on it and ships cannot sail through it. Sand is a
 *  plain ground variant like dirt/grass (walkable and buildable). Bridges
 *  span water: ground units drive over them at full speed while ships pass
 *  beneath — but nothing can be built on them. Map/editor content only. */
export const TERRAIN_DIRT = 0;
export const TERRAIN_WATER = 1;
export const TERRAIN_ROCK = 2;
export const TERRAIN_TREE = 3;
export const TERRAIN_GRASS = 4;
export const TERRAIN_ICE = 5;
export const TERRAIN_SAND = 6;
export const TERRAIN_BRIDGE = 7;
/** A collapsed bridge cell: impassable for ground units, open for ships.
 *  Never authored in the editor — only bridge destruction produces it. */
export const TERRAIN_BRIDGE_WRECK = 8;

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
  return (
    kind === TERRAIN_DIRT ||
    kind === TERRAIN_GRASS ||
    kind === TERRAIN_ICE ||
    kind === TERRAIN_SAND ||
    kind === TERRAIN_BRIDGE
  );
}

/** Ground that supports structures: passable minus ice (nothing builds on ice). */
export function isBuildableKind(kind: number): boolean {
  return kind === TERRAIN_DIRT || kind === TERRAIN_GRASS || kind === TERRAIN_SAND;
}

/** Statically passable: walkable terrain and no building on the cell. */
export function isPassableTerrain(grid: GridView, cx: number, cy: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  return isPassableKind(grid.terrain[idx]!) && grid.structures[idx] === 0;
}

/** Like isPassableTerrain, but for placing structures (excludes ice). */
export function isBuildableTerrain(grid: GridView, cx: number, cy: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  return isBuildableKind(grid.terrain[idx]!) && grid.structures[idx] === 0;
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

/** Sailable for ships: water or the passage under a (possibly collapsed)
 *  bridge, no structure. */
export function isNavigableWater(grid: GridView, cx: number, cy: number): boolean {
  if (!inBounds(grid, cx, cy)) return false;
  const idx = cellIndex(grid, cx, cy);
  const t = grid.terrain[idx];
  return (
    (t === TERRAIN_WATER || t === TERRAIN_BRIDGE || t === TERRAIN_BRIDGE_WRECK) &&
    grid.structures[idx] === 0
  );
}

/* ---------------------- unit occupancy bookkeeping ----------------------- *
 * occupancy[cell] holds one of three states:
 *   0    free
 *   +id  a single vehicle/ship (classic reservation)
 *   -n   a pack of n infantry (1..INFANTRY_STACK share the tile)
 * Every ground unit is counted in exactly the cell `unit.cell`; all
 * transitions go through the helpers below so the counters can never drift.
 * Air units never touch the grid.                                           */

/** How many infantry may share one tile (classic C&C clumping). */
export const INFANTRY_STACK = 3;

/** Minimal unit view for occupancy bookkeeping (avoids a state.ts cycle). */
export interface OccupantView {
  id: number;
  cell: number;
  type: UnitType;
}

export function isInfantryType(type: UnitType): boolean {
  return unitRule(type).category === 'infantry';
}

/** Whether `cellIdx` is occupancy-blocked for THIS unit (its own cell never is). */
export function cellBlockedFor(grid: GridView, unit: OccupantView, cellIdx: number): boolean {
  if (cellIdx === unit.cell) return false;
  const occ = grid.occupancy[cellIdx]!;
  if (occ === 0) return false;
  if (isInfantryType(unit.type)) return occ > 0 || occ <= -INFANTRY_STACK;
  return true;
}

/** Raw reservation of `cellIdx` (no release) — precondition: not blocked. */
export function reserveCell(grid: GridView, unit: OccupantView, cellIdx: number): void {
  if (isInfantryType(unit.type)) {
    const occ = grid.occupancy[cellIdx]!;
    grid.occupancy[cellIdx] = occ < 0 ? occ - 1 : -1;
  } else {
    grid.occupancy[cellIdx] = unit.id;
  }
  unit.cell = cellIdx;
}

/** Removes the unit from its booked cell (death, boarding, consuming, deploy). */
export function releaseCell(grid: GridView, unit: OccupantView): void {
  const occ = grid.occupancy[unit.cell]!;
  if (isInfantryType(unit.type)) {
    if (occ < 0) grid.occupancy[unit.cell] = occ + 1;
  } else if (occ === unit.id) {
    grid.occupancy[unit.cell] = 0;
  }
}

/** Moves the unit's booking from its current cell to `cellIdx`. */
export function claimCell(grid: GridView, unit: OccupantView, cellIdx: number): void {
  releaseCell(grid, unit);
  reserveCell(grid, unit, cellIdx);
}

/** Open water for placing water buildings (shipyard): bridges don't count. */
export function isOpenWater(grid: GridView, cx: number, cy: number): boolean {
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
 * from the 64² reference layout to the actual map size. Small maps (≤64) scale
 * proportionally; LARGER maps stretch the layout's bounding box out to a fixed
 * edge margin instead — a plain proportional scale would keep the bases
 * huddled in the 64²-layout's span and leave the outer third of a 192² map
 * dead. Opponents start genuinely far apart and the whole map is in play.
 */
export function spawnCenters(
  playerCount: number,
  width = 64,
  height = 64,
): ReadonlyArray<readonly [number, number]> {
  const base = SPAWN_LAYOUTS[Math.max(2, Math.min(6, playerCount))]!;
  if (width === 64 && height === 64) return base;
  if (Math.min(width, height) <= 64) {
    return base.map(([x, y]) => [Math.round((x / 64) * width), Math.round((y / 64) * height)] as const);
  }
  const margin = Math.max(10, Math.round(Math.min(width, height) / 12));
  const xs = base.map((p) => p[0]);
  const ys = base.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const stretch = (v: number, lo: number, hi: number, dim: number): number =>
    hi === lo
      ? Math.round(dim / 2)
      : Math.round(margin + ((v - lo) / (hi - lo)) * (dim - 1 - 2 * margin));
  return base.map(
    ([x, y]) => [stretch(x, minX, maxX, width), stretch(y, minY, maxY, height)] as const,
  );
}

/** Home-island radius shrinks as more islands must share the ocean and grows
 *  with the map (tuned for 64²; identical there by construction). */
function islandRadius(playerCount: number, minDim: number): number {
  const base = playerCount <= 2 ? 12 : playerCount <= 4 ? 10 : playerCount === 5 ? 9 : 8;
  return Math.round((base * minDim) / 64);
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
  if (mapType === 'ISLANDS') return generateIslands(width, height, rng, spawns);
  const terrain =
    mapType === 'RIVER'
      ? generateRiver(width, height, rng)
      : generateBadlands(width, height, rng, spawns);
  carveTrails(terrain, width, height, rng, spawns);
  const nearSpawn = (cx: number, cy: number): boolean =>
    spawns.some(([sx, sy]) => (cx - sx) * (cx - sx) + (cy - sy) * (cy - sy) < 49);
  stoneRiverBanks(terrain, width, height, rng, nearSpawn);
  return terrain;
}

/**
 * Trampled DIRT trails from each base toward the map centre — pure flavour
 * in the spirit of the Tiberian-Dawn maps (worn brown tracks through the
 * grass). Only soft ground is painted; water, rock and trees stay untouched,
 * so the trail fades where the terrain gets rough (and never bridges the
 * river). Runs in straight-ish segments instead of per-step jitter so the
 * track reads as a smooth path, not a staircase. Deterministic via the rng.
 */
function carveTrails(
  terrain: Uint8Array,
  width: number,
  height: number,
  rng: RngCarrier,
  spawns: ReadonlyArray<readonly [number, number]>,
): void {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  const paint = (cx: number, cy: number): void => {
    if (cx < 1 || cy < 1 || cx >= width - 1 || cy >= height - 1) return;
    const idx = cy * width + cx;
    if (terrain[idx] === TERRAIN_GRASS || terrain[idx] === TERRAIN_SAND) {
      terrain[idx] = TERRAIN_DIRT;
    }
  };
  for (const [sx, sy] of spawns) {
    let x = sx;
    let y = sy;
    let guard = width + height;
    // Walk in segments: pick an axis, follow it for a few cells, re-decide.
    let axisX = Math.abs(midX - x) > Math.abs(midY - y);
    let run = 0;
    while ((x !== midX || y !== midY) && guard-- > 0) {
      paint(x, y);
      paint(x + 1, y);
      paint(x, y + 1);
      if (run <= 0) {
        // New segment: mostly toward the centre, occasionally a sidestep.
        axisX = nextInt(rng, 5) === 0 ? !axisX : Math.abs(midX - x) >= Math.abs(midY - y);
        run = 2 + nextInt(rng, 4);
      }
      if (axisX && midX !== x) x += Math.sign(midX - x);
      else if (midY !== y) y += Math.sign(midY - y);
      else if (midX !== x) x += Math.sign(midX - x);
      run--;
      x = Math.max(1, Math.min(width - 2, x));
      y = Math.max(1, Math.min(height - 2, y));
    }
  }
}

/**
 * A narrow meandering stream across the whole map (Tiberian-Dawn look):
 * momentum walk from one edge to the other, 1–2 cells wide, with shallow
 * DIRT fords at regular intervals so ground armies always find crossings.
 */
function carveStream(
  terrain: Uint8Array,
  width: number,
  height: number,
  rng: RngCarrier,
  nearSpawn: (cx: number, cy: number) => boolean,
): void {
  const vertical = nextInt(rng, 2) === 0;
  const long = vertical ? height : width;
  let cross = 8 + nextInt(rng, (vertical ? width : height) - 16);
  const fordEvery = Math.floor(long / 3);
  let drift = 0;
  let breadth = 2;
  for (let along = 0; along < long; along++) {
    // Momentum: the drift changes rarely, so the stream bends in soft curves;
    // the breadth swells and narrows slowly (1–3 cells) like the original.
    if (nextInt(rng, 4) === 0) drift = nextInt(rng, 3) - 1;
    if (nextInt(rng, 6) === 0) breadth = 1 + nextInt(rng, 3);
    cross = Math.max(6, Math.min((vertical ? width : height) - 7, cross + drift));
    // Crossings are real bridges (classic C&C): destructible spans over the
    // stream instead of dirt fords.
    const ford = along % fordEvery === Math.floor(fordEvery / 2);
    for (let w = 0; w < breadth; w++) {
      const cx = vertical ? cross + w : along;
      const cy = vertical ? along : cross + w;
      if (nearSpawn(cx, cy)) continue;
      // Never wash away an earlier stream's crossing: a later stream cutting
      // a bridge line would leave a water gap in the only ground connection.
      if (terrain[cy * width + cx] === TERRAIN_BRIDGE) continue;
      terrain[cy * width + cx] = ford ? TERRAIN_BRIDGE : TERRAIN_WATER;
    }
  }
}

/** Tiberian-Dawn-style badlands: GRASS base, a meandering stream with fords,
 *  dirt clearings, long rock ridges and plenty of scattered conifers. */
function generateBadlands(
  width: number,
  height: number,
  rng: RngCarrier,
  spawns: ReadonlyArray<readonly [number, number]> = [],
): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_GRASS);
  /** Feature counts are tuned for 64²; larger maps multiply them by the area
   *  ratio so the landscape stays as busy per screen, not per map. ×1 at ≤64
   *  by construction (existing seeds unchanged there). */
  const f = Math.max(1, Math.round((width * height) / 4096));
  /** Ridges must never crowd a base: keep a clear apron around every spawn. */
  const nearSpawn = (cx: number, cy: number): boolean =>
    spawns.some(([sx, sy]) => (cx - sx) * (cx - sx) + (cy - sy) * (cy - sy) < 49);

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

  // Soft dirt clearings break up the green, plus a couple of small ponds.
  for (let i = 0; i < 6 * f; i++) stampBlob(TERRAIN_DIRT, 2, 4);
  for (let i = 0; i < 2 * f; i++) stampBlob(TERRAIN_WATER, 2, 3);
  // A winding stream across the map with crossings; big maps get two or three
  // so the water reads as a river system instead of one lonely edge trickle.
  carveStream(terrain, width, height, rng, nearSpawn);
  const extraStreams = f >= 9 ? 2 : f >= 4 ? 1 : 0;
  for (let i = 0; i < extraStreams; i++) carveStream(terrain, width, height, rng, nearSpawn);
  // Long rock RIDGES: orthogonally connected stair-step walks (like classic
  // cliff lines), occasionally thickened by a shoulder cell. Length scales
  // with the map side so ridges stay landscape features, not pebbles.
  for (let i = 0; i < 5 * f; i++) {
    let x = 4 + nextInt(rng, width - 8);
    let y = 4 + nextInt(rng, height - 8);
    const dirX = nextInt(rng, 2) === 0 ? 1 : -1;
    const dirY = nextInt(rng, 2) === 0 ? 1 : -1;
    const len = Math.round(((7 + nextInt(rng, 8)) * Math.min(width, height)) / 64);
    for (let s = 0; s < len; s++) {
      const widen = nextInt(rng, 3) === 0;
      if (!nearSpawn(x, y)) {
        terrain[y * width + x] = TERRAIN_ROCK;
        if (widen && !nearSpawn(x + 1, y)) {
          terrain[y * width + Math.min(width - 2, x + 1)] = TERRAIN_ROCK;
        }
      }
      if (nextInt(rng, 2) === 0) x += dirX;
      else y += dirY;
      x = Math.max(2, Math.min(width - 3, x));
      y = Math.max(2, Math.min(height - 3, y));
    }
  }
  scatterTrees(terrain, width, height, rng, 20 * f, true);
  return terrain;
}

/** A wide meandering river splits the map; one narrow land bridge crosses it. */
function generateRiver(width: number, height: number, rng: RngCarrier): Uint8Array {
  // Tiberian-Dawn look: green base with soft dirt clearings. Feature counts
  // are 64²-tuned and multiply with the area (×1 at ≤64 by construction).
  const f = Math.max(1, Math.round((width * height) / 4096));
  const terrain = new Uint8Array(width * height).fill(TERRAIN_GRASS);
  const dirtBlob = (): void => {
    const bx = 4 + nextInt(rng, width - 8);
    const by = 4 + nextInt(rng, height - 8);
    const r = 2 + nextInt(rng, 4);
    for (let cy = by - r; cy <= by + r; cy++) {
      for (let cx = bx - r; cx <= bx + r; cx++) {
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        const dx = cx - bx;
        const dy = cy - by;
        if (dx * dx + dy * dy <= r * r && terrain[cy * width + cx] === TERRAIN_GRASS) {
          terrain[cy * width + cx] = TERRAIN_DIRT;
        }
      }
    }
  };
  for (let i = 0; i < 6 * f; i++) dirtBlob();

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
  // Narrow crossings — THE ground chokepoints; air flies anywhere. Classic
  // C&C style: a real bridge deck spans the water (each cell gets a neutral,
  // destructible span at game start), with dirt trail mouths on both banks.
  // A 64² valley has exactly one (unchanged); big maps get two or three so a
  // dropped bridge doesn't mean a 150-cell detour.
  const carveCrossing = (bridgeY: number): void => {
    for (let y = bridgeY; y < bridgeY + 3 && y < height; y++) {
      for (let cx = riverX[y]! - 5; cx <= riverX[y]! + 5; cx++) {
        if (terrain[y * width + cx] !== TERRAIN_WATER) terrain[y * width + cx] = TERRAIN_DIRT;
      }
    }
    const spanY = Math.min(bridgeY + 1, height - 1);
    for (let cx = riverX[spanY]! - 5; cx <= riverX[spanY]! + 5; cx++) {
      if (terrain[spanY * width + cx] === TERRAIN_WATER) {
        terrain[spanY * width + cx] = TERRAIN_BRIDGE;
      }
    }
  };
  const crossingYs = [16 + nextInt(rng, height - 32)];
  const extraCrossings = f >= 9 ? 2 : f >= 4 ? 1 : 0;
  for (let i = 0; i < extraCrossings; i++) {
    // Bounded deterministic retry: keep extra crossings away from existing ones.
    for (let attempt = 0; attempt < 5; attempt++) {
      const y = 16 + nextInt(rng, height - 32);
      if (crossingYs.some((cy) => Math.abs(cy - y) < Math.floor(height / 6))) continue;
      crossingYs.push(y);
      break;
    }
  }
  for (const y of crossingYs) carveCrossing(y);
  scatterTrees(terrain, width, height, rng, 10 * f, true);
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
  const r = islandRadius(spawns.length, Math.min(width, height));
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
  /** Also pepper lone conifers between the woods (Tiberian-Dawn look).
   *  Off for island maps: grass is rare there and the extra rng draws would
   *  reshuffle the whole coastline layout for nothing. */
  singles = false,
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
  if (!singles) return;
  const lone = Math.floor((width * height) / 90);
  for (let i = 0; i < lone; i++) {
    const cx = 2 + nextInt(rng, width - 4);
    const cy = 2 + nextInt(rng, height - 4);
    const idx = cy * width + cx;
    if (terrain[idx] === TERRAIN_GRASS) terrain[idx] = TERRAIN_TREE;
  }
}

/**
 * Rocky river banks (Tiberian-Dawn look): grass cells hugging the water may
 * turn into rock piles. Anything within two cells of DIRT stays clear — that
 * one rule protects fords, the river-map bridge and trail mouths at once.
 */
function stoneRiverBanks(
  terrain: Uint8Array,
  width: number,
  height: number,
  rng: RngCarrier,
  nearSpawn: (cx: number, cy: number) => boolean,
): void {
  const at = (cx: number, cy: number): number | undefined =>
    cx < 0 || cy < 0 || cx >= width || cy >= height ? undefined : terrain[cy * width + cx];
  const nearDirt = (cx: number, cy: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = at(cx + dx, cy + dy);
        // Bridges count like dirt: their mouths must stay rock-free.
        if (t === TERRAIN_DIRT || t === TERRAIN_BRIDGE) return true;
      }
    }
    return false;
  };
  for (let cy = 1; cy < height - 1; cy++) {
    for (let cx = 1; cx < width - 1; cx++) {
      if (terrain[cy * width + cx] !== TERRAIN_GRASS) continue;
      const touchesWater =
        at(cx + 1, cy) === TERRAIN_WATER ||
        at(cx - 1, cy) === TERRAIN_WATER ||
        at(cx, cy + 1) === TERRAIN_WATER ||
        at(cx, cy - 1) === TERRAIN_WATER;
      if (!touchesWater) continue;
      if (nearSpawn(cx, cy) || nearDirt(cx, cy)) continue;
      if (nextInt(rng, 4) === 0) terrain[cy * width + cx] = TERRAIN_ROCK;
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
