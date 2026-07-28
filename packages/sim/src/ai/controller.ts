import { applyCommands } from '../commands.js';
import { TERRAIN_DIRT, TERRAIN_WATER, cellsAroundRect, inBounds } from '../map.js';
import {
  BUILDING_RULES,
  SUPERWEAPON_CHARGE_TICKS,
  TRANSPORT_CAPACITY,
  UNIT_RULES,
  availableToFaction,
  buildingRule,
  techFor,
  techRule,
  unitRule,
  upgradeChainOf,
  type AiDifficulty,
  type BuildingType,
  type Faction,
  type TechId,
  type UnitType,
} from '../rules.js';
import { areEnemies, type Building, type GameState, type Player, type Unit } from '../state.js';
import { computeInfluence, type InfluenceView } from './influence.js';
import {
  attackScore,
  bestRaidTarget,
  buildingCenter,
  enemyCensus,
  raidBaseValue,
  waveCommitmentPermille,
  type AiWeights,
} from './score.js';
import { AI_ROOT } from './trees.js';
import { findFreeAirfield } from '../systems/airbase.js';
import { canPlaceBuilding } from '../systems/placement.js';
import {
  placeQueuedBuilding,
  powerBalance,
  startProduction,
  startResearch,
} from '../systems/production.js';

/** Grace period: the AI never launches an offensive before this tick (10 min). */
const FIRST_ATTACK_TICK = 10 * 60 * 15;

/**
 * Search radii below are tuned for 64² maps; larger maps scale them up so the
 * AI still finds beaches/placement spots. 48/64 → 1 (byte-identical behavior),
 * 96–144 → 2, 192 → 3.
 */
function mapScale(state: GameState): number {
  return Math.max(1, Math.round(Math.min(state.mapWidth, state.mapHeight) / 64));
}

/** Difficulty tuning ("Schwierigkeitsgrad") plus utility weights (score.ts). */
export interface AiParams extends AiWeights {
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
    // Even the easy AI needs a way across the water, or island maps become a
    // no-op: a small air wing plus one transport keeps it in the fight.
    airCap: 2,
    navalCap: 1,
    useHighTech: false,
    incomeBonus: 8,
    attackThreshold: 700,
    wArmyRatio: 400,
    wTargetWeakness: 50,
    wEscalation: 60,
    wValue: 100,
    wDefense: 40,
    wDist: 20,
    retreatPermille: 300,
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
    incomeBonus: 12,
    attackThreshold: 550,
    wArmyRatio: 400,
    wTargetWeakness: 50,
    wEscalation: 60,
    wValue: 100,
    wDefense: 40,
    wDist: 20,
    retreatPermille: 300,
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
    attackThreshold: 400,
    wArmyRatio: 400,
    wTargetWeakness: 50,
    wEscalation: 60,
    wValue: 100,
    wDefense: 40,
    wDist: 20,
    retreatPermille: 300,
  },
};

/** Desired base, in build order. Duplicate entries raise the target count. */
const BUILD_GOALS: Record<Faction, readonly BuildingType[]> = {
  SOVIETS: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'GUARDTOWER', 'SILO', 'RADAR', 'TECHCENTER',
    'TESLA', 'POWER', 'TESLA', 'WERKSTATT', 'HELIPAD', 'FLUGFELD', 'SILO', 'FLAKTOWER', 'POWER',
    'NUKESILO',
  ],
  ALLIES: [
    'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'GUARDTOWER', 'SILO', 'RADAR', 'TECHCENTER', 'PILLBOX',
    'POWER', 'PILLBOX', 'WERKSTATT', 'HELIPAD', 'FLUGFELD', 'PRISM', 'SILO', 'FLAKTOWER', 'POWER',
    'PRISM', 'WEATHER',
  ],
};

/**
 * High-tech goals the easy AI skips. Air (helipad) and the shipyard are
 * deliberately NOT here: every difficulty must be able to build them, otherwise
 * the easy AI is helpless on water maps. Only the repair depot and the
 * superweapons stay reserved for normal/hard.
 */
