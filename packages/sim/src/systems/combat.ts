import { SUBCELL, distSq, facingFromDelta } from '../fixed.js';
import { findPath } from '../path/astar.js';
import { buildingRule, unitRule, type UnitRule, type WeaponRule } from '../rules.js';
import {
  aggroKindOfType,
  aimPoint,
  damageTarget,
  findTarget,
  isAir,
  isNaval,
  losBlockedByWall,
  nearestEnemyBuilding,
  nearestEnemyUnit,
  targetDistSq,
  targetOwner,
  weaponAcceptsUnit,
  weaponHitsBuildings,
  type Target,
} from '../targeting.js';
import type { Building, GameState, Unit } from '../state.js';

/** Chasing units recompute their pursuit path every N ticks (staggered by id). */
const CHASE_REPATH_INTERVAL = 10;
/** Idle units auto-defend: they step toward an enemy within this radius (cells). */
const GUARD_RADIUS = 8;
const GUARD_RANGE_SQ = (GUARD_RADIUS * SUBCELL) ** 2;
/** An escort closes up once its ward is more than this far ahead. */
const FOLLOW_GAP = Math.round(2.5 * SUBCELL);
const FOLLOW_GAP_SQ = FOLLOW_GAP * FOLLOW_GAP;

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

    // Combat aircraft with empty racks break off: drop the order and head
    // home to rearm (airbaseSystem flies idle planes back to the pad).
    // Exception: a helicopter ordered to HOLD, PATROL or ESCORT keeps
    // station even when dry — the player decides when it goes home to rearm.
    if (rule.ammo !== undefined && unit.ammo <= 0) {
      const keeps =
        unit.order?.kind === 'HOLD' ||
        unit.order?.kind === 'PATROL' ||
        unit.order?.kind === 'ESCORT';
      if (unit.order !== null && !keeps) {
        unit.order = null;
        unit.path = null;
        unit.pathIndex = 0;
      }
      if (!keeps) continue;
      if (unit.order?.kind === 'HOLD') continue; // hold, but nothing to shoot with
    }

    const order = unit.order;
    if (order && order.kind === 'ATTACK') {
      const target = findTarget(state, order.targetId);
      if (!target || targetOwner(target) === unit.owner || !canEngage(weapon, rule, target)) {
        unit.order = null;
        continue;
      }
      engageOrChase(state, unit, target, weapon);
    } else if (order && order.kind === 'ATTACK_MOVE') {
      // March to the ordered cell; fight units first, then structures.
      const target = acquireTarget(state, unit, weapon, rule);
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
        if (isAir(unit)) {
          unit.path = [{ cx: order.cx, cy: order.cy }];
          unit.pathIndex = 0;
          continue;
        }
        const path = findPath(state, cx, cy, order.cx, order.cy, {
          avoidUnits: false,
          selfId: unit.id,
          owner: unit.owner,
          water: isNaval(unit),
        });
        if (!path) {
          unit.order = null;
        } else {
          unit.path = path;
          unit.pathIndex = 0;
        }
      }
    } else if (order && order.kind === 'HOLD') {
      // Stand fast: fire at whatever comes into range, never move — not even
      // when the base alarm rallies everyone else (order shields the unit).
      const accept = unitAccept(weapon, rule);
      const inRange = nearestThreatUnit(state, unit, weapon, weapon.rangeSq, accept);
      if (inRange) tryFire(state, unit, { kind: 'unit', unit: inRange }, weapon);
    } else if (order && order.kind === 'PATROL') {
      // Fight like an attack-move, but on reaching a leg point turn around
      // instead of going idle — the round trip repeats until reordered.
      const target = acquireTarget(state, unit, weapon, rule);
      if (target) {
        unit.path = null;
        tryFire(state, unit, target, weapon);
      } else if (!unit.path) {
        const cx = unit.cell % state.mapWidth;
        const cy = (unit.cell - cx) / state.mapWidth;
        const [gx, gy] = order.leg === 1 ? [order.bx, order.by] : [order.ax, order.ay];
        const dx = cx - gx;
        const dy = cy - gy;
        if ((dx < 0 ? -dx : dx) <= 1 && (dy < 0 ? -dy : dy) <= 1) {
          order.leg = order.leg === 1 ? 0 : 1; // arrived — walk back
          continue;
        }
        if (isAir(unit)) {
          unit.path = [{ cx: gx, cy: gy }];
          unit.pathIndex = 0;
          continue;
        }
        const path = findPath(state, cx, cy, gx, gy, {
          avoidUnits: false,
          selfId: unit.id,
          owner: unit.owner,
          water: isNaval(unit),
        });
        if (!path) {
          unit.order = null; // leg unreachable — fall back to guard stance
        } else {
          unit.path = path;
          unit.pathIndex = 0;
        }
      }
    } else if (order && order.kind === 'ESCORT') {
      // Stick with the ward: halt to fight anything in range, otherwise close
      // up whenever the ward pulls more than a couple of cells ahead.
      const ward = state.units.find((u) => u.id === order.targetId);
      if (!ward) {
        unit.order = null;
        unit.path = null;
        unit.pathIndex = 0;
        continue;
      }
      const target = acquireTarget(state, unit, weapon, rule);
      if (target) {
        unit.path = null;
        tryFire(state, unit, target, weapon);
      } else {
        const gap = distSq(ward.x - unit.x, ward.y - unit.y);
        if (gap <= FOLLOW_GAP_SQ) {
          unit.path = null; // close enough — hold formation
        } else if (!unit.path || (state.tick + unit.id) % CHASE_REPATH_INTERVAL === 0) {
          const wcx = ward.cell % state.mapWidth;
          const wcy = (ward.cell - wcx) / state.mapWidth;
          if (isAir(unit)) {
            // Escorting helicopters fly straight after the ward.
            unit.path = [{ cx: wcx, cy: wcy }];
            unit.pathIndex = 0;
            continue;
          }
          const cx = unit.cell % state.mapWidth;
          const cy = (unit.cell - cx) / state.mapWidth;
          const path = findPath(state, cx, cy, wcx, wcy, {
            avoidUnits: false,
            selfId: unit.id,
            owner: unit.owner,
            water: isNaval(unit),
          });
          if (path) {
            unit.path = path;
            unit.pathIndex = 0;
            unit.blockedTicks = 0;
            unit.repathCount = 0;
          }
        }
      }
    } else if (!unit.path) {
      // Guard stance: idle units fire at any enemy in range (armed enemies
      // before harvesters etc.), and otherwise step toward a nearby attacker
      // just out of range — so units near a fight automatically move in to
      // defend instead of standing idle.
      const accept = unitAccept(weapon, rule);
      const inRange = nearestThreatUnit(state, unit, weapon, weapon.rangeSq, accept);
      if (inRange) {
        tryFire(state, unit, { kind: 'unit', unit: inRange }, weapon);
      } else {
        const near = nearestThreatUnit(state, unit, weapon, GUARD_RANGE_SQ, accept);
        if (near) {
          // Attack-move toward the attacker's cell; self-limiting because the
          // unit re-evaluates once it arrives (no endless cross-map chase).
          unit.order = {
            kind: 'ATTACK_MOVE',
            cx: near.cell % state.mapWidth,
            cy: Math.floor(near.cell / state.mapWidth),
          };
        }
      }
    }
  }
}

