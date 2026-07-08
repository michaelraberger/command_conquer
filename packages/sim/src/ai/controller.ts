import { applyCommands, type Command } from '../commands.js';
import { TERRAIN_DIRT, TERRAIN_WATER, cellsAroundRect, inBounds } from '../map.js';
import {
  SUPERWEAPON_CHARGE_TICKS,
  TRANSPORT_CAPACITY,
  availableToFaction,
  buildingRule,
  unitRule,
  type AiDifficulty,
  type BuildingType,
  type Faction,
  type UnitType,
} from '../rules.js';
import type { Building, GameState, Player } from '../state.js';
import { canPlaceBuilding } from '../systems/placement.js';
import { placeQueuedBuilding, powerBalance, startProduction } from '../systems/production.js';

/** Grace period: the AI never launches an offensive before this tick (10 min). */
const FIRST_ATTACK_TICK = 10 * 60 * 15;

/** Difficulty tuning ("Schwierigkeitsgrad"). */
interface AiParams {
  /** Ticks between AI decision passes. */
  interval: number;
  /** Earliest tick for the first attack wave or superweapon strike. */
  firstAttackTick: number;
  /** Combat units needed before the AI launches a wave. */
  attackStrength: number;
  /** Minimum ticks between attack waves. */
  attackCooldown: number;
  /** Target sizes for the standing army. */
  riflemenCap: number;
  vehicleCap: number;
  /** Standing aircraft to keep (0 = this difficulty builds no air). */
  airCap: number;
  /** Standing warships to keep on island maps (0 = no navy). */
  navalCap: number;
  /** Whether the AI techs to Mammoth/Artillery, air, navy and superweapons. */
  useHighTech: boolean;
  /** Free credits per decision pass — the classic "hard AI cheats" bonus. */
  incomeBonus: number;
}

const DIFFICULTY_PARAMS: Record<AiDifficulty, AiParams> = {
  easy: {
    interval: 30,
    firstAttackTick: FIRST_ATTACK_TICK,
    attackStrength: 8,
    attackCooldown: 1800,
    riflemenCap: 4,
    vehicleCap: 4,
    airCap: 0,
    navalCap: 0,
    useHighTech: false,
    incomeBonus: 0,
  },
  normal: {
    interval: 15,
    firstAttackTick: FIRST_ATTACK_TICK,
    attackStrength: 7,
    attackCooldown: 900,
    riflemenCap: 6,
    vehicleCap: 8,
    airCap: 3,
    navalCap: 2,
    useHighTech: true,
    incomeBonus: 0,
  },
  hard: {
    interval: 10,
    firstAttackTick: FIRST_ATTACK_TICK,
    attackStrength: 6,
    attackCooldown: 600,
    riflemenCap: 8,
    vehicleCap: 12,
    airCap: 5,
    navalCap: 3,
    useHighTech: true,
    incomeBonus: 25,
  },
};

/** Desired base, in build order. Duplicate entries raise the target count. */
const BUILD_GOALS: Record<Faction, readonly BuildingType[]> = {
  SOVIETS: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'TESLA', 'POWER', 'TESLA', 'WERKSTATT',
    'HELIPAD', 'FLAKTOWER', 'POWER', 'NUKESILO',
  ],
  ALLIES: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'PILLBOX', 'POWER', 'PILLBOX', 'WERKSTATT',
    'HELIPAD', 'FLAKTOWER', 'POWER', 'WEATHER',
  ],
};

/** High-tech goals the easy AI skips. */
const HIGH_TECH: ReadonlySet<BuildingType> = new Set([
  'WERKSTATT', 'HELIPAD', 'FLAKTOWER', 'SHIPYARD', 'NUKESILO', 'WEATHER',
]);

/**
 * The build order for a player: high-tech goals dropped on easy, and a shipyard
 * injected right after the helipad when the map splits the players by water.
 */
function goalsFor(state: GameState, player: Player, params: AiParams): BuildingType[] {
  const goals: BuildingType[] = [];
  for (const type of BUILD_GOALS[player.faction]) {
    if (!params.useHighTech && HIGH_TECH.has(type)) continue;
    goals.push(type);
    if (type === 'HELIPAD' && state.mapType === 'ISLANDS' && params.navalCap > 0) {
      goals.push('SHIPYARD');
    }
  }
  return goals;
}