const HIGH_TECH: ReadonlySet<BuildingType> = new Set([
  'WERKSTATT', 'NUKESILO', 'WEATHER',
]);

/**
 * The build order for a player: high-tech goals dropped on easy. On island maps
 * the helipad and shipyard jump to the front (right after the factory) so the
 * AI gains a way across the water early instead of after a long land build-up —
 * every difficulty needs that reach, so it isn't gated behind high-tech.
 */
function goalsFor(state: GameState, player: Player, params: AiParams): BuildingType[] {
  const faction = player.faction;
  let order: readonly BuildingType[];
  if (state.mapType === 'ISLANDS') {
    const defense: BuildingType = faction === 'SOVIETS' ? 'TESLA' : 'PILLBOX';
    const superweapon: BuildingType = faction === 'SOVIETS' ? 'NUKESILO' : 'WEATHER';
    order = [
      'POWER', 'REFINERY', 'BARRACKS', 'FACTORY', 'SILO', 'RADAR', 'TECHCENTER', 'HELIPAD', 'FLUGFELD',
      'SHIPYARD', 'FLAKTOWER', 'POWER', defense, 'WERKSTATT', 'SILO', 'POWER', superweapon,
    ];
  } else {
    order = BUILD_GOALS[faction];
  }
  const goals: BuildingType[] = [];
  for (const type of order) {
    if (!params.useHighTech && HIGH_TECH.has(type)) continue;
    if ((type === 'HELIPAD' || type === 'FLUGFELD') && params.airCap <= 0) continue;
    if (type === 'SHIPYARD' && params.navalCap <= 0) continue;
    goals.push(type);
  }
  // Counter-production: an enemy air fleet injects up to two extra flak towers
  // right after the factory, ahead of the normal defense build-out.
  if (enemyCensus(state, player.id).air >= 4) {
    const at = goals.indexOf('FACTORY') + 1;
    goals.splice(at, 0, 'FLAKTOWER', 'FLAKTOWER');
  }
  return goals;
}

/**
 * The AI is a pure command generator: it reads GameState and issues the same
 * commands a human could. It runs identically inside every client's sim, so
 * it is lockstep/multiplayer-safe by construction and cannot desync.
 *
 * Decision structure lives in the behavior tree (trees.ts); this entry point
 * only handles per-player gating and hands a fresh AiCtx to the root.
 */
export function aiSystem(state: GameState): void {
  if (state.winner !== -1) return;
  for (const player of state.players) {
    if (!player.isAi) continue;
    const base = DIFFICULTY_PARAMS[player.difficulty];
    // Campaign missions may override single knobs per player (mission.ts).
    const params = player.aiTuning ? { ...base, ...player.aiTuning } : base;
    if (state.tick % params.interval !== 0) continue;
    player.credits += params.incomeBonus;
    // One influence compute per pass; allied AIs share it via the memo cache.
    const inf = computeInfluence(state, player.id);
    AI_ROOT.tick({ state, player, params, inf });
  }
}

/** Start a timed in-place upgrade (same effect as the UPGRADE_BUILDING command). */
function upgradeOne(state: GameState, player: Player, from: BuildingType): boolean {
  const rule = buildingRule(from);
  const to = rule.upgradeTo as BuildingType | undefined;
  const cost = rule.upgradeCost;
  if (to === undefined || cost === undefined || player.credits < cost) return false;
  const target = state.buildings.find(
    (b) => b.owner === player.id && b.type === from && !b.upgrade,
  );
  if (!target) return false;
  player.credits -= cost;
  target.upgrade = { to, progress: 0 };
  return true;
}

/**
 * In-place upgrades once the economy can spare it. First a power plant when the
 * base runs a deficit (advanced plant = double output keeps defenses online),
 * then a Wachturm to an Advanced Guard Tower. Deterministic: lowest-id target,
 * one per pass. Only normal/hard bother.
 */