function isInfantry(u: Unit): boolean {
  return unitRule(u.type).category === 'infantry';
}

/** Combined unit-target filter: weapon layer + anti-infantry/naval-only. */
function unitAccept(weapon: WeaponRule, rule: UnitRule): (u: Unit) => boolean {
  const byLayer = weaponAcceptsUnit(weapon);
  if (rule.antiInfantryOnly === true) return (u) => byLayer(u) && isInfantry(u);
  if (rule.navalOnly === true) return (u) => byLayer(u) && isNaval(u);
  return byLayer;
}

/** Threat filter: armed units soak auto-acquired fire before harvesters etc. */
function isArmedUnit(u: Unit): boolean {
  return unitRule(u.type).weapon !== null;
}

/**
 * Walls give cover: direct fire may not cross an ENEMY WALL/GATE cell — own
 * and allied walls never block (defenders fire out over their ring, attackers
 * cannot shoot in). Arcing weapons (Artillerie, V3) lob over the top, aircraft
 * shoot from above, and shots at aircraft fly over the wall too. Base-defense
 * towers are exempt in defenseSystem (they are tall) — this check is for
 * units only.
 */
function losClear(state: GameState, unit: Unit, weapon: WeaponRule, target: Target): boolean {
  if (weapon.arcing === true || isAir(unit)) return true;
  if (target.kind === 'unit' && isAir(target.unit)) return true;
  const aim = aimPoint(target, unit.x, unit.y);
  const ignoreId = target.kind === 'building' ? target.building.id : 0;
  return !losBlockedByWall(state, unit.x, unit.y, aim.x, aim.y, ignoreId, unit.owner);
}

/**
 * Auto-acquisition prefers threats over bystanders: armed enemies within range
 * first, then a defense building actively covering the area, and only then
 * unarmed units (harvesters, MCVs, spies) and passive structures. Explicit
 * ATTACK orders bypass this — what the player clicks is what gets shot.
 */
function nearestThreatUnit(
  state: GameState,
  unit: Unit,
  weapon: WeaponRule,
  rangeSq: number,
  accept: (u: Unit) => boolean,
): Unit | null {
  const clear = (u: Unit): boolean => losClear(state, unit, weapon, { kind: 'unit', unit: u });
  return (
    nearestEnemyUnit(
      state,
      unit.owner,
      unit.x,
      unit.y,
      rangeSq,
      (u) => accept(u) && isArmedUnit(u) && clear(u),
    ) ?? nearestEnemyUnit(state, unit.owner, unit.x, unit.y, rangeSq, (u) => accept(u) && clear(u))
  );
}

/** Whether this weapon may engage the given target at all. */
function canEngage(weapon: WeaponRule, rule: UnitRule, target: Target): boolean {
  if (target.kind === 'building') {
    return weaponHitsBuildings(weapon) && rule.antiInfantryOnly !== true && rule.navalOnly !== true;
  }
  return unitAccept(weapon, rule)(target.unit);
}