/**
 * The AI is a pure command generator: it reads GameState and issues the same
 * commands a human could. It runs identically inside every client's sim, so
 * it is lockstep/multiplayer-safe by construction and cannot desync.
 */
export function aiSystem(state: GameState): void {
  if (state.winner !== -1) return;
  for (const player of state.players) {
    if (!player.isAi) continue;
    const params = DIFFICULTY_PARAMS[player.difficulty];
    if (state.tick % params.interval !== 0) continue;
    player.credits += params.incomeBonus;
    manageConstruction(state, player, params);
    manageTraining(state, player, params);
    manageInvasion(state, player, params);
    manageArmy(state, player, params);
    manageSuperweapon(state, player, params);
  }
}

function countBuildings(state: GameState, owner: number, type: BuildingType): number {
  let n = 0;
  for (const b of state.buildings) if (b.owner === owner && b.type === type) n++;
  return n;
}

function countUnits(state: GameState, owner: number, type: UnitType): number {
  let n = 0;
  for (const u of state.units) if (u.owner === owner && u.type === type) n++;
  return n;
}

function manageConstruction(state: GameState, player: Player, params: AiParams): void {
  const queue = player.queues.building;
  if (queue.ready && queue.item) {
    const spot = findPlacementSpot(state, player, queue.item as BuildingType);
    if (spot) placeQueuedBuilding(state, player.id, spot.cx, spot.cy);
    return;
  }
  if (queue.item !== null) return;

  const wanted = new Map<BuildingType, number>();
  for (const type of goalsFor(state, player, params)) {
    wanted.set(type, (wanted.get(type) ?? 0) + 1);
    if (countBuildings(state, player.id, type) < wanted.get(type)!) {
      // Emergency power first: defenses go offline on a deficit.
      const { produced, used } = powerBalance(state, player.id);
      const next = used > produced ? 'POWER' : type;
      startProduction(state, player.id, next);
      return;
    }
  }
}

function manageTraining(state: GameState, player: Player, params: AiParams): void {
  if (player.queues.infantry.item === null) {
    if (countUnits(state, player.id, 'RIFLEMAN') < params.riflemenCap) {
      startProduction(state, player.id, 'RIFLEMAN');
    } else if (countUnits(state, player.id, 'ROCKETEER') < Math.ceil(params.riflemenCap / 2)) {
      // Anti-armor backbone once the rifle line is filled.
      startProduction(state, player.id, 'ROCKETEER');
    }
  }
  if (player.queues.vehicle.item === null) {
    if (countUnits(state, player.id, 'HARVESTER') < 2) {
      startProduction(state, player.id, 'HARVESTER');
      return;
    }
    const heavy: UnitType = availableToFaction(unitRule('MAMMOTH').factions, player.faction)
      ? 'MAMMOTH'
      : 'ARTILLERY';
    const tanks = countUnits(state, player.id, 'TANK');
    const heavies = countUnits(state, player.id, heavy);
    // On island maps ground vehicles can't cross — keep only a small home guard
    // so credits flow into air and navy instead.
    const vehicleCap = state.mapType === 'ISLANDS' ? Math.min(3, params.vehicleCap) : params.vehicleCap;
    if (tanks + heavies < vehicleCap) {
      const wantHeavy =
        params.useHighTech && tanks >= 3 && heavies < 3 && player.credits > 2200;
      startProduction(state, player.id, wantHeavy ? heavy : 'TANK');
    }
  }

  // Air: keep a small standing air force once a helipad stands. Aircraft fly
  // over water, so this is the AI's main threat on island maps.
  if (
    params.airCap > 0 &&
    player.queues.air.item === null &&
    state.buildings.some((b) => b.owner === player.id && b.type === 'HELIPAD')
  ) {
    const jetOk = availableToFaction(unitRule('JET').factions, player.faction);
    const heli = countUnits(state, player.id, 'HELI');
    const jet = jetOk ? countUnits(state, player.id, 'JET') : 0;
    if (heli + jet < params.airCap) {
      const wantJet = jetOk && heli >= 1 && jet < Math.floor(params.airCap / 2) && player.credits > 1400;
      startProduction(state, player.id, wantJet ? 'JET' : 'HELI');
    }
  }

  // Navy (island maps): one transport for invasions, then a few warships.
  if (
    params.navalCap > 0 &&
    state.mapType === 'ISLANDS' &&
    player.queues.naval.item === null &&
    state.buildings.some((b) => b.owner === player.id && b.type === 'SHIPYARD')
  ) {
    if (countUnits(state, player.id, 'TRANSPORT') < 1) {
      startProduction(state, player.id, 'TRANSPORT');
    } else {
      const ships =
        countUnits(state, player.id, 'DESTROYER') +
        countUnits(state, player.id, 'GUNBOAT') +
        countUnits(state, player.id, 'SUB');
      if (ships < params.navalCap) {
        const flagship: UnitType = availableToFaction(unitRule('DESTROYER').factions, player.faction)
          ? 'DESTROYER'
          : availableToFaction(unitRule('SUB').factions, player.faction)
            ? 'SUB'
            : 'GUNBOAT';
        const want = player.credits > unitRule(flagship).cost + 400 ? flagship : 'GUNBOAT';
        startProduction(state, player.id, want);
      }
    }
  }
}

