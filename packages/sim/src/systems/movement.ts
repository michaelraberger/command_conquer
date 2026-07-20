import { cellCenter, distSq, facingFromDelta, isqrt } from '../fixed.js';
import {
  TERRAIN_ICE,
  cellBlockedFor,
  claimCell,
  isInfantryType,
  isNavigableWater,
  passableFor,
  releaseCell,
  reserveCell,
} from '../map.js';
import { findPath } from '../path/astar.js';
import { unitRule } from '../rules.js';
import { areEnemies, type GameState, type Unit } from '../state.js';
import { isNaval } from '../targeting.js';

/** Ticks to wait in front of a reserved cell before trying a new path. */
const BLOCKED_TICKS_BEFORE_REPATH = 8;
/** Failed repaths before a unit backs off — it never gives up its path. */
const MAX_REPATHS = 3;
/** Backoff after a full repath round: wait this long before the next cycle. */
const REPATH_BACKOFF_TICKS = 30;
/** Blocked ticks before asking blockers to step aside / trying a cell swap. */
const YIELD_AFTER_TICKS = 4;
/** Ground speed multiplier on ice, in 1/256 (154/256 ≈ 60 %). Integer-only. */
const ICE_SPEED_NUM = 154;

/**
 * Wounded units limp (classic Tiberian Dawn): under half hp they move at
 * 75 % speed, under a quarter at 50 %. Applies to everything that moves —
 * infantry, vehicles, ships and aircraft. Integer-only for determinism.
 */
function woundedSpeed(unit: Unit, speed: number): number {
  const maxHp = unitRule(unit.type).maxHp;
  if (unit.hp * 4 <= maxHp) return Math.max(1, speed >> 1);
  if (unit.hp * 2 <= maxHp) return Math.max(1, (speed * 3) >> 2);
  return speed;
}

/** Fixed probe order for sidesteps — deterministic across runs. */
const SIDESTEP_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
];

/**
 * Cell-reservation movement: a unit occupies exactly one cell (the one it has
 * reserved) and only starts moving into the next path cell once it owns it.
 * Units therefore always come to rest on cell centers.
 */
export function movementSystem(state: GameState): void {
  const w = state.mapWidth;
  for (const unit of state.units) {
    if (!unit.path) continue;
    if (unitRule(unit.type).air === true) {
      flyAir(state, unit);
      continue;
    }
    const wp = unit.path[unit.pathIndex];
    if (!wp) {
      stopUnit(unit);
      continue;
    }
    const wpIdx = wp.cy * w + wp.cx;

    if (unit.cell !== wpIdx) {
      // Not yet reserved: claim the waypoint cell or wait/repath.
      if (cellBlockedFor(state, unit, wpIdx)) {
        handleBlocked(state, unit);
        continue;
      }
      const traversable = isNaval(unit)
        ? isNavigableWater(state, wp.cx, wp.cy)
        : passableFor(state, wp.cx, wp.cy, unit.owner);
      if (!traversable) {
        stopUnit(unit);
        continue;
      }
      claimCell(state, unit, wpIdx);
      unit.blockedTicks = 0;
    }

    const wx = cellCenter(wp.cx);
    const wy = cellCenter(wp.cy);
    const dx = wx - unit.x;
    const dy = wy - unit.y;
    if (dx !== 0 || dy !== 0) {
      unit.facing = facingFromDelta(dx, dy);
      let speed = woundedSpeed(unit, unitRule(unit.type).speed);
      // On ice ground units slip: 60 % speed. unit.cell is the reserved
      // waypoint cell, so entering ice already slows the unit down.
      if (state.terrain[unit.cell] === TERRAIN_ICE) {
        speed = Math.max(1, (speed * ICE_SPEED_NUM) >> 8);
      }
      const dist = isqrt(distSq(dx, dy));
      if (dist <= speed) {
        unit.x = wx;
        unit.y = wy;
      } else {
        unit.x += Math.trunc((dx * speed) / dist);
        unit.y += Math.trunc((dy * speed) / dist);
      }
    }

    if (unit.x === wx && unit.y === wy) {
      unit.pathIndex++;
      if (unit.pathIndex >= unit.path.length) stopUnit(unit);
    }
  }
}

function stopUnit(unit: Unit): void {
  unit.path = null;
  unit.pathIndex = 0;
  unit.blockedTicks = 0;
  unit.repathCount = 0;
}

/**
 * Free flight: aircraft ignore terrain, occupancy and pathfinding. They steer
 * straight at their destination cell (the last waypoint) and never reserve a
 * ground cell — `unit.cell` is only kept current for fog/sight.
 */
function flyAir(state: GameState, unit: Unit): void {
  const dest = unit.path![unit.path!.length - 1]!;
  const wx = cellCenter(dest.cx);
  const wy = cellCenter(dest.cy);
  const dx = wx - unit.x;
  const dy = wy - unit.y;
  if (dx !== 0 || dy !== 0) {
    unit.facing = facingFromDelta(dx, dy);
    const speed = woundedSpeed(unit, unitRule(unit.type).speed);
    const dist = isqrt(distSq(dx, dy));
    if (dist <= speed) {
      unit.x = wx;
      unit.y = wy;
    } else {
      unit.x += Math.trunc((dx * speed) / dist);
      unit.y += Math.trunc((dy * speed) / dist);
    }
  }
  unit.cell = (unit.y >> 8) * state.mapWidth + (unit.x >> 8);
  if (unit.x === wx && unit.y === wy) stopUnit(unit);
}