/**
 * Auto-acquisition by threat: armed enemy units first, then defense buildings,
 * then unarmed units (harvesters etc.), then passive structures. Targets with
 * a wall in the line of fire are skipped; as a last resort the nearest enemy
 * wall/gate in range is attacked, so a breaching force chews through the wall
 * instead of idling in front of it.
 */
function acquireTarget(
  state: GameState,
  unit: Unit,
  weapon: WeaponRule,
  rule: UnitRule,
): Target | null {
  const accept = unitAccept(weapon, rule);
  const clearU = (u: Unit): boolean => losClear(state, unit, weapon, { kind: 'unit', unit: u });
  const clearB = (b: Building): boolean =>
    losClear(state, unit, weapon, { kind: 'building', building: b });

  const armed = nearestEnemyUnit(
    state,
    unit.owner,
    unit.x,
    unit.y,
    weapon.rangeSq,
    (u) => accept(u) && isArmedUnit(u) && clearU(u),
  );
  if (armed) return { kind: 'unit', unit: armed };

  const hitsBuildings =
    rule.antiInfantryOnly !== true && rule.navalOnly !== true && weaponHitsBuildings(weapon);
  if (hitsBuildings) {
    const defense = nearestEnemyBuilding(
      state,
      unit.owner,
      unit.x,
      unit.y,
      weapon.rangeSq,
      false,
      (b) => buildingRule(b.type).weapon !== null && clearB(b),
    );
    if (defense) return { kind: 'building', building: defense };
  }

  const bystander = nearestEnemyUnit(
    state,
    unit.owner,
    unit.x,
    unit.y,
    weapon.rangeSq,
    (u) => accept(u) && clearU(u),
  );
  if (bystander) return { kind: 'unit', unit: bystander };
  if (!hitsBuildings) return null;
  const building = nearestEnemyBuilding(
    state,
    unit.owner,
    unit.x,
    unit.y,
    weapon.rangeSq,
    false,
    clearB,
  );
  if (building) return { kind: 'building', building };
  // Everything worth shooting is behind a wall — breach the wall itself.
  const wall = nearestEnemyBuilding(
    state,
    unit.owner,
    unit.x,
    unit.y,
    weapon.rangeSq,
    true,
    (b) => (b.type === 'WALL' || b.type === 'GATE') && clearB(b),
  );
  if (wall) return { kind: 'building', building: wall };
  return null;
}

function engageOrChase(state: GameState, unit: Unit, target: Target, weapon: WeaponRule): void {
  // A wall in the line of fire blocks the shot (losClear) — treated like being
  // out of range, the unit closes in instead. Target the wall to breach it.
  if (targetDistSq(target, unit.x, unit.y) <= weapon.rangeSq && losClear(state, unit, weapon, target)) {
    unit.path = null;
    tryFire(state, unit, target, weapon);
    return;
  }
  // Out of range: (re)path toward the target.
  if (!unit.path || (state.tick + unit.id) % CHASE_REPATH_INTERVAL === 0) {
    const goal = aimPoint(target, unit.x, unit.y);
    const gcx = goal.x >> 8;
    const gcy = goal.y >> 8;
    if (isAir(unit)) {
      // Aircraft fly straight at the target, ignoring terrain.
      unit.path = [{ cx: gcx, cy: gcy }];
      unit.pathIndex = 0;
      return;
    }
    const cx = unit.cell % state.mapWidth;
    const cy = (unit.cell - cx) / state.mapWidth;
    const path = findPath(state, cx, cy, gcx, gcy, {
      avoidUnits: false,
      selfId: unit.id,
      owner: unit.owner,
      water: isNaval(unit),
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
  // Empty racks never fire (a dry patrol helicopter keeps pacing instead).
  if (unitRule(unit.type).ammo !== undefined && unit.ammo <= 0) return;
  const aim = aimPoint(target, unit.x, unit.y);
  const dx = aim.x - unit.x;
  const dy = aim.y - unit.y;
  if (dx !== 0 || dy !== 0) unit.facing = facingFromDelta(dx, dy);
  if (unit.cooldown > 0) return;
  unit.cooldown = weapon.cooldown;
  // Combat aircraft burn a rack per shot; empty planes break off next tick.
  if (unitRule(unit.type).ammo !== undefined) unit.ammo--;
  state.events.push({ type: 'SHOT', x: unit.x, y: unit.y, tx: aim.x, ty: aim.y, fx: weapon.fx });
  if (weapon.projectileSpeed === 0) {
    damageTarget(
      state,
      target,
      weapon,
      { x: unit.x, y: unit.y, kind: aggroKindOfType(unit.type) },
      unit, // veterancy: damage bonus + kill credit
    );
  } else {
    state.projectiles.push({
      id: state.nextEntityId++,
      owner: unit.owner,
      srcType: unit.type,
      x: unit.x,
      y: unit.y,
      targetId: target.kind === 'unit' ? target.unit.id : target.building.id,
      sx: unit.x,
      sy: unit.y,
      srcId: unit.id, // veterancy credit resolves on impact
    });
  }
}