export function manageUpgrades(state: GameState, player: Player, params: AiParams): void {
  if (!params.useHighTech) return; // easy AI keeps basic structures
  if (player.credits < 1500) return; // keep a buffer for production
  const { produced, used } = powerBalance(state, player.id);
  if (used > produced && upgradeOne(state, player, 'POWER')) return;
  // Third tier only after the Atomprogramm — upgradeOne bypasses the command
  // gate, so the research check must live here.
  if (used > produced && player.researched.includes('atom') && upgradeOne(state, player, 'ADVPOWER')) {
    return;
  }
  upgradeOne(state, player, 'GUARDTOWER');
}

function countBuildings(state: GameState, owner: number, type: BuildingType): number {
  let n = 0;
  for (const b of state.buildings) if (b.owner === owner && b.type === type) n++;
  return n;
}

/**
 * Goal satisfaction: an in-place UPGRADED building still fills its base goal —
 * an AGT is a satisfied GUARDTOWER, an Ausbau-Kraftwerk a satisfied POWER.
 * Without this the AI loops forever: upgrade the tower, see the goal "empty",
 * build the next tower, upgrade it … draining every credit into defenses
 * (observed: 17 AGTs and a bankrupt build order that never reached its tech).
 */
function countGoalBuildings(state: GameState, owner: number, type: BuildingType): number {
  const chain = upgradeChainOf(type); // POWER counts ADVPOWER and ATOM too
  let n = 0;
  for (const b of state.buildings) {
    if (b.owner !== owner) continue;
    if (chain.includes(b.type)) n++;
  }
  return n;
}

function countUnits(state: GameState, owner: number, type: UnitType): number {
  let n = 0;
  for (const u of state.units) if (u.owner === owner && u.type === type) n++;
  return n;
}

export function manageConstruction(state: GameState, player: Player, params: AiParams): void {
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
    if (countGoalBuildings(state, player.id, type) < wanted.get(type)!) {
      // Tech-locked goals wait for research (manageResearch handles them) — skip
      // to the next available goal instead of stalling the whole build order.
      const tech = techFor(type);
      if (tech !== undefined && !player.researched.includes(tech)) continue;
      // Emergency power first: defenses go offline on a deficit.
      const { produced, used } = powerBalance(state, player.id);
      const next = used > produced ? 'POWER' : type;
      startProduction(state, player.id, next);
      return;
    }
  }
}

/** Preferred research order; the AI unlocks its tech tree one project at a time. */
const AI_RESEARCH_ORDER: readonly TechId[] = [
  'repair', 'flak', 'air', 'armor', 'tesla', 'navy', 'atom', 'super',
];

/**
 * Research pacing: with a Techzentrum standing, the AI researches the next
 * technology it needs (in AI_RESEARCH_ORDER) so its advanced units/buildings
 * unlock over the course of the match. One project at a time; spies are skipped.
 */
export function manageResearch(state: GameState, player: Player, params: AiParams): void {
  if (player.research !== null || state.tick < params.interval) return;
  if (!state.buildings.some((b) => b.owner === player.id && b.type === 'TECHCENTER')) return;
  if (player.credits < 600) return; // keep some cash for the economy
  for (const tech of AI_RESEARCH_ORDER) {
    if (player.researched.includes(tech)) continue;
    const rule = techRule(tech);
    if (!availableToFaction(rule.factions, player.faction)) continue;
    // Skip research that unlocks nothing for THIS faction — the Allies were
    // burning a whole slot on 'armor' (Mammoth, Soviet-only), the Soviets on
    // Allied-only projects, before reaching their own tech.
    if (!techUnlocksFor(tech, player.faction)) continue;
    if (tech === 'navy' && state.mapType !== 'ISLANDS') continue; // no shipyard goal on land
    if ((tech === 'super' || tech === 'atom') && !params.useHighTech) continue; // easy AI stays low-tech
    startResearch(state, player.id, tech);
    return;
  }
}