/**
 * Anti-jam escalation for a unit whose next cell is reserved by someone else:
 * ask friendly idlers to step aside (or swap cells head-on), then repath, and
 * after a fruitless repath round back off and start over — a unit NEVER
 * abandons its path because of traffic.
 */
function handleBlocked(state: GameState, unit: Unit): void {
  unit.blockedTicks++;
  if (unit.blockedTicks === YIELD_AFTER_TICKS) {
    if (trySwap(state, unit)) return;
    yieldBlockers(state, unit);
    return;
  }
  if (unit.blockedTicks < BLOCKED_TICKS_BEFORE_REPATH) return;
  unit.blockedTicks = 0;
  unit.repathCount++;
  if (unit.repathCount > MAX_REPATHS) {
    // Never give up: keep path and intent, wait out the jam, try again.
    unit.repathCount = 0;
    unit.blockedTicks = -REPATH_BACKOFF_TICKS;
    return;
  }
  const goal = unit.path![unit.path!.length - 1]!;
  const cx = unit.cell % state.mapWidth;
  const cy = (unit.cell - cx) / state.mapWidth;
  const newPath = findPath(state, cx, cy, goal.cx, goal.cy, {
    avoidUnits: true,
    selfId: unit.id,
    owner: unit.owner,
    water: isNaval(unit),
    infantry: isInfantryType(unit.type),
  });
  if (!newPath) {
    // Fully enclosed right now — back off instead of giving up.
    unit.blockedTicks = -REPATH_BACKOFF_TICKS;
    return;
  }
  unit.path = newPath;
  unit.pathIndex = 0;
}

/** Ground units booked on `idx`: the vehicle by id, or every pack member. */
function blockersAt(state: GameState, idx: number): Unit[] {
  const occ = state.occupancy[idx]!;
  if (occ > 0) {
    const u = state.units.find((x) => x.id === occ);
    return u ? [u] : [];
  }
  if (occ < 0) {
    return state.units.filter((x) => x.cell === idx && unitRule(x.type).air !== true);
  }
  return [];
}

/**
 * Head-on deadlock (1-wide corridor): the blocker's next waypoint is OUR
 * cell. Swap the two bookings atomically; both units then glide through each
 * other to their waypoints — the classic RTS resolution.
 */
function trySwap(state: GameState, unit: Unit): boolean {
  const wp = unit.path![unit.pathIndex]!;
  const wpIdx = wp.cy * state.mapWidth + wp.cx;
  for (const b of blockersAt(state, wpIdx)) {
    if (areEnemies(state, unit.owner, b.owner)) continue;
    if (!b.path) continue;
    const bwp = b.path[b.pathIndex];
    if (!bwp) continue;
    if (bwp.cy * state.mapWidth + bwp.cx !== unit.cell) continue;
    const myCell = unit.cell;
    // Release both bookings, then check the crossed cells actually fit
    // (a vehicle cannot take over a cell that still holds infantry).
    releaseCell(state, unit);
    releaseCell(state, b);
    if (cellBlockedFor(state, unit, wpIdx) || cellBlockedFor(state, b, myCell)) {
      reserveCell(state, unit, myCell);
      reserveCell(state, b, wpIdx);
      continue;
    }
    reserveCell(state, unit, wpIdx);
    reserveCell(state, b, myCell);
    unit.blockedTicks = 0;
    unit.repathCount = 0;
    b.blockedTicks = 0;
    b.repathCount = 0;
    return true;
  }
  return false;
}

/**
 * Asks idle friendly blockers to sidestep one cell so the jammed unit can
 * pass. Units with any order — HOLD above all — never budge; neither does
 * anything already moving.
 */
function yieldBlockers(state: GameState, unit: Unit): void {
  const wp = unit.path![unit.pathIndex]!;
  const wpIdx = wp.cy * state.mapWidth + wp.cx;
  for (const b of blockersAt(state, wpIdx)) {
    if (b.order !== null || b.path !== null) continue;
    if (areEnemies(state, unit.owner, b.owner)) continue;
    const bcx = b.cell % state.mapWidth;
    const bcy = (b.cell - bcx) / state.mapWidth;
    for (const d of SIDESTEP_DIRS) {
      const nx = bcx + d.dx;
      const ny = bcy + d.dy;
      const nIdx = ny * state.mapWidth + nx;
      if (nIdx === unit.cell) continue; // never step into the asker
      const traversable = isNaval(b)
        ? isNavigableWater(state, nx, ny)
        : passableFor(state, nx, ny, b.owner);
      if (!traversable) continue;
      if (cellBlockedFor(state, b, nIdx)) continue;
      b.path = [{ cx: nx, cy: ny }];
      b.pathIndex = 0;
      break;
    }
  }
}
