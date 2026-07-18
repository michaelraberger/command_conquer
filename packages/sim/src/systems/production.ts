import { cellsAroundRect, isNavigableWater, isPassableTerrain, cellIndex, inBounds } from '../map.js';
import { findPath } from '../path/astar.js';
import {
  availableToFaction,
  buildingRule,
  isBuildingType,
  isTechId,
  isUnitType,
  satisfiesRequirement,
  techRule,
  unitRule,
  MOTHERLOAD_CREDITS,
  MOTHERLOAD_POWER,
  type ProductionCategory,
} from '../rules.js';
import { constructBuilding, spawnUnit, type GameState, type Player } from '../state.js';
import { findFreeAirfield } from './airbase.js';
import { canPlaceBuilding } from './placement.js';

/** Net power balance for a player (produced minus consumed + cheat bonus). */
export function powerBalance(state: GameState, playerId: number): { produced: number; used: number } {
  const player = state.players.find((p) => p.id === playerId);
  let produced = player?.powerBonus ?? 0;
  if (player?.motherload) produced += MOTHERLOAD_POWER; // cheat: unlimited energy
  let used = 0;
  for (const b of state.buildings) {
    if (b.owner !== playerId) continue;
    const p = buildingRule(b.type).power;
    if (p >= 0) produced += p;
    else used -= p;
  }
  return { produced, used };
}

function prereqsMet(state: GameState, playerId: number, requires: readonly string[]): boolean {
  // satisfiesRequirement: upgraded buildings still count as their base type.
  return requires.every((req) =>
    state.buildings.some((b) => b.owner === playerId && satisfiesRequirement(b.type, req)),
  );
}

/** Total credits paid for `progress` of `buildTime` ticks at `cost`. */
function paidUpTo(cost: number, buildTime: number, progress: number): number {
  return Math.trunc((cost * progress) / buildTime);
}

function categoryOf(item: string): ProductionCategory | null {
  if (isBuildingType(item)) return 'building';
  if (isUnitType(item)) return unitRule(item).category;
  return null;
}

function costTimeOf(item: string): { cost: number; buildTime: number } {
  if (isBuildingType(item)) return buildingRule(item);
  if (isUnitType(item)) return unitRule(item);
  throw new Error(`unknown production item ${item}`);
}

export function startProduction(state: GameState, playerId: number, item: string): void {
  const player = state.players.find((p) => p.id === playerId);
  const category = categoryOf(item);
  if (!player || !category) return;
  const queue = player.queues[category];
  if (queue.item !== null || queue.ready) return;
  const rule = isBuildingType(item) ? buildingRule(item) : isUnitType(item) ? unitRule(item) : null;
  if (rule === null) return;
  if (isBuildingType(item) && !buildingRule(item).buildable) return;
  // Unique buildings (iron curtain): at most one standing instance per player.
  if (
    isBuildingType(item) &&
    buildingRule(item).unique === true &&
    state.buildings.some((b) => b.owner === playerId && b.type === item)
  ) {
    return;
  }
  if (!availableToFaction(rule.factions, player.faction)) return;
  // One jet per Flugfeld — physical capacity, not tech, so it binds even
  // under the motherload cheat.
  if (isUnitType(item) && unitRule(item).airfieldBound === true && findFreeAirfield(state, playerId) === null) {
    return;
  }
  // Motherload cheat unlocks everything of the faction — skip prereq/tech gates.
  if (!player.motherload) {
    if (!prereqsMet(state, playerId, rule.requires)) return;
    // Tech gate: advanced items need their technology researched first.
    if (rule.tech !== undefined && !player.researched.includes(rule.tech)) return;
  }
  queue.item = item;
  queue.progress = 0;
}

/** Begin researching a technology at a Techzentrum (one at a time per player). */
export function startResearch(state: GameState, playerId: number, tech: string): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !isTechId(tech)) return;
  if (player.research !== null || player.researched.includes(tech)) return;
  const rule = techRule(tech);
  if (!availableToFaction(rule.factions, player.faction)) return;
  if (!prereqsMet(state, playerId, rule.requires)) return; // needs a Techzentrum
  player.research = { tech, progress: 0 };
}

/** Abort the active research and refund what was paid so far. */
export function cancelResearch(state: GameState, playerId: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.research === null) return;
  const rule = techRule(player.research.tech);
  player.credits += paidUpTo(rule.cost, rule.time, player.research.progress);
  player.research = null;
}

/**
 * Advances the active research: credits drain gradually over the research time
 * (same model as production), stalling when broke; on completion the tech joins
 * the player's researched set (kept sorted for deterministic hashing).
 * Research PAUSES while no Techzentrum stands (progress and money already spent
 * are kept) — so raiding the enemy's tech center actually sets them back.
 */
export function researchSystem(state: GameState): void {
  for (const player of state.players) {
    const r = player.research;
    if (r === null) continue;
    if (!prereqsMet(state, player.id, techRule(r.tech).requires)) continue; // lab destroyed → paused
    const rule = techRule(r.tech);
    if (r.progress < rule.time) {
      const price = paidUpTo(rule.cost, rule.time, r.progress + 1) - paidUpTo(rule.cost, rule.time, r.progress);
      if (player.credits < price) continue; // stalled, no funds
      player.credits -= price;
      r.progress++;
    }
    if (r.progress >= rule.time) {
      if (!player.researched.includes(r.tech)) {
        player.researched.push(r.tech);
        player.researched.sort();
      }
      player.research = null;
    }
  }
}