/** True when this tech gates at least one unit/building the faction can use. */
function techUnlocksFor(tech: TechId, faction: Faction): boolean {
  for (const type of Object.keys(UNIT_RULES) as UnitType[]) {
    const rule = unitRule(type);
    if (rule.tech === tech && availableToFaction(rule.factions, faction)) return true;
  }
  for (const type of Object.keys(BUILDING_RULES) as BuildingType[]) {
    const rule = buildingRule(type);
    if (rule.tech === tech && availableToFaction(rule.factions, faction)) return true;
  }
  return false;
}

/**
 * MCV insurance: keep one Baufahrzeug in reserve once the economy can spare it,
 * and — crucially — redeploy it into a new base if the construction yard falls,
 * so the AI isn't instantly knocked out either.
 */
export function manageMcv(state: GameState, player: Player): void {
  const hasConyard = state.buildings.some((b) => b.owner === player.id && b.type === 'CONYARD');
  const mcv = state.units.find((u) => u.owner === player.id && u.type === 'MCV');
  if (!hasConyard) {
    if (mcv) applyCommands(state, [{ type: 'DEPLOY', playerId: player.id, unitIds: [mcv.id] }]);
    return;
  }
  if (
    !mcv &&
    player.queues.vehicle.item === null &&
    player.credits > 3500 &&
    state.buildings.some((b) => b.owner === player.id && b.type === 'FACTORY')
  ) {
    startProduction(state, player.id, 'MCV');
  }
}

/** Neutral map structures worth taking (Erz-Bohrtürme, Lazarett). */
function neutralCapturables(state: GameState): Building[] {
  return state.buildings.filter((b) => {
    if (b.owner >= 0) return false;
    const rule = buildingRule(b.type);
    return (rule.income ?? 0) > 0 || (rule.captureBonus ?? 0) > 0 || (rule.heal ?? 0) > 0;
  });
}

/**
 * Infantry line: engineer for free capturables first (correctness, not
 * preference), then the utility pick between rifles and rocketeers. Rocketeers
 * double as anti-air, so an enemy air fleet spikes their score and raises
 * their cap — the counter-production answer to a heli/jet rush.
 */
export function trainInfantry(state: GameState, player: Player, params: AiParams): void {
  if (player.queues.infantry.item !== null) return;
  // A free Bohrturm on the map is worth an engineer before anything else —
  // one at a time; once every tower is taken the condition stays false.
  const wantEngineer =
    neutralCapturables(state).length > 0 && countUnits(state, player.id, 'ENGINEER') === 0;
  if (wantEngineer) {
    startProduction(state, player.id, 'ENGINEER');
    return;
  }
  const census = enemyCensus(state, player.id);
  const rifles = countUnits(state, player.id, 'RIFLEMAN');
  const rockets = countUnits(state, player.id, 'ROCKETEER');
  const rocketCap =
    Math.ceil(params.riflemenCap / 2) + (census.air >= 3 ? Math.min(census.air, params.riflemenCap) : 0);
  const rifleScore = rifles < params.riflemenCap ? 100 + (params.riflemenCap - rifles) * 10 : 0;
  const rocketScore =
    rockets < rocketCap ? 90 + (rocketCap - rockets) * 10 + Math.min(census.air, 6) * 20 : 0;
  // Deterministic utility pick: strict >, rifle line wins ties.
  if (rifleScore <= 0 && rocketScore <= 0) return;
  startProduction(state, player.id, rocketScore > rifleScore ? 'ROCKETEER' : 'RIFLEMAN');
}

/**
 * Vehicle line: harvesters before anything (correctness), then tanks/heavies
 * plus siege. An armor-heavy enemy pushes the heavy/AT branch earlier via the
 * census — the counter-production answer to a tank push.
 */
