import { SUBCELL, facingFromDelta } from '../fixed.js';
import { findPath } from '../path/astar.js';
import {
  areEnemies,
  storageCapacity,
  storedInBuilding,
  type Building,
  type GameState,
  type Unit,
} from '../state.js';
import { buildingRule } from '../rules.js';
import { aimPoint, targetDistSq } from '../targeting.js';

/** Re-path toward a moving/blocked target every N ticks (staggered by id). */
const REPATH_INTERVAL = 10;
/** How close the spy must get to the building footprint to slip inside. */
const REACH = Math.round(1.5 * SUBCELL);
const REACH_SQ = REACH * REACH;

/** The enemy storage building this spy still targets, or null if it's gone. */
function infiltrateTarget(state: GameState, unit: Unit): Building | null {
  const order = unit.order;
  if (!order || order.kind !== 'INFILTRATE') return null;
  const building = state.buildings.find((b) => b.id === order.targetId);
  if (
    !building ||
    !areEnemies(state, unit.owner, building.owner) ||
    (buildingRule(building.type).storage ?? 0) <= 0
  ) {
    return null;
  }
  return building;
}

/**
 * Spies ("Spion"): walk to an enemy storage building, slip inside and steal the
 * ore held there (transferred to the spy's owner, up to their own capacity), and
 * are consumed doing so — the building itself is left standing. Runs BEFORE
 * movement so a spy that reaches its target infiltrates instead of stepping past.
 */
export function spySystem(state: GameState): void {
  const consumed = new Set<number>();

  for (const unit of state.units) {
    if (!unit.order || unit.order.kind !== 'INFILTRATE') continue;
    const building = infiltrateTarget(state, unit);
    if (!building) {
      unit.order = null;
      unit.path = null;
      unit.pathIndex = 0;
      continue;
    }
    const target = { kind: 'building', building } as const;

    if (targetDistSq(target, unit.x, unit.y) <= REACH_SQ) {
      // Rob the building: the ore stored in it leaves the enemy's account and
      // is credited to the spy's owner (overflow past their storage is wasted).
      const enemy = state.players[building.owner];
      const owner = state.players[unit.owner];
      const stolen = storedInBuilding(state, building);
      if (enemy && owner && stolen > 0) {
        enemy.credits = Math.max(0, enemy.credits - stolen);
        const room = Math.max(0, storageCapacity(state, unit.owner) - owner.credits);
        owner.credits += Math.min(stolen, room);
      }
      state.events.push({ type: 'HIT', x: building.x, y: building.y });
      state.events.push({ type: 'DEATH', x: unit.x, y: unit.y, big: false });
      if (state.occupancy[unit.cell] === unit.id) state.occupancy[unit.cell] = 0;
      consumed.add(unit.id);
      continue;
    }

    chaseBuilding(state, unit, target);
  }

  if (consumed.size > 0) {
    state.units = state.units.filter((u) => !consumed.has(u.id));
  }
}

function chaseBuilding(state: GameState, unit: Unit, target: { kind: 'building'; building: Building }): void {
  if (unit.path && (state.tick + unit.id) % REPATH_INTERVAL !== 0) return;
  const cx = unit.cell % state.mapWidth;
  const cy = (unit.cell - cx) / state.mapWidth;
  const goal = aimPoint(target, unit.x, unit.y);
  // Face the building; route to a free cell next to its footprint (buildings
  // block via the structures grid already).
  if (goal.x !== unit.x || goal.y !== unit.y) {
    unit.facing = facingFromDelta(goal.x - unit.x, goal.y - unit.y);
  }
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
