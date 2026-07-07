import { SUBCELL, facingFromDelta } from '../fixed.js';
import { findPath } from '../path/astar.js';
import {
  VEHICLE_REPAIR_COST_PER_TICK,
  VEHICLE_REPAIR_HP_PER_TICK,
  VEHICLE_REPAIR_REACH,
} from '../rules.js';
import type { GameState, Unit } from '../state.js';
import { aimPoint, buildingMaxHp, targetDistSq, type Target } from '../targeting.js';

/** Re-path toward a moving-away target every N ticks (staggered by id). */
const REPATH_INTERVAL = 10;
/** Emit a repair sparkle every few ticks (avoids event spam). */
const SPARKLE_INTERVAL = 5;

/**
 * Repair vehicles ("Reparaturfahrzeug"): drive to a damaged own building and
 * restore its hp per tick for a small fee. Runs BEFORE movement so a vehicle
 * that reaches its target stops instead of stepping past. Mirrors the
 * combat chase pattern; buildings can't be entered, so pathing ends adjacent.
 */
export function repairVehicleSystem(state: GameState): void {
  for (const unit of state.units) {
    if (unit.type !== 'REPAIR') continue;
    const order = unit.order;
    if (!order || order.kind !== 'REPAIR_BUILDING') continue;

    const building = state.buildings.find((b) => b.id === order.targetId);
    if (!building || building.owner !== unit.owner || building.hp >= buildingMaxHp(building)) {
      unit.order = null;
      continue;
    }
    const target: Target = { kind: 'building', building };
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
        const max = buildingMaxHp(building);
        const healed = building.hp + VEHICLE_REPAIR_HP_PER_TICK;
        building.hp = healed > max ? max : healed;
        if (state.tick % SPARKLE_INTERVAL === 0) {
          state.events.push({ type: 'REPAIR', x: building.x, y: building.y });
        }
      }
      continue;
    }

    chaseBuilding(state, unit, target);
  }
}

function chaseBuilding(state: GameState, unit: Unit, target: Target): void {
  if (unit.path && (state.tick + unit.id) % REPATH_INTERVAL !== 0) return;
  const cx = unit.cell % state.mapWidth;
  const cy = (unit.cell - cx) / state.mapWidth;
  const goal = aimPoint(target, unit.x, unit.y);
  const path = findPath(state, cx, cy, goal.x >> 8, goal.y >> 8, {
    avoidUnits: false,
    selfId: unit.id,
  });
  if (path) {
    unit.path = path;
    unit.pathIndex = 0;
    unit.blockedTicks = 0;
    unit.repathCount = 0;
  }
}
