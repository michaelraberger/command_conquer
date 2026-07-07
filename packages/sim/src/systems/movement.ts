import { cellCenter, distSq, facingFromDelta, isqrt } from '../fixed.js';
import { isPassableTerrain } from '../map.js';
import { findPath } from '../path/astar.js';
import { unitRule } from '../rules.js';
import type { GameState, Unit } from '../state.js';

/** Ticks to wait in front of a reserved cell before trying a new path. */
const BLOCKED_TICKS_BEFORE_REPATH = 8;
/** Failed repaths before a unit gives up (classic C&C traffic-jam behavior). */
const MAX_REPATHS = 3;

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
      const occ = state.occupancy[wpIdx]!;
      if (occ !== 0 && occ !== unit.id) {
        handleBlocked(state, unit);
        continue;
      }
      if (!isPassableTerrain(state, wp.cx, wp.cy)) {
        stopUnit(unit);
        continue;
      }
      state.occupancy[unit.cell] = 0;
      state.occupancy[wpIdx] = unit.id;
      unit.cell = wpIdx;
      unit.blockedTicks = 0;
    }

    const wx = cellCenter(wp.cx);
    const wy = cellCenter(wp.cy);
    const dx = wx - unit.x;
    const dy = wy - unit.y;
    if (dx !== 0 || dy !== 0) {
      unit.facing = facingFromDelta(dx, dy);
      const speed = unitRule(unit.type).speed;
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
    const speed = unitRule(unit.type).speed;
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

function handleBlocked(state: GameState, unit: Unit): void {
  unit.blockedTicks++;
  if (unit.blockedTicks < BLOCKED_TICKS_BEFORE_REPATH) return;
  unit.blockedTicks = 0;
  unit.repathCount++;
  if (unit.repathCount > MAX_REPATHS) {
    stopUnit(unit);
    return;
  }
  const goal = unit.path![unit.path!.length - 1]!;
  const cx = unit.cell % state.mapWidth;
  const cy = (unit.cell - cx) / state.mapWidth;
  const newPath = findPath(state, cx, cy, goal.cx, goal.cy, {
    avoidUnits: true,
    selfId: unit.id,
  });
  if (!newPath) {
    stopUnit(unit);
    return;
  }
  unit.path = newPath;
  unit.pathIndex = 0;
}
