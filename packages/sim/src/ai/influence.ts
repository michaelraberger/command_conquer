/**
 * Influence maps for the AI: per-cell integer grids describing where enemy
 * firepower, own strength and enemy economy sit. The AI queries them to pick
 * weakly defended targets, safe staging spots and threatened base sectors.
 *
 * Everything here is derived scratch, recomputed on demand and NEVER part of
 * GameState — it must not enter serialize()/hashState(). Buffers follow the
 * astar.ts pattern: module-level, grown to the largest map seen, invalidated
 * by a generation stamp instead of an O(size) refill. Integer math only
 * (Chebyshev distances, linear falloff); iteration is row-major and entity
 * arrays are id-sorted, so results are deterministic by construction.
 */
import { buildingRule, unitRule } from '../rules.js';
import { areEnemies, type GameState } from '../state.js';

/** Extra cells of influence beyond a weapon's range (approach warning zone). */
const RANGE_PAD = 4;
/** Radius of the economic-value splat around enemy buildings. */
const ECON_RADIUS = 2;

let scratchSize = 0;
let threatGround = new Int32Array(0);
let threatAir = new Int32Array(0);
let ownStrength = new Int32Array(0);
let econValue = new Int32Array(0);
let stamp = new Int32Array(0);
let generation = 0;

function ensureScratch(size: number): void {
  if (size > scratchSize) {
    scratchSize = size;
    threatGround = new Int32Array(size);
    threatAir = new Int32Array(size);
    ownStrength = new Int32Array(size);
    econValue = new Int32Array(size);
    stamp = new Int32Array(size);
    generation = 0;
  }
  generation++;
  if (generation === 0x7fffffff) {
    stamp.fill(0);
    generation = 1;
  }
}

/** First write to a cell this generation clears all layers at that cell. */
function touch(i: number): void {
  if (stamp[i] !== generation) {
    stamp[i] = generation;
    threatGround[i] = 0;
    threatAir[i] = 0;
    ownStrength[i] = 0;
    econValue[i] = 0;
  }
}

/** Splat `weight` with linear Chebyshev falloff over radius `r` into `layer`. */
function splat(
  layer: Int32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  weight: number,
): void {
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      const cheby = Math.max(Math.abs(dx), Math.abs(dy));
      const i = y * w + x;
      touch(i);
      layer[i] = layer[i]! + ((((r - cheby) * weight) / r) | 0);
    }
  }
}

/**
 * Read-only view over the freshly computed layers of one perspective.
 * Only valid until the next computeInfluence call with a different key —
 * the layers are shared scratch. Use within one AI pass, never store.
 */
export interface InfluenceView {
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Enemy firepower able to hit ground targets at this cell. */
  threatGroundAt(cx: number, cy: number): number;
  /** Enemy firepower able to hit aircraft at this cell. */
  threatAirAt(cx: number, cy: number): number;
  /** Own + allied firepower at this cell. */
  ownStrengthAt(cx: number, cy: number): number;
  /** Value of enemy economy/production near this cell. */
  econAt(cx: number, cy: number): number;
  /** Own strength minus enemy ground threat — positive = we hold this area. */
  netAt(cx: number, cy: number): number;
  /** Enemy ground threat summed over the Chebyshev disk of radius r. */
  threatAround(cx: number, cy: number, r: number): number;
  /**
   * Cell with the least enemy ground threat on the Chebyshev ring of radius r
   * (deterministic: row-major scan, first minimum wins). Null off-map rings.
   */
  lowestThreatRingCell(cx: number, cy: number, r: number): { cx: number; cy: number } | null;
}

/** Combat weight of a unit/building: cost as an integer power proxy. */
function powerWeight(cost: number): number {
  return cost >> 4;
}

let cacheState: GameState | null = null;
let cacheTick = -1;
let cacheFoeMask = -1;
let cacheView: InfluenceView | null = null;

/**
 * Computes (or reuses) the influence view for one player's perspective.
 * Cached per (state, tick, enemy-mask): allied AIs share the same enemy set,
 * so on a typical "everyone vs the human" map the grids are built once per
 * tick regardless of how many AIs ask.
 */
