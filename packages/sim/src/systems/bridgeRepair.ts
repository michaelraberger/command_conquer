import { cellCenter, distSq, facingFromDelta } from '../fixed.js';
import { TERRAIN_BRIDGE, TERRAIN_BRIDGE_WRECK, releaseCell } from '../map.js';
import { findPath } from '../path/astar.js';
import { NEUTRAL_OWNER, constructBuilding, type GameState } from '../state.js';
import { REACH_SQ } from './spy.js';

/** Re-path toward the wreck every N ticks (staggered by id). */
const REPATH_INTERVAL = 10;

/**
 * Engineers rebuild collapsed bridge cells: walk up to the wreck, then the
 * cell turns back into TERRAIN_BRIDGE with a fresh neutral span — and the
 * engineer is consumed doing so (classic C&C economics, like capturing).
 * Runs BEFORE movement so an arriving engineer repairs instead of idling.
 */
export function bridgeRepairSystem(state: GameState): void {
  const consumed = new Set<number>();

  for (const unit of state.units) {
    const order = unit.order;
    if (!order || order.kind !== 'REPAIR_BRIDGE') continue;
    const idx = order.cy * state.mapWidth + order.cx;
    // Someone else already rebuilt it (or it never was a wreck): drop the order.
    if (state.terrain[idx] !== TERRAIN_BRIDGE_WRECK) {
      unit.order = null;
      unit.path = null;
      unit.pathIndex = 0;
      continue;
    }

    const tx = cellCenter(order.cx);
    const ty = cellCenter(order.cy);
    if (distSq(tx - unit.x, ty - unit.y) <= REACH_SQ) {
      state.terrain[idx] = TERRAIN_BRIDGE;
      constructBuilding(state, 'BRIDGE', NEUTRAL_OWNER, order.cx, order.cy);
      state.events.push({ type: 'BRIDGE_UP', cx: order.cx, cy: order.cy });
      state.events.push({ type: 'REPAIR', x: tx, y: ty });
      releaseCell(state, unit);
      consumed.add(unit.id);
      continue;
    }

    // Chase the wreck: best-effort pathing stops on the nearest bank/deck cell.
    if (unit.path && (state.tick + unit.id) % REPATH_INTERVAL !== 0) continue;
    unit.facing = facingFromDelta(tx - unit.x, ty - unit.y);
    const cx = unit.cell % state.mapWidth;
    const cy = (unit.cell - cx) / state.mapWidth;
    const path = findPath(state, cx, cy, order.cx, order.cy, {
      avoidUnits: false,
      selfId: unit.id,
      owner: unit.owner,
    });
    if (path) {
      unit.path = path;
      unit.pathIndex = 0;
      unit.blockedTicks = 0;
      unit.repathCount = 0;
    }
  }

  if (consumed.size > 0) {
    state.units = state.units.filter((u) => !consumed.has(u.id));
  }
}
