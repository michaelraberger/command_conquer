/**
 * Utility scoring for the AI's macro decisions. Pure integer functions
 * (permille arithmetic, Chebyshev distances, truncating division via |0):
 * the sim bans floats and sqrt/trig, and scores must hash-stably reproduce.
 *
 * Weights live on AiParams so difficulty presets and per-mission AiTuning
 * can scale every decision without touching code.
 */
import { buildingRule, unitRule, type BuildingType } from '../rules.js';
import { areEnemies, type Building, type GameState, type Player } from '../state.js';
import type { InfluenceView } from './influence.js';

/** Every step past the first attack, the committed raid share grows +100‰. */
export const RAID_ESCALATION_STEP = 5 * 60 * 15;

/** Integer decision weights, merged into AiParams (overridable via AiTuning). */
export interface AiWeights {
  /** Launch a wave when attackScore reaches this (lower = more aggressive). */
  attackThreshold: number;
  /** Attack-now terms: army ratio, best-target weakness, elapsed-time pressure. */
  wArmyRatio: number;
  wTargetWeakness: number;
  wEscalation: number;
  /** Target-selection terms: building value, defense penalty, distance penalty. */
  wValue: number;
  wDefense: number;
  wDist: number;
  /** Units retreat below hp × 1000 / maxHp < retreatPermille. */
  retreatPermille: number;
}

/** Armed-unit census of all enemies — feeds counter-production scores. */
export interface EnemyCensus {
  air: number;
  armor: number;
  infantry: number;
  naval: number;
}

export function enemyCensus(state: GameState, playerId: number): EnemyCensus {
  const census: EnemyCensus = { air: 0, armor: 0, infantry: 0, naval: 0 };
  for (const u of state.units) {
    if (!areEnemies(state, playerId, u.owner)) continue;
    const rule = unitRule(u.type);
    if (rule.weapon === null) continue;
    if (rule.air) census.air++;
    else if (rule.category === 'naval') census.naval++;
    else if (rule.category === 'infantry') census.infantry++;
    else census.armor++;
  }
  return census;
}

/** Cost-weighted firepower of a side (armed units only). */
export function armyPower(state: GameState, playerId: number, enemies: boolean): number {
  let power = 0;
  for (const u of state.units) {
    const hostile = areEnemies(state, playerId, u.owner);
    if (enemies !== hostile) continue;
    if (!enemies && u.owner !== playerId) continue; // own units only, not allies
    if (unitRule(u.type).weapon === null) continue;
    power += unitRule(u.type).cost;
  }
  return power;
}

/**
 * Raid desirability of a building type, seeded from the historical
 * RAID_PRIORITY order — economy and production first, HQ excluded (raids
 * deliberately never kill the last CONYARD; finisher mode handles that).
 */
const RAID_VALUE: Partial<Record<BuildingType, number>> = {
  REFINERY: 900,
  SILO: 850,
  FACTORY: 800,
  BARRACKS: 750,
  TECHCENTER: 700,
  WERKSTATT: 650,
  HELIPAD: 600,
  FLUGFELD: 550,
  SHIPYARD: 500,
};

export function raidBaseValue(type: BuildingType): number {
  return RAID_VALUE[type] ?? 300;
}

/** Center cell of a building footprint (influence layers are center-stamped). */
export function buildingCenter(b: Building): { cx: number; cy: number } {
  const rule = buildingRule(b.type);
  return { cx: b.cx + (rule.width >> 1), cy: b.cy + (rule.height >> 1) };
}

/**
 * Score of one raid target: value minus local defense minus distance.
 * All terms integer; caller breaks ties by lowest building id.
 */
export function targetScore(
  b: Building,
  homeCx: number,
  homeCy: number,
  inf: InfluenceView,
  w: AiWeights,
): number {
  const { cx, cy } = buildingCenter(b);
  const value = (raidBaseValue(b.type) * w.wValue) / 100;
  const defense = (inf.threatGroundAt(cx, cy) * w.wDefense) / 100;
  const dist = Math.max(Math.abs(cx - homeCx), Math.abs(cy - homeCy));
  return (value - defense - (dist * w.wDist) / 10) | 0;
}

/**
 * Best raid target by score (never WALL, never CONYARD). Ties by lowest id:
 * the id-sorted building array plus strict > makes the first max win.
 */
export function bestRaidTarget(
  state: GameState,
  player: Player,
  homeCx: number,
  homeCy: number,
  inf: InfluenceView,
  w: AiWeights,
): Building | null {
  let best: Building | null = null;
  let bestScore = -0x7fffffff;
  for (const b of state.buildings) {
    if (b.type === 'WALL' || b.type === 'CONYARD') continue;
    if (!areEnemies(state, player.id, b.owner)) continue;
    const score = targetScore(b, homeCx, homeCy, inf, w);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}

/** Time pressure once the grace period is over: 0…2000‰ of an escalation step. */
export function escalationPermille(tick: number, firstAttackTick: number): number {
  if (tick < firstAttackTick) return 0;
  return Math.min(2000, (((tick - firstAttackTick) * 1000) / RAID_ESCALATION_STEP) | 0);
}

/**
 * Is now a good moment to attack? Combines the cost-weighted army ratio, the
 * weakness of the best raid target (its value influence minus the defense
 * around it) and mounting time pressure. Compared against attackThreshold —
 * hard gates (grace period, cooldown, minimum army) stay outside in the tree.
 */
export function attackScore(
  state: GameState,
  player: Player,
  params: AiWeights & { firstAttackTick: number },
  inf: InfluenceView,
  homeCx: number,
  homeCy: number,
): number {
  const own = armyPower(state, player.id, false);
  const enemy = armyPower(state, player.id, true);
  const ratio = Math.min(3000, ((own * 1000) / Math.max(1, enemy)) | 0);
  const ratioTerm = (((ratio - 1000) * params.wArmyRatio) / 1000) | 0;

  let weaknessTerm = 0;
  const target = bestRaidTarget(state, player, homeCx, homeCy, inf, params);
  if (target) {
    const { cx, cy } = buildingCenter(target);
    const weakness = Math.max(-500, Math.min(500, inf.econAt(cx, cy) - inf.threatGroundAt(cx, cy)));
    weaknessTerm = ((weakness * params.wTargetWeakness) / 100) | 0;
  }

  const escTerm = ((escalationPermille(state.tick, params.firstAttackTick) * params.wEscalation) / 100) | 0;
  return ratioTerm + weaknessTerm + escTerm;
}

/**
 * Share of the army committed to a wave, in permille. Starts at half and
 * grows every escalation step — replaces the old float 0.5 + 0.1·k formula.
 */
export function waveCommitmentPermille(tick: number, firstAttackTick: number): number {
  const steps = (Math.max(0, tick - firstAttackTick) / RAID_ESCALATION_STEP) | 0;
  return Math.min(1000, 500 + steps * 100);
}