export function computeInfluence(state: GameState, playerId: number): InfluenceView {
  let foeMask = 0;
  for (const p of state.players) {
    if (areEnemies(state, playerId, p.id)) foeMask |= 1 << p.id;
  }
  if (cacheView && cacheState === state && cacheTick === state.tick && cacheFoeMask === foeMask) {
    return cacheView;
  }

  const w = state.mapWidth;
  const h = state.mapHeight;
  const size = w * h;
  ensureScratch(size);

  for (const u of state.units) {
    const rule = unitRule(u.type);
    if (rule.weapon === null) continue;
    const foe = (foeMask & (1 << u.owner)) !== 0;
    if (!foe && u.owner < 0) continue; // armed neutrals belong to nobody
    const cx = u.cell % w;
    const cy = (u.cell - cx) / w;
    const r = (rule.weapon.range >> 8) + RANGE_PAD;
    const weight = powerWeight(rule.cost);
    if (!foe) {
      splat(ownStrength, w, h, cx, cy, r, weight);
    } else {
      const t = rule.weapon.targets;
      if (t !== 'air') splat(threatGround, w, h, cx, cy, r, weight);
      if (t !== 'ground') splat(threatAir, w, h, cx, cy, r, weight);
    }
  }

  for (const b of state.buildings) {
    if (b.type === 'WALL') continue;
    const rule = buildingRule(b.type);
    const foe = (foeMask & (1 << b.owner)) !== 0;
    const cx = b.cx + (rule.width >> 1);
    const cy = b.cy + (rule.height >> 1);
    if (rule.weapon !== null && (foe || b.owner >= 0)) {
      const r = (rule.weapon.range >> 8) + RANGE_PAD;
      const weight = powerWeight(rule.cost);
      const t = rule.weapon.targets;
      if (foe) {
        if (t !== 'air') splat(threatGround, w, h, cx, cy, r, weight);
        if (t !== 'ground') splat(threatAir, w, h, cx, cy, r, weight);
      } else {
        splat(ownStrength, w, h, cx, cy, r, weight);
      }
    }
    if (foe) {
      // Economic value: what a raid on this building is worth. Passive income
      // and ore storage weigh in on top of the plain build cost.
      const value = powerWeight(rule.cost) + (rule.income ?? 0) * 4 + ((rule.storage ?? 0) >> 6);
      splat(econValue, w, h, cx, cy, ECON_RADIUS, value);
    }
  }

  const gen = generation;
  const read = (layer: Int32Array, cx: number, cy: number): number => {
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) return 0;
    const i = cy * w + cx;
    return stamp[i] === gen ? layer[i]! : 0;
  };

  const view: InfluenceView = {
    mapWidth: w,
    mapHeight: h,
    threatGroundAt: (cx, cy) => read(threatGround, cx, cy),
    threatAirAt: (cx, cy) => read(threatAir, cx, cy),
    ownStrengthAt: (cx, cy) => read(ownStrength, cx, cy),
    econAt: (cx, cy) => read(econValue, cx, cy),
    netAt: (cx, cy) => read(ownStrength, cx, cy) - read(threatGround, cx, cy),
    threatAround: (cx, cy, r) => {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) sum += read(threatGround, cx + dx, cy + dy);
      }
      return sum;
    },
    lowestThreatRingCell: (cx, cy, r) => {
      let best: { cx: number; cy: number } | null = null;
      let bestThreat = 0x7fffffff;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          if (x < 0 || x >= w) continue;
          const t = read(threatGround, x, y);
          if (t < bestThreat) {
            bestThreat = t;
            best = { cx: x, cy: y };
          }
        }
      }
      return best;
    },
  };

  cacheState = state;
  cacheTick = state.tick;
  cacheFoeMask = foeMask;
  cacheView = view;
  return view;
}

/** Layer snapshot for a client debug overlay. */
export interface InfluenceSnapshot {
  mapWidth: number;
  mapHeight: number;
  threatGround: Int32Array;
  threatAir: Int32Array;
  ownStrength: Int32Array;
  econValue: Int32Array;
}

/**
 * Copies the current layers of one perspective into fresh arrays (stamp
 * already applied). Debug/overlay only — read-only derived data, never
 * hashed; calling it cannot influence the sim.
 */
export function debugInfluenceSnapshot(state: GameState, playerId: number): InfluenceSnapshot {
  const view = computeInfluence(state, playerId);
  const w = view.mapWidth;
  const h = view.mapHeight;
  const snap: InfluenceSnapshot = {
    mapWidth: w,
    mapHeight: h,
    threatGround: new Int32Array(w * h),
    threatAir: new Int32Array(w * h),
    ownStrength: new Int32Array(w * h),
    econValue: new Int32Array(w * h),
  };
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const i = cy * w + cx;
      snap.threatGround[i] = view.threatGroundAt(cx, cy);
      snap.threatAir[i] = view.threatAirAt(cx, cy);
      snap.ownStrength[i] = view.ownStrengthAt(cx, cy);
      snap.econValue[i] = view.econAt(cx, cy);
    }
  }
  return snap;
}

/** Test/debug hook: drops the memoized view so the next call recomputes. */
export function resetInfluenceCache(): void {
  cacheState = null;
  cacheTick = -1;
  cacheFoeMask = -1;
  cacheView = null;
}