function manageArmy(state: GameState, player: Player, params: AiParams): void {
  // Offensive units can strike ground/buildings. Anti-air (FLAK) and
  // torpedo-only subs stay out of ground waves — they defend autonomously in
  // guard stance instead.
  const combatIds = state.units
    .filter((u) => {
      if (u.owner !== player.id) return false;
      const weapon = unitRule(u.type).weapon;
      return weapon !== null && weapon.targets !== 'air' && unitRule(u.type).navalOnly !== true;
    })
    .map((u) => u.id);
  if (combatIds.length === 0) return;

  const home = state.buildings.find((b) => b.owner === player.id && b.type === 'CONYARD');
  const commands: Command[] = [];

  // Defense: enemies close to the base pull everyone home.
  if (home) {
    const threat = state.units.some((u) => {
      if (u.owner === player.id) return false;
      const dx = (u.cell % state.mapWidth) - home.cx;
      const dy = Math.floor(u.cell / state.mapWidth) - home.cy;
      return dx * dx + dy * dy < 12 * 12;
    });
    if (threat) {
      commands.push({
        type: 'ATTACK_MOVE',
        playerId: player.id,
        unitIds: combatIds,
        cx: home.cx + 1,
        cy: home.cy + 1,
      });
      applyCommands(state, commands);
      return;
    }
  }

  // Offense: periodic waves once the army is big enough — but never before
  // the grace period is over ("KI greift erst nach 10 Minuten an").
  if (
    state.tick >= params.firstAttackTick &&
    combatIds.length >= params.attackStrength &&
    state.tick - player.aiLastAttackTick >= params.attackCooldown
  ) {
    const target = state.buildings.find((b) => b.owner !== player.id && b.type === 'CONYARD')
      ?? state.buildings.find((b) => b.owner !== player.id);
    if (target) {
      player.aiLastAttackTick = state.tick;
      commands.push({
        type: 'ATTACK_MOVE',
        playerId: player.id,
        unitIds: combatIds,
        cx: target.cx,
        cy: target.cy,
      });
      applyCommands(state, commands);
    }
  }
}

/**
 * Amphibious assault (island maps): fill a transport with infantry, ferry it to
 * a beach on the enemy island and unload. The landed troops then join the next
 * ground wave via manageArmy. Best-effort — if boarding or a beach can't be
 * found, the AI's air force still carries the offense.
 */
function manageInvasion(state: GameState, player: Player, params: AiParams): void {
  if (state.mapType !== 'ISLANDS' || params.navalCap === 0) return;
  if (state.tick < params.firstAttackTick) return;

  const transport = state.units.find((u) => u.owner === player.id && u.type === 'TRANSPORT');
  if (!transport) return;
  const enemyHome =
    state.buildings.find((b) => b.owner !== player.id && b.type === 'CONYARD') ??
    state.buildings.find((b) => b.owner !== player.id);
  if (!enemyHome) return;

  const w = state.mapWidth;
  const tcx = transport.cell % w;
  const tcy = Math.floor(transport.cell / w);
  const pax = transport.passengers.length;

  // Board nearby infantry until full, unless troops are already walking aboard.
  const boarding = state.units.some((u) => u.owner === player.id && u.order?.kind === 'BOARD');
  if (pax < TRANSPORT_CAPACITY && transport.path === null && !boarding) {
    const inf = state.units
      .filter((u) => u.owner === player.id && unitRule(u.type).category === 'infantry')
      .slice(0, TRANSPORT_CAPACITY - pax)
      .map((u) => u.id);
    if (inf.length > 0) {
      applyCommands(state, [
        { type: 'LOAD', playerId: player.id, unitIds: inf, transportId: transport.id },
      ]);
      return;
    }
  }

  // With troops aboard, ferry to an enemy beach and drop them off.
  if (pax > 0) {
    const beach = findBeach(state, enemyHome.cx, enemyHome.cy);
    if (!beach) return;
    const near = Math.max(Math.abs(tcx - beach.cx), Math.abs(tcy - beach.cy)) <= 3;
    if (near) {
      applyCommands(state, [{ type: 'UNLOAD', playerId: player.id, unitIds: [transport.id] }]);
    } else if (transport.path === null) {
      applyCommands(state, [
        { type: 'MOVE', playerId: player.id, unitIds: [transport.id], cx: beach.cx, cy: beach.cy },
      ]);
    }
  }
}

