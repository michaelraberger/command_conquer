import { SUBCELL, distSq } from './fixed.js';
import { WALL_LEVELS, buildingRule, unitRule, type WeaponRule } from './rules.js';
import { areEnemies, type Building, type GameState, type Unit } from './state.js';

/** Is this unit an aircraft (flies, only hit by anti-air weapons)? */
export function isAir(unit: Unit): boolean {
  return unitRule(unit.type).air === true;
}

/** Is this unit a ship (sails water, produced by the shipyard)? */
export function isNaval(unit: Unit): boolean {
  return unitRule(unit.type).category === 'naval';
}

/** Submerged submarine: only antiSub weapons (torpedoes/depth charges) hit it. */
export function isSubmerged(unit: Unit): boolean {
  return unitRule(unit.type).submerged === true;
}

/** Unit-layer predicate for a weapon: which units it may engage. */
export function weaponAcceptsUnit(weapon: WeaponRule): (u: Unit) => boolean {
  return (u) => {
    if (isAir(u)) return weapon.targets !== 'ground';
    if (weapon.targets === 'air') return false;
    if (isSubmerged(u)) return weapon.antiSub;
    return true;
  };
}

/** Ground weapons and both-target weapons may hit buildings; air-only cannot. */
export function weaponHitsBuildings(weapon: WeaponRule): boolean {
  return weapon.targets !== 'air';
}

/**
 * Walls give cover: true when a WALL/GATE cell lies strictly between the two
 * points, so direct fire cannot cross it. The shooter's own cell and the
 * target's footprint (`ignoreId`, e.g. when the wall itself is the target) do
 * not block. Integer sampling at half-cell steps — deterministic by design.
 */
export function losBlockedByWall(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ignoreId = 0,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  const longest = adx > ady ? adx : ady;
  const steps = Math.trunc((2 * longest) / SUBCELL) + 1; // ~half-cell sampling
  const fromCell = Math.trunc(y0 / SUBCELL) * state.mapWidth + Math.trunc(x0 / SUBCELL);
  const toCell = Math.trunc(y1 / SUBCELL) * state.mapWidth + Math.trunc(x1 / SUBCELL);
  for (let i = 1; i < steps; i++) {
    const sx = x0 + Math.trunc((dx * i) / steps);
    const sy = y0 + Math.trunc((dy * i) / steps);
    const cell = Math.trunc(sy / SUBCELL) * state.mapWidth + Math.trunc(sx / SUBCELL);
    if (cell === fromCell || cell === toCell) continue;
    const id = state.structures[cell]!;
    if (id === 0 || id === ignoreId) continue;
    const b = state.buildings.find((s) => s.id === id);
    if (b && (b.type === 'WALL' || b.type === 'GATE')) return true;
  }
  return false;
}

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
    if (other.hp <= 0 || !areEnemies(state, owner, other.owner)) continue;
    const d2 = distSq(other.x - x, other.y - y);
    if (d2 > rangeSq || (best !== null && d2 >= bestD)) continue;
    // Distance first — accept may run a (pricier) line-of-sight walk.
    if (accept && !accept(other)) continue;
    best = other;
    bestD = d2;
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
  accept?: (b: Building) => boolean,
): Building | null {
  let best: Building | null = null;
  let bestD = -1;
  for (const b of state.buildings) {
    if (b.hp <= 0 || !areEnemies(state, owner, b.owner)) continue;
    if (!includeWalls && b.type === 'WALL') continue;
    const d2 = targetDistSq({ kind: 'building', building: b }, x, y);
    if (d2 > rangeSq || (best !== null && d2 >= bestD)) continue;
    // Distance first — accept may run a (pricier) line-of-sight walk.
    if (accept && !accept(b)) continue;
    best = b;
    bestD = d2;
  }
  return best;
}
