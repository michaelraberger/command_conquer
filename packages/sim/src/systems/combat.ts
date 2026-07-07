import { facingFromDelta } from '../fixed.js';
import { findPath } from '../path/astar.js';
import { unitRule, type WeaponRule } from '../rules.js';
import {
  aimPoint,
  damageTarget,
  findTarget,
  nearestEnemyBuilding,
  nearestEnemyUnit,
  targetDistSq,
  targetOwner,
  type Target,
} from '../targeting.js';
import type { GameState, Unit } from '../state.js';

/** Chasing units recompute their pursuit path every N ticks (staggered by id). */
const CHASE_REPATH_INTERVAL = 10;

/**
 * Targeting, chasing and firing for units. Runs BEFORE movement each tick so
 * a unit that halts to fire doesn't take a step first.
 */
export function combatSystem(state: GameState): void {
  for (const unit of state.units) {
    if (unit.cooldown > 0) unit.cooldown--;
    const rule = unitRule(unit.type);
    const weapon = rule.weapon;
    if (!weapon) continue;
    const antiInfantryOnly = rule.antiInfantryOnly === true;

    const order = unit.order;
    if (order && order.kind === 'ATTACK') {
      const target = findTarget(state, order.targetId);
      if (!target || targetOwner(target) === unit.owner || !canEngage(antiInfantryOnly, target)) {
        unit.order = null;
        continue;
      }
      engageOrChase(state, unit, target, weapon);
    } else if (order && order.kind === 'ATTACK_MOVE') {
      // March to the ordered cell; fight units first, then structures.
      const target = acquireTarget(state, unit, weapon, antiInfantryOnly);
      if (target) {
        unit.path = null;
        tryFire(state, unit, target, weapon);
      } else if (!unit.path) {
        const cx = unit.cell % state.mapWidth;
        const cy = (unit.cell - cx) / state.mapWidth;
        const dx = cx - order.cx;
        const dy = cy - order.cy;
        if ((dx < 0 ? -dx : dx) <= 1 && (dy < 0 ? -dy : dy) <= 1) {
          unit.order = null;
          continue;
        }
        const path = findPath(state, cx, cy, order.cx, order.cy, {
          avoidUnits: false,
          selfId: unit.id,
        });
        if (!path) {
          unit.order = null;
        } else {
          unit.path = path;
          unit.pathIndex = 0;
        }
      }
    } else if (!unit.path) {
      // Guard stance: idle units return fire at enemy units without moving.
      const target = nearestEnemyUnit(
        state,
        unit.owner,
        unit.x,
        unit.y,
        weapon.rangeSq,
        antiInfantryOnly ? isInfantry : undefined,
      );
      if (target) tryFire(state, unit, { kind: 'unit', unit: target }, weapon);
    }
  }
}

function isInfantry(u: Unit): boolean {
  return unitRule(u.type).category === 'infantry';
}

/** Anti-infantry weapons refuse buildings and non-infantry units. */
function canEngage(antiInfantryOnly: boolean, target: Target): boolean {
  if (!antiInfantryOnly) return true;
  return target.kind === 'unit' && isInfantry(target.unit);
}

/** Units in range first, then enemy structures (walls only via explicit ATTACK). */
function acquireTarget(
  state: GameState,
  unit: Unit,
  weapon: WeaponRule,
  antiInfantryOnly: boolean,
): Target | null {
  const enemyUnit = nearestEnemyUnit(
    state,
    unit.owner,
    unit.x,
    unit.y,
    weapon.rangeSq,
    antiInfantryOnly ? isInfantry : undefined,
  );
  if (enemyUnit) return { kind: 'unit', unit: enemyUnit };
  if (antiInfantryOnly) return null; // dogs never bite buildings
  const building = nearestEnemyBuilding(state, unit.owner, unit.x, unit.y, weapon.rangeSq, false);
  if (building) return { kind: 'building', building };
  return null;
}

function engageOrChase(state: GameState, unit: Unit, target: Target, weapon: WeaponRule): void {
  if (targetDistSq(target, unit.x, unit.y) <= weapon.rangeSq) {
    unit.path = null;
    tryFire(state, unit, target, weapon);
    return;
  }
  // Out of range: (re)path toward the target. The goal cell is occupied by
  // the target itself, so the best-effort path ends next to it.
  if (!unit.path || (state.tick + unit.id) % CHASE_REPATH_INTERVAL === 0) {
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
}

function tryFire(state: GameState, unit: Unit, target: Target, weapon: WeaponRule): void {
  const aim = aimPoint(target, unit.x, unit.y);
  const dx = aim.x - unit.x;
  const dy = aim.y - unit.y;
  if (dx !== 0 || dy !== 0) unit.facing = facingFromDelta(dx, dy);
  if (unit.cooldown > 0) return;
  unit.cooldown = weapon.cooldown;
  state.events.push({ type: 'SHOT', x: unit.x, y: unit.y, tx: aim.x, ty: aim.y, fx: weapon.fx });
  if (weapon.projectileSpeed === 0) {
    damageTarget(state, target, weapon);
  } else {
    state.projectiles.push({
      id: state.nextEntityId++,
      owner: unit.owner,
      srcType: unit.type,
      x: unit.x,
      y: unit.y,
      targetId: target.kind === 'unit' ? target.unit.id : target.building.id,
    });
  }
}
