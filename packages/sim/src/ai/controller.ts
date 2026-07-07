import { applyCommands, type Command } from '../commands.js';
import { cellsAroundRect } from '../map.js';
import {
  SUPERWEAPON_CHARGE_TICKS,
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
  /** Whether the AI techs to Mammoth/Artillery and superweapons. */
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
    useHighTech: true,
    incomeBonus: 25,
  },
};

/** Desired base, in build order. Duplicate entries raise the target count. */
const BUILD_GOALS: Record<Faction, readonly BuildingType[]> = {
  SOVIETS: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'TESLA', 'POWER', 'TESLA', 'WERKSTATT',
    'POWER', 'NUKESILO',
  ],
  ALLIES: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'PILLBOX', 'POWER', 'PILLBOX', 'WERKSTATT',
    'POWER', 'WEATHER',
  ],
};

/** High-tech goals the easy AI skips. */
const HIGH_TECH: ReadonlySet<BuildingType> = new Set(['WERKSTATT', 'NUKESILO', 'WEATHER']);

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
  for (const type of BUILD_GOALS[player.faction]) {
    if (!params.useHighTech && HIGH_TECH.has(type)) continue;
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
    if (tanks + heavies < params.vehicleCap) {
      const wantHeavy =
        params.useHighTech && tanks >= 3 && heavies < 3 && player.credits > 2200;
      startProduction(state, player.id, wantHeavy ? heavy : 'TANK');
    }
  }
}

function manageArmy(state: GameState, player: Player, params: AiParams): void {
  const combatIds = state.units
    .filter((u) => u.owner === player.id && unitRule(u.type).weapon !== null)
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

/** Deterministic ring search around the conyard for a legal placement spot. */
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
  for (let r = 1; r <= 7; r++) {
    for (const cell of cellsAroundRect(anchor.cx, anchor.cy, aRule.width, aRule.height, r)) {
      if (canPlaceBuilding(state, player.id, type, cell.cx, cell.cy)) return cell;
    }
  }
  return null;
}