export function trainVehicles(state: GameState, player: Player, params: AiParams): void {
  if (player.queues.vehicle.item !== null) return;
  if (countUnits(state, player.id, 'HARVESTER') < 2) {
    startProduction(state, player.id, 'HARVESTER');
    return;
  }
  const census = enemyCensus(state, player.id);
  const heavy: UnitType = availableToFaction(unitRule('MAMMOTH').factions, player.faction)
    ? 'MAMMOTH'
    : 'ARTILLERY';
  const tanks = countUnits(state, player.id, 'TANK');
  const heavies = countUnits(state, player.id, heavy);
  // On island maps ground vehicles can't cross — keep only a small home guard
  // so credits flow into air and navy instead.
  const vehicleCap = state.mapType === 'ISLANDS' ? Math.min(3, params.vehicleCap) : params.vehicleCap;
  if (tanks + heavies < vehicleCap) {
    // Heavies earlier when the enemy masses armor (census) — otherwise the
    // historical thresholds hold.
    const heavyGate = census.armor >= 5 ? 2 : 3;
    const wantHeavy =
      params.useHighTech && tanks >= heavyGate && heavies < 3 && player.credits > 2200;
    startProduction(state, player.id, wantHeavy ? heavy : 'TANK');
  }
  // Siege support pair, faction-symmetric: Soviet V3 launchers or Allied
  // artillery (startProduction no-ops while the queue is busy or the
  // prereqs/research are missing, so this never stalls the build order).
  const siege: UnitType = availableToFaction(unitRule('V3').factions, player.faction)
    ? 'V3'
    : 'ARTILLERY';
  if (
    state.mapType !== 'ISLANDS' &&
    countUnits(state, player.id, siege) < 2 &&
    player.credits > 1600
  ) {
    startProduction(state, player.id, siege);
  }
}

/**
 * Air: keep a small standing air force once an air building stands. Helis
 * come from the Landefläche, jets need a FREE Flugfeld (one jet per field).
 * Aircraft fly over water, so this is the AI's main threat on island maps.
 */
export function trainAir(state: GameState, player: Player, params: AiParams): void {
  if (params.airCap <= 0 || player.queues.air.item !== null) return;
  const hasPad = state.buildings.some((b) => b.owner === player.id && b.type === 'HELIPAD');
  const jetOk = availableToFaction(unitRule('JET').factions, player.faction);
  const heli = countUnits(state, player.id, 'HELI');
  const jet = jetOk ? countUnits(state, player.id, 'JET') : 0;
  if (heli + jet < params.airCap) {
    const wantJet =
      jetOk &&
      heli >= 1 &&
      jet < Math.floor(params.airCap / 2) &&
      player.credits > 1400 &&
      findFreeAirfield(state, player.id) !== null;
    if (wantJet) startProduction(state, player.id, 'JET');
    else if (hasPad) startProduction(state, player.id, 'HELI');
  }
}

