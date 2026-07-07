import { SUBCELL, distSq } from './fixed.js';
import { WALL_LEVELS, buildingRule, unitRule, type WeaponRule } from './rules.js';
import type { Building, GameState, Unit } from './state.js';

/** Anything a weapon can shoot at. */
export type Target =
  | { kind: 'unit'; unit: Unit }
  | { kind: 'building'; building: Building };

export function buildingMaxHp(building: Building): number {
  if (building.type === 'WALL') return WALL_LEVELS[building.level - 1]!.maxHp;
  return buildingRule(building.type).maxHp;
}

export function findTarget(state: GameState, id: number): Target | null {
  for (const unit of state.units) {
    if (unit.id === id) return unit.hp > 0 ? { kind: 'unit', unit } : null;
  }
  for (const building of state.buildings) {
    if (building.id === id) return building.hp > 0 ? { kind: 'building', building } : null;
  }
  return null;
}

export function targetOwner(target: Target): number {
  return target.kind === 'unit' ? target.unit.owner : target.building.owner;
}

/**
 * Aim point of a target as seen from (fromX, fromY): units use their center,
 * buildings the nearest point of their footprint (so big buildings don't get
 * artificial extra range protection at the corners).
 */
export function aimPoint(target: Target, fromX: number, fromY: number): { x: number; y: number } {
  if (target.kind === 'unit') return { x: target.unit.x, y: target.unit.y };
  const b = target.building;
  const rule = buildingRule(b.type);
  const minX = b.cx * SUBCELL;
  const minY = b.cy * SUBCELL;
  const maxX = (b.cx + rule.width) * SUBCELL;
  const maxY = (b.cy + rule.height) * SUBCELL;
  return {
    x: fromX < minX ? minX : fromX > maxX ? maxX : fromX,
    y: fromY < minY ? minY : fromY > maxY ? maxY : fromY,
  };
}

export function targetDistSq(target: Target, fromX: number, fromY: number): number {
  const p = aimPoint(target, fromX, fromY);
  return distSq(p.x - fromX, p.y - fromY);
}

/** Warhead-vs-armor damage (integer percent math, always at least 1). */
export function damageTarget(state: GameState, target: Target, weapon: WeaponRule): void {
  const armor =
    target.kind === 'unit' ? unitRule(target.unit.type).armor : buildingRule(target.building.type).armor;
  const dmg = Math.trunc((weapon.damage * weapon.vs[armor]) / 100);
  const applied = dmg < 1 ? 1 : dmg;
  if (target.kind === 'unit') {
    target.unit.hp -= applied;
    state.events.push({ type: 'HIT', x: target.unit.x, y: target.unit.y });
  } else {
    target.building.hp -= applied;
    state.events.push({ type: 'HIT', x: target.building.x, y: target.building.y });
  }
}

/**
 * Nearest living enemy unit within rangeSq; ties broken by lower entity id
 * (guaranteed by ascending-id iteration plus strict `<`).
 */
export function nearestEnemyUnit(
  state: GameState,
  owner: number,
  x: number,
  y: number,
  rangeSq: number,
  accept?: (u: Unit) => boolean,
): Unit | null {
  let best: Unit | null = null;
  let bestD = -1;
  for (const other of state.units) {
    if (other.owner === owner || other.hp <= 0) continue;
    if (accept && !accept(other)) continue;
    const d2 = distSq(other.x - x, other.y - y);
    if (d2 <= rangeSq && (best === null || d2 < bestD)) {
      best = other;
      bestD = d2;
    }
  }
  return best;
}

/** Nearest enemy building within rangeSq (footprint distance), walls optional. */
export function nearestEnemyBuilding(
  state: GameState,
  owner: number,
  x: number,
  y: number,
  rangeSq: number,
  includeWalls: boolean,
): Building | null {
  let best: Building | null = null;
  let bestD = -1;
  for (const b of state.buildings) {
    if (b.owner === owner || b.hp <= 0) continue;
    if (!includeWalls && b.type === 'WALL') continue;
    const d2 = targetDistSq({ kind: 'building', building: b }, x, y);
    if (d2 <= rangeSq && (best === null || d2 < bestD)) {
      best = b;
      bestD = d2;
    }
  }
  return best;
}
