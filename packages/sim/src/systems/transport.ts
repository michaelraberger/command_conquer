import { SUBCELL, distSq } from '../fixed.js';
import { findPath } from '../path/astar.js';
import { TRANSPORT_CAPACITY, TRANSPORT_REACH } from '../rules.js';
import type { GameState } from '../state.js';

/** Chasing boarders recompute their path every N ticks (staggered by id). */
const CHASE_REPATH_INTERVAL = 10;
const REACH = TRANSPORT_REACH * SUBCELL;
const REACH_SQ = REACH * REACH;

/**
 * Boarding: ground units with a BOARD order walk to the shore next to their
 * transport ship and climb aboard. Aboard units leave state.units (they ride
 * in transport.passengers and sink with the ship); UNLOAD puts them back.
 * Runs before movement so a unit that boards doesn't take a step first.
 */
export function transportSystem(state: GameState): void {
  const boardedIds = new Set<number>();

  for (const unit of state.units) {
    const order = unit.order;
    if (!order || order.kind !== 'BOARD') continue;

    const transport = state.units.find((u) => u.id === order.targetId);
    if (
      !transport ||
      transport.owner !== unit.owner ||
      transport.hp <= 0 ||
      transport.passengers.length >= TRANSPORT_CAPACITY
    ) {
      unit.order = null;
      unit.path = null;
      unit.pathIndex = 0;
      continue;
    }

    if (distSq(transport.x - unit.x, transport.y - unit.y) <= REACH_SQ) {
      if (state.occupancy[unit.cell] === unit.id) state.occupancy[unit.cell] = 0;
      unit.order = null;
      unit.path = null;
      unit.pathIndex = 0;
      unit.blockedTicks = 0;
      unit.repathCount = 0;
      transport.passengers.push(unit);
      boardedIds.add(unit.id);
      continue;
    }

    // Out of reach: (re)path toward the ship — best-effort A* walks the unit
    // to the closest reachable shore cell. A null path means we already stand
    // on it, so keep waiting; the reach check boards us once the ship is near.
    if (!unit.path || (state.tick + unit.id) % CHASE_REPATH_INTERVAL === 0) {
      const w = state.mapWidth;
      const cx = unit.cell % w;
      const cy = (unit.cell - cx) / w;
      const tcx = transport.cell % w;
      const tcy = (transport.cell - tcx) / w;
      const path = findPath(state, cx, cy, tcx, tcy, { avoidUnits: false, selfId: unit.id });
      if (path) {
        unit.path = path;
        unit.pathIndex = 0;
      }
    }
  }

  if (boardedIds.size > 0) {
    state.units = state.units.filter((u) => !boardedIds.has(u.id));
  }
}