/** Navy (island maps): one transport for invasions, then a few warships. */
export function trainNavy(state: GameState, player: Player, params: AiParams): void {
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
      // Siege support once the surface fleet stands: a single missile sub —
      // its rockets outrange every shore defense. The easy AI (navalCap 1)
      // skips it; the Techzentrum requirement gates it to the late game.
      const wantMissileSub =
        params.navalCap >= 2 &&
        ships >= params.navalCap &&
        countUnits(state, player.id, 'MISSILESUB') < 1 &&
        countBuildings(state, player.id, 'TECHCENTER') > 0 &&
        player.credits > unitRule('MISSILESUB').cost + 400;
      if (wantMissileSub) {
        startProduction(state, player.id, 'MISSILESUB');
      } else if (ships < params.navalCap) {
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

/** Sends an idle engineer to the nearest neutral Bohrturm. Deterministic:
 *  lowest-id idle engineer, nearest target by squared cell distance with the
 *  lower building id breaking ties. Enemy buildings are never captured. */
export function manageCapture(state: GameState, player: Player): void {
  const targets = neutralCapturables(state);
  if (targets.length === 0) return;
  const engineer = state.units.find(
    (u) => u.owner === player.id && u.type === 'ENGINEER' && u.order === null,
  );
  if (!engineer) return;
  const ecx = engineer.cell % state.mapWidth;
  const ecy = (engineer.cell - ecx) / state.mapWidth;
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of targets) {
    const dx = b.cx - ecx;
    const dy = b.cy - ecy;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best) {
    applyCommands(state, [
      { type: 'CAPTURE', playerId: player.id, unitIds: [engineer.id], targetId: best.id },
    ]);
  }
}

/** Once this long past the first-attack tick, the AI stops holding back and
 *  goes for the kill regardless (late-game escalation). ~15 min. */
const LATE_ESCALATION = 15 * 60 * 15;

/**
 * Deterministic attack target. In "finisher" mode the AI aims for the enemy HQ
 * (nearest CONYARD, else anything) to end the game; otherwise the best-scored
 * raid target wins (value minus local defense minus distance, score.ts) —
 * deliberately NOT the last construction yard, so the match keeps going.
 */
function pickAttackTarget(
  state: GameState,
  player: Player,
  home: Building | undefined,
  finisher: boolean,
  inf: InfluenceView,
  params: AiParams,
): Building | null {
  const hx = home ? home.cx : Math.floor(state.mapWidth / 2);
  const hy = home ? home.cy : Math.floor(state.mapHeight / 2);
  const nearest = (pred: (b: Building) => boolean): Building | null => {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of state.buildings) {
      if (b.type === 'WALL' || !areEnemies(state, player.id, b.owner) || !pred(b)) continue;
      const dx = b.cx - hx;
      const dy = b.cy - hy;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && best !== null && b.id < best.id)) {
        best = b;
        bestD = d;
      }
    }
    return best;
  };
  if (finisher) return nearest((b) => b.type === 'CONYARD') ?? nearest(() => true);
  return (
    bestRaidTarget(state, player, hx, hy, inf, params) ??
    nearest((b) => b.type !== 'CONYARD') ??
    nearest(() => true)
  );
}

/**
 * Offensive units can strike ground/buildings. Anti-air (FLAK) and
 * torpedo-only subs stay out of ground waves — they defend autonomously in
 * guard stance instead.
 */
export function combatPool(state: GameState, player: Player): Unit[] {
  return state.units.filter((u) => {
    if (u.owner !== player.id) return false;
    const weapon = unitRule(u.type).weapon;
    return weapon !== null && weapon.targets !== 'air' && unitRule(u.type).navalOnly !== true;
  });
}

/** The AI's rally anchor: its construction yard. */
export function homeBase(state: GameState, player: Player): Building | undefined {
  return state.buildings.find((b) => b.owner === player.id && b.type === 'CONYARD');
}

/** Badly damaged units get pulled out of waves and back home. */
export function hurtUnitIds(combat: Unit[], retreatPermille: number): Set<number> {
  const hurt = new Set<number>();
  for (const u of combat) {
    if (u.hp * 1000 < unitRule(u.type).maxHp * retreatPermille) hurt.add(u.id);
  }
  return hurt;
}

/**
 * True when enemy firepower reaches the AI's construction yard area. Reads the
 * influence disk around the conyard, so artillery shelling from just outside
 * the old fixed scan radius now also triggers the recall.
 */
export function isBaseThreatened(state: GameState, player: Player, inf: InfluenceView): boolean {
  const home = homeBase(state, player);
  if (!home) return false;
  return inf.threatAround(home.cx + 1, home.cy + 1, 4 * mapScale(state)) > 0;
}

/** Defense: enemies close to the base pull everyone home (overrides offense). */
export function recallDefenders(state: GameState, player: Player): boolean {
  const home = homeBase(state, player);
  const combat = combatPool(state, player);
  if (!home || combat.length === 0) return false;
  applyCommands(state, [
    { type: 'ATTACK_MOVE', playerId: player.id, unitIds: combat.map((u) => u.id), cx: home.cx + 1, cy: home.cy + 1 },
  ]);
  return true;
}