export function cancelProduction(state: GameState, playerId: number, category: ProductionCategory): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  const queue = player.queues[category];
  if (queue.item === null) return;
  const { cost, buildTime } = costTimeOf(queue.item);
  player.credits += queue.ready ? cost : paidUpTo(cost, buildTime, queue.progress);
  queue.item = null;
  queue.progress = 0;
  queue.ready = false;
}

export function placeQueuedBuilding(state: GameState, playerId: number, cx: number, cy: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  const queue = player.queues.building;
  if (!queue.ready || queue.item === null || !isBuildingType(queue.item)) return;
  if (!canPlaceBuilding(state, playerId, queue.item, cx, cy)) return;
  constructBuilding(state, queue.item, playerId, cx, cy);
  queue.item = null;
  queue.progress = 0;
  queue.ready = false;
}

const CATEGORIES: readonly ProductionCategory[] = ['building', 'infantry', 'vehicle', 'air', 'naval'];

/**
 * Advances all build queues: credits drain gradually over the build time
 * (RA2 model), progress stalls when broke, and a power deficit halves the
 * build speed (queues only advance on even ticks).
 */
export function productionSystem(state: GameState): void {
  for (const player of state.players) {
    // Motherload cheat: refill the coffers each tick so spending never runs dry.
    if (player.motherload && player.credits < MOTHERLOAD_CREDITS) player.credits = MOTHERLOAD_CREDITS;
    const { produced, used } = powerBalance(state, player.id);
    const lowPower = used > produced;
    if (lowPower && state.tick % 2 === 1) continue;

    for (const category of CATEGORIES) {
      const queue = player.queues[category];
      if (queue.item === null) continue;

      if (queue.ready) continue; // building waits for placement

      if (queue.progress < costTimeOf(queue.item).buildTime) {
        const { cost, buildTime } = costTimeOf(queue.item);
        const price = paidUpTo(cost, buildTime, queue.progress + 1) - paidUpTo(cost, buildTime, queue.progress);
        if (player.credits < price) continue; // stalled, no funds
        player.credits -= price;
        queue.progress++;
      }

      if (queue.progress >= costTimeOf(queue.item).buildTime) {
        if (category === 'building') {
          queue.ready = true;
        } else if (isUnitType(queue.item) && trySpawnProduced(state, player, queue.item)) {
          queue.item = null;
          queue.progress = 0;
        }
        // else: no free spawn cell — retry next tick.
      }
    }
  }
}

/**
 * Advances in-place building upgrades (Wachturm → AGT, Kraftwerk → Fortschr.):
 * one tick of progress per pass toward the target's buildTime, then swaps the
 * type at full HP. Like construction, a power deficit halves the speed. The
 * cost was already paid when the upgrade started (see UPGRADE_BUILDING).
 * Deterministic: buildings are iterated in their fixed ascending-id order.
 */
export function buildingUpgradeSystem(state: GameState): void {
  const lowPower = state.players.map((p) => {
    const { produced, used } = powerBalance(state, p.id);
    return used > produced;
  });
  for (const building of state.buildings) {
    const up = building.upgrade;
    if (!up) continue;
    if (lowPower[building.owner] && state.tick % 2 === 1) continue; // half speed
    up.progress++;
    if (up.progress >= buildingRule(up.to).buildTime) {
      building.type = up.to;
      building.hp = buildingRule(up.to).maxHp;
      building.upgrade = null;
    }
  }
}

/** Spawns a finished unit next to its producing building; false if blocked. */
function trySpawnProduced(state: GameState, player: Player, item: string): boolean {
  if (!isUnitType(item)) return false;
  const category = unitRule(item).category;
  // Jets spawn at (and get bound to) a free Flugfeld; every other unit at the
  // first matching producer — for helis that skips the Flugfeld on purpose.
  const bound = unitRule(item).airfieldBound === true;
  const producer = bound
    ? findFreeAirfield(state, player.id)
    : state.buildings.find(
        (b) =>
          b.owner === player.id &&
          b.type !== 'FLUGFELD' &&
          buildingRule(b.type).produces === category,
      );
  if (!producer) return false;
  const rule = buildingRule(producer.type);
  const air = unitRule(item).air === true;
  const naval = unitRule(item).category === 'naval';
  for (let r = 1; r <= 6; r++) {
    for (const cell of cellsAroundRect(producer.cx, producer.cy, rule.width, rule.height, r)) {
      if (!inBounds(state, cell.cx, cell.cy)) continue;
      // Aircraft appear over any cell; ships need open water, ground units
      // clear passable ground.
      if (!air) {
        const ok = naval
          ? isNavigableWater(state, cell.cx, cell.cy)
          : isPassableTerrain(state, cell.cx, cell.cy);
        if (!ok) continue;
        if (state.occupancy[cellIndex(state, cell.cx, cell.cy)] !== 0) continue;
      }
      const unit = spawnUnit(state, item, player.id, cell.cx, cell.cy);
      if (bound) unit.homeId = producer.id; // this Flugfeld is the jet's home
      if (producer.rallyCx >= 0) {
        unit.path = air
          ? [{ cx: producer.rallyCx, cy: producer.rallyCy }]
          : findPath(state, cell.cx, cell.cy, producer.rallyCx, producer.rallyCy, {
              avoidUnits: false,
              selfId: unit.id,
              owner: unit.owner,
              water: naval,
            });
        unit.pathIndex = 0;
      }
      return true;
    }
  }
  return false;
}
