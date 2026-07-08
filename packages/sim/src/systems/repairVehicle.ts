import { SUBCELL, facingFromDelta } from '../fixed.js';
import { findPath } from '../path/astar.js';
import {
  VEHICLE_REPAIR_COST_PER_TICK,
  VEHICLE_REPAIR_HP_PER_TICK,
  VEHICLE_REPAIR_REACH,
  unitRule,
} from '../rules.js';
import type { GameState, Unit } from '../state.js';
import { aimPoint, buildingMaxHp, targetDistSq, type Target } from '../targeting.js';

/** Re-path toward a moving-away target every N ticks (staggered by id). */
const REPATH_INTERVAL = 10;
/** Emit a repair sparkle every few ticks (avoids event spam). */
const SPARKLE_INTERVAL = 5;

/** Resolves a repair order to its live target + hp, or null if it's finished. */
function repairTarget(
  state: GameState,
  unit: Unit,
): { target: Target; maxHp: number; hp: number } | null {
  const order = unit.order;
  if (!order) return null;
  if (order.kind === 'REPAIR_BUILDING') {
    const building = state.buildings.find((b) => b.id === order.targetId);
    if (!building || building.owner !== unit.owner) return null;
    return { target: { kind: 'building', building }, maxHp: buildingMaxHp(building), hp: building.hp };
  }
  if (order.kind === 'REPAIR_UNIT') {
    const other = state.units.find((u) => u.id === order.targetId);
    if (!other || other.owner !== unit.owner || other.id === unit.id) return null;
    return { target: { kind: 'unit', unit: other }, maxHp: unitRule(other.type).maxHp, hp: other.hp };
  }
  return null;
}

/**
 * Repair vehicles ("Reparaturfahrzeug"): drive to a damaged own building OR own
 * unit (vehicles, infantry, …) and restore its hp per tick for a small fee.
 * Runs BEFORE movement so a vehicle that reaches its target stops instead of
 * stepping past. Mirrors the combat chase pattern; pathing ends adjacent.
 */
export function repairVehicleSystem(state: GameState): void {
  for (const unit of state.units) {
    if (unit.type !== 'REPAIR') continue;
    if (!unit.order || (unit.order.kind !== 'REPAIR_BUILDING' && unit.order.kind !== 'REPAIR_UNIT')) {
      continue;
    }
    const resolved = repairTarget(state, unit);
    if (!resolved || resolved.hp >= resolved.maxHp) {
      unit.order = null;
      continue;
    }
    const { target, maxHp } = resolved;
    const reach = VEHICLE_REPAIR_REACH * SUBCELL;

    if (targetDistSq(target, unit.x, unit.y) <= reach * reach) {
      unit.path = null;
      const aim = aimPoint(target, unit.x, unit.y);
      if (aim.x !== unit.x || aim.y !== unit.y) {
        unit.facing = facingFromDelta(aim.x - unit.x, aim.y - unit.y);
      }
      const player = state.players.find((p) => p.id === unit.owner);
      if (player && player.credits >= VEHICLE_REPAIR_COST_PER_TICK) {
        player.credits -= VEHICLE_REPAIR_COST_PER_TICK;
        const healed = Math.min(maxHp, resolved.hp + VEHICLE_REPAIR_HP_PER_TICK);
        if (target.kind === 'building') target.building.hp = healed;
        else target.unit.hp = healed;
        if (state.tick % SPARKLE_INTERVAL === 0) {
          state.events.push({ type: 'REPAIR', x: aim.x, y: aim.y });
        }
      }
      continue;
    }

    chaseTarget(state, unit, target);
  }
}

function chaseTarget(state: GameState, unit: Unit, target: Target): void {
  if (unit.path && (state.tick + unit.id) % REPATH_INTERVAL !== 0) return;
  const cx = unit.cell % state.mapWidth;
  const cy = (unit.cell - cx) / state.mapWidth;
  const goal = aimPoint(target, unit.x, unit.y);
  const path = findPath(state, cx, cy, goal.x >> 8, goal.y >> 8, {
    // A unit sits ON its target cell, so route to a free adjacent cell (and
    // stop centered there, in reach). Buildings block via structures already.
    avoidUnits: target.kind === 'unit',
    selfId: unit.id,
  });
  if (path) {
    unit.path = path;
    unit.pathIndex = 0;
    unit.blockedTicks = 0;
    unit.repathCount = 0;
  }
}