/** Pull badly damaged units back home instead of feeding them to the grinder. */
export function retreatHurt(state: GameState, player: Player, params: AiParams): boolean {
  const home = homeBase(state, player);
  if (!home) return false;
  const combat = combatPool(state, player);
  const hurt = hurtUnitIds(combat, params.retreatPermille);
  if (hurt.size === 0) return false;
  // Idempotent: units already walking without a standing order are on their
  // retreat from a previous pass — re-issuing MOVE cost a full A* per unit
  // per pass (measured ~6 ms) for zero behavior change.
  const ids = combat
    .filter((u) => hurt.has(u.id) && !(u.order === null && u.path !== null))
    .map((u) => u.id);
  if (ids.length === 0) return false;
  applyCommands(state, [
    { type: 'MOVE', playerId: player.id, unitIds: ids, cx: home.cx + 1, cy: home.cy + 1 },
  ]);
  return true;
}

/**
 * Wave gate. Hard gates first — grace period, minimum army, cooldown — they
 * guard campaign pacing and must never soften. Behind them the utility score
 * decides whether NOW is a good moment (army ratio, target weakness, time
 * pressure). The AI_ATTACK_NOW mission trigger writes a negative
 * aiLastAttackTick; that marker forces the next wave regardless of score.
 */
export function attackGateOpen(
  state: GameState,
  player: Player,
  params: AiParams,
  inf: InfluenceView,
): boolean {
  if (
    state.tick < params.firstAttackTick ||
    combatPool(state, player).length < params.attackStrength ||
    state.tick - player.aiLastAttackTick < params.attackCooldown
  ) {
    return false;
  }
  if (player.aiLastAttackTick < 0) return true; // forced by mission trigger
  const home = homeBase(state, player);
  const hx = home ? home.cx : Math.floor(state.mapWidth / 2);
  const hy = home ? home.cy : Math.floor(state.mapHeight / 2);
  return attackScore(state, player, params, inf, hx, hy) >= params.attackThreshold;
}

/**
 * Offense: periodic waves — but raid the economy with a fraction of the force
 * (keep a reserve), and only go for the kill when clearly ahead or very late.
 * The wave attack-moves onto the least-defended ring cell around the target,
 * so it rolls in over the weak side of the enemy base instead of head-on.
 */
export function launchAttackWave(
  state: GameState,
  player: Player,
  params: AiParams,
  inf: InfluenceView,
): boolean {
  const combat = combatPool(state, player);
  if (combat.length === 0) return false;
  const home = homeBase(state, player);
  const enemyBuildings = state.buildings.filter(
    (b) => b.type !== 'WALL' && areEnemies(state, player.id, b.owner),
  ).length;
  const enemyCombat = state.units.filter(
    (u) => areEnemies(state, player.id, u.owner) && unitRule(u.type).weapon !== null,
  ).length;
  const finisher =
    enemyBuildings <= 2 ||
    state.tick > params.firstAttackTick + LATE_ESCALATION ||
    combat.length >= 2 * enemyCombat + 4;

  const target = pickAttackTarget(state, player, home, finisher, inf, params);
  if (!target) return false;
  const commitment = finisher ? 1000 : waveCommitmentPermille(state.tick, params.firstAttackTick);
  const hurt = home ? hurtUnitIds(combat, params.retreatPermille) : new Set<number>();
  const available = combat.filter((u) => !hurt.has(u.id)).map((u) => u.id);
  const n = Math.max(params.attackStrength, ((combat.length * commitment + 999) / 1000) | 0);
  const attackers = available.slice(0, n);
  if (attackers.length === 0) return false;
  player.aiLastAttackTick = state.tick;
  const center = buildingCenter(target);
  const approach = inf.lowestThreatRingCell(center.cx, center.cy, 3) ?? center;
  applyCommands(state, [
    { type: 'ATTACK_MOVE', playerId: player.id, unitIds: attackers, cx: approach.cx, cy: approach.cy },
  ]);
  return true;
}

/**
 * Amphibious assault (island maps): fill a transport with infantry, ferry it to
 * a beach on the enemy island and unload. The landed troops then join the next
 * ground wave via manageArmy. Best-effort — if boarding or a beach can't be
 * found, the AI's air force still carries the offense.
 */