/** Nearest landable beach (passable dirt 8-adjacent to water) to (bx, by). */
function findBeach(state: GameState, bx: number, by: number): { cx: number; cy: number } | null {
  const w = state.mapWidth;
  const isWater = (x: number, y: number): boolean =>
    inBounds(state, x, y) && state.terrain[y * w + x] === TERRAIN_WATER;
  for (let r = 0; r <= 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = bx + dx;
        const y = by + dy;
        if (!inBounds(state, x, y) || state.terrain[y * w + x] !== TERRAIN_DIRT) continue;
        for (let ny = -1; ny <= 1; ny++) {
          for (let nx = -1; nx <= 1; nx++) {
            if ((nx !== 0 || ny !== 0) && isWater(x + nx, y + ny)) return { cx: x, cy: y };
          }
        }
      }
    }
  }
  return null;
}

/** Fire a charged superweapon at the enemy's most valuable structure. */
function manageSuperweapon(state: GameState, player: Player, params: AiParams): void {
  if (!params.useHighTech) return;
  if (state.tick < params.firstAttackTick) return; // grace period covers nukes too
  const charged = state.buildings.some(
    (b) =>
      b.owner === player.id &&
      buildingRule(b.type).superweapon !== null &&
      b.charge >= SUPERWEAPON_CHARGE_TICKS,
  );
  if (!charged) return;
  const target =
    state.buildings.find((b) => b.owner !== player.id && b.type === 'CONYARD') ??
    state.buildings.find((b) => b.owner !== player.id && b.type !== 'WALL');
  if (!target) return;
  applyCommands(state, [
    { type: 'FIRE_SUPERWEAPON', playerId: player.id, cx: target.cx + 1, cy: target.cy + 1 },
  ]);
}

/**
 * Deterministic ring search around the conyard for a legal placement spot.
 * On island maps the AI prefers the spot nearest to open water, so its base
 * creeps toward the coast until a shipyard (which must sit on water) becomes
 * placeable. Water buildings search a wider radius to reach the shore.
 */
function findPlacementSpot(
  state: GameState,
  player: Player,
  type: BuildingType,
): { cx: number; cy: number } | null {
  const anchor: Building | undefined =
    state.buildings.find((b) => b.owner === player.id && b.type === 'CONYARD') ??
    state.buildings.find((b) => b.owner === player.id);
  if (!anchor) return null;
  const aRule = buildingRule(anchor.type);
  const maxR = buildingRule(type).onWater ? 16 : 8;
  const seaward = state.mapType === 'ISLANDS';

  let best: { cx: number; cy: number } | null = null;
  let bestScore = Infinity;
  for (let r = 1; r <= maxR; r++) {
    for (const cell of cellsAroundRect(anchor.cx, anchor.cy, aRule.width, aRule.height, r)) {
      if (!canPlaceBuilding(state, player.id, type, cell.cx, cell.cy)) continue;
      if (!seaward) return cell; // original first-fit behavior off islands
      const d = distToWater(state, cell.cx, cell.cy);
      if (d < bestScore) {
        bestScore = d;
        best = cell;
      }
    }
  }
  return best;
}

/** Chebyshev distance to the nearest water cell within a small window (else large). */
function distToWater(state: GameState, cx: number, cy: number): number {
  const w = state.mapWidth;
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (inBounds(state, x, y) && state.terrain[y * w + x] === TERRAIN_WATER) return r;
      }
    }
  }
  return 99;
}
