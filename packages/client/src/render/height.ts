import { SUBCELL, TERRAIN_ROCK, TERRAIN_WATER, type GameState } from '@cac/sim';

/**
 * Client-side elevation: a deterministic height field derived from the sim's
 * terrain grid (rolling hills, low shores, raised rock ridges). It lives in
 * the RENDER layer only — plugged straight into the iso projection so ground,
 * doodads, buildings, units, effects and fog all rise and fall together while
 * the sim keeps thinking in flat 2D. Never feeds back into game logic.
 */

/** Peak hill height in screen pixels. */
const HILL_PX = 22;
/** Extra pedestal under rock ridges (the cliff plateaus ride on top). */
const ROCK_PX = 6;
/** Cells within this range of water slope down to the waterline. */
const SHORE_RANGE = 5;

let lattice: Float32Array | null = null;
let lw = 0;
let lh = 0;

/** Deterministic 0..1 hash (render flavour only). */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x2545f491;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function valueNoise(gx: number, gy: number): number {
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const a = hash01(x0, y0);
  const b = hash01(x0 + 1, y0);
  const c = hash01(x0, y0 + 1);
  const d = hash01(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Builds the corner-lattice height field for this game's terrain. */
export function installHeightField(state: GameState): void {
  const W = state.mapWidth;
  const H = state.mapHeight;
  lw = W + 1;
  lh = H + 1;

  // Distance-to-water per cell (BFS, capped) — shores ease down to sea level.
  const dist = new Int16Array(W * H).fill(SHORE_RANGE + 1);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (state.terrain[i] === TERRAIN_WATER) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const d = dist[i]! + 1;
    if (d > SHORE_RANGE) continue;
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (dist[ni]! > d) {
        dist[ni] = d;
        queue.push(ni);
      }
    }
  }

  const cellAt = (cx: number, cy: number): number | undefined =>
    cx < 0 || cy < 0 || cx >= W || cy >= H ? undefined : state.terrain[cy * W + cx];

  lattice = new Float32Array(lw * lh);
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      // Rolling hills from smooth value noise…
      let h = valueNoise(x / 6, y / 6) * HILL_PX;
      // …eased down toward water, and boosted under rock ridges.
      let dmin = SHORE_RANGE + 1;
      let rock = false;
      for (const [cx, cy] of [[x - 1, y - 1], [x, y - 1], [x - 1, y], [x, y]] as const) {
        const t = cellAt(cx, cy);
        if (t === undefined) continue;
        dmin = Math.min(dmin, dist[cy * W + cx]!);
        if (t === TERRAIN_ROCK) rock = true;
      }
      const shore = Math.min(1, dmin / SHORE_RANGE);
      h *= smooth(shore);
      if (rock) h += ROCK_PX * smooth(shore);
      lattice[y * lw + x] = h;
    }
  }

  // One relaxation pass keeps slopes gentle (kind to building footprints).
  const copy = lattice.slice();
  for (let y = 1; y < lh - 1; y++) {
    for (let x = 1; x < lw - 1; x++) {
      lattice[y * lw + x] =
        (copy[y * lw + x]! * 2 +
          copy[y * lw + x - 1]! +
          copy[y * lw + x + 1]! +
          copy[(y - 1) * lw + x]! +
          copy[(y + 1) * lw + x]!) /
        6;
    }
  }
}

/** Back to a flat world (start screen, editor). */
export function clearHeightField(): void {
  lattice = null;
}

function cornerHeight(x: number, y: number): number {
  if (!lattice) return 0;
  const cx = Math.max(0, Math.min(lw - 1, x));
  const cy = Math.max(0, Math.min(lh - 1, y));
  return lattice[cy * lw + cx]!;
}

/** Bilinear terrain height (screen px) at fixed-point world coordinates. */
export function heightAtWorld(fx: number, fy: number): number {
  if (!lattice) return 0;
  const gx = Math.max(0, Math.min(lw - 1.001, fx / SUBCELL));
  const gy = Math.max(0, Math.min(lh - 1.001, fy / SUBCELL));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fxr = gx - x0;
  const fyr = gy - y0;
  const a = lattice[y0 * lw + x0]!;
  const b = lattice[y0 * lw + x0 + 1]!;
  const c = lattice[(y0 + 1) * lw + x0]!;
  const d = lattice[(y0 + 1) * lw + x0 + 1]!;
  return a + (b - a) * fxr + (c - a) * fyr + (a - b - c + d) * fxr * fyr;
}

/**
 * Slope lighting for a cell: east-facing slopes catch the light, west-facing
 * ones fall into shade (matching every drop shadow in the game). Returns a
 * brightness factor around 1.
 */
export function slopeShade(cx: number, cy: number): number {
  if (!lattice) return 1;
  const nw = cornerHeight(cx, cy);
  const ne = cornerHeight(cx + 1, cy);
  const sw = cornerHeight(cx, cy + 1);
  const se = cornerHeight(cx + 1, cy + 1);
  // Screen-x runs along +cx/-cy: how much does the surface face the light?
  const eastDrop = (ne + se) / 2 - (nw + sw) / 2; // height gain toward +cx
  const southDrop = (sw + se) / 2 - (nw + ne) / 2; // height gain toward +cy
  const facing = southDrop - eastDrop; // >0 leans toward the eastern light
  return Math.max(0.82, Math.min(1.14, 1 + facing * 0.028));
}