export function manageInvasion(state: GameState, player: Player, params: AiParams): void {
  if (state.mapType !== 'ISLANDS' || params.navalCap === 0) return;
  if (state.tick < params.firstAttackTick) return;

  const transport = state.units.find((u) => u.owner === player.id && u.type === 'TRANSPORT');
  if (!transport) return;
  const enemyHome =
    state.buildings.find((b) => areEnemies(state, player.id, b.owner) && b.type === 'CONYARD') ??
    state.buildings.find((b) => areEnemies(state, player.id, b.owner));
  if (!enemyHome) return;

  const w = state.mapWidth;
  const tcx = transport.cell % w;
  const tcy = Math.floor(transport.cell / w);
  const pax = transport.passengers.length;

  // Board nearby infantry until full, unless troops are already walking
  // aboard. Engineers stay ashore: boarding overwrote their CAPTURE order and
  // trainInfantry kept replacing the "missing" engineer — an endless loop on
  // island maps with neutral capturables.
  const boarding = state.units.some((u) => u.owner === player.id && u.order?.kind === 'BOARD');
  if (pax < TRANSPORT_CAPACITY && transport.path === null && !boarding) {
    const inf = state.units
      .filter(
        (u) =>
          u.owner === player.id &&
          unitRule(u.type).category === 'infantry' &&
          u.type !== 'ENGINEER',
      )
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
  for (let r = 0; r <= 24 * mapScale(state); r++) {
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

/**
 * Fire a charged superweapon at the enemy's most valuable spot: building value
 * plus the economic influence around it, so a strike lands on the densest
 * cluster instead of always the first CONYARD in the array. The HQ keeps a
 * hefty bonus — it remains the prime target when nothing richer exists.
 */
export function manageSuperweapon(
  state: GameState,
  player: Player,
  params: AiParams,
  inf: InfluenceView,
): void {
  if (!params.useHighTech) return;
  if (state.tick < params.firstAttackTick) return; // grace period covers nukes too
  const charged = state.buildings.some(
    (b) =>
      b.owner === player.id &&
      buildingRule(b.type).superweapon !== null &&
      b.charge >= SUPERWEAPON_CHARGE_TICKS,
  );
  if (!charged) return;
  let target: Building | null = null;
  let bestScore = -0x7fffffff;
  for (const b of state.buildings) {
    if (b.type === 'WALL' || !areEnemies(state, player.id, b.owner)) continue;
    const center = buildingCenter(b);
    const score = (b.type === 'CONYARD' ? 1000 : raidBaseValue(b.type)) + inf.econAt(center.cx, center.cy);
    if (score > bestScore) {
      bestScore = score;
      target = b;
    }
  }
  if (!target) return;
  applyCommands(state, [
    { type: 'FIRE_SUPERWEAPON', playerId: player.id, cx: target.cx + 1, cy: target.cy + 1 },
  ]);
}

/** Drop paratroopers on the raid target once the (free) power is charged.
 *  No high-tech gate: every difficulty builds a Flugfeld anyway. */
export function manageParadrop(
  state: GameState,
  player: Player,
  params: AiParams,
  inf: InfluenceView,
): void {
  if (state.tick < params.firstAttackTick) return; // same grace period as nukes
  if (player.paradropCooldown > 0) return;
  if (!state.buildings.some((b) => b.owner === player.id && b.type === 'FLUGFELD')) return;
  const home = state.buildings.find((b) => b.owner === player.id && b.type === 'CONYARD');
  const target = pickAttackTarget(state, player, home, false, inf, params);
  if (!target) return;
  applyCommands(state, [
    { type: 'PARADROP', playerId: player.id, cx: target.cx + 1, cy: target.cy + 1 },
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
  const maxR = (buildingRule(type).onWater ? 16 : 8) * mapScale(state);
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
  for (let r = 0; r <= 6 * mapScale(state); r++) {
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
