import { validateCustomMap, type CustomMapData } from './customMap.js';
import type { SimEvent } from './events.js';
import { cellCenter, SUBCELL } from './fixed.js';
import {
  INFANTRY_STACK,
  RESOURCE_GEMS,
  RESOURCE_ORE,
  TERRAIN_BRIDGE,
  cellIndex,
  clearArea,
  generateTerrain,
  isInfantryType,
  reserveCell,
  spawnCenters,
  stampResourcePatch,
  type MapType,
} from './map.js';
import {
  FACTION_COLORS,
  PARADROP_COOLDOWN_TICKS,
  STARTING_CREDITS,
  applyBalance,
  buildingRule,
  unitRule,
  type AiDifficulty,
  type BalanceConfig,
  type BuildingType,
  type Faction,
  type ProductionCategory,
  type SuperweaponKind,
  type TechId,
  type UnitType,
} from './rules.js';

export interface PathCell {
  cx: number;
  cy: number;
}

export type UnitOrder =
  | { kind: 'ATTACK'; targetId: number }
  | { kind: 'ATTACK_MOVE'; cx: number; cy: number }
  | { kind: 'HARVEST'; cx: number; cy: number }
  | { kind: 'RETURN_ORE'; backCx: number; backCy: number }
  | { kind: 'REPAIR_BUILDING'; targetId: number }
  | { kind: 'REPAIR_UNIT'; targetId: number }
  | { kind: 'BOARD'; targetId: number }
  | { kind: 'INFILTRATE'; targetId: number }
  | { kind: 'CAPTURE'; targetId: number }
  /** Engineer rebuilds a collapsed bridge cell (TERRAIN_BRIDGE_WRECK). */
  | { kind: 'REPAIR_BRIDGE'; cx: number; cy: number }
  | { kind: 'PARADROP'; cx: number; cy: number }
  /** Stand fast: fire at enemies in range but never move — not even when the
   *  base is under attack (defenseReaction only touches order-less units). */
  | { kind: 'HOLD' }
  /** Shuttle between (ax,ay) and (bx,by), fighting whatever crosses the route. */
  | { kind: 'PATROL'; ax: number; ay: number; bx: number; by: number; leg: 0 | 1 }
  /** Stick with an own unit and fight off whatever threatens the escort. */
  | { kind: 'ESCORT'; targetId: number };

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  /** Fixed-point world position (sub-cells, see fixed.ts). */
  x: number;
  y: number;
  hp: number;
  /** 0..15, see FACING_VECTORS. */
  facing: number;
  /** Index of the cell this unit occupies/has reserved in the occupancy grid. */
  cell: number;
  path: PathCell[] | null;
  pathIndex: number;
  blockedTicks: number;
  repathCount: number;
  order: UnitOrder | null;
  /** Ticks until the weapon may fire again. */
  cooldown: number;
  /** Ore credits on board (harvesters only). */
  cargo: number;
  /** Ground units riding inside (transport ships only). They are removed from
   *  state.units while aboard and sink with the ship. */
  passengers: Unit[];
  /** Iron curtain: remaining ticks of invulnerability (0 = none). */
  curtainTicks: number;
  /** Combat aircraft: shots left this sortie (0 for everyone else). Empty
   *  planes fly home and rearm at their pad/airfield (see airbaseSystem). */
  ammo: number;
  /** Airfield-bound jets: id of the Flugfeld this jet belongs to. Absent for
   *  all other units and for jets from pre-Flugfeld saves (orphans: they fly
   *  and fight but never rearm and never crash with a field). */
  homeId?: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  owner: number;
  /** Top-left cell of the footprint. */
  cx: number;
  cy: number;
  hp: number;
  /** Fixed-point center of the footprint (for targeting/aiming). */
  x: number;
  y: number;
  /** Rally cell for produced units, -1 = none. */
  rallyCx: number;
  rallyCy: number;
  /** Upgrade tier ("Ausbaustufe"), currently used by walls. */
  level: number;
  /** Ticks until a defense weapon may fire again. */
  cooldown: number;
  /** Superweapon charge in ticks (silos only). */
  charge: number;
  /** Iron curtain: remaining ticks of invulnerability (0 = none). */
  curtainTicks: number;
  /** In-place upgrade in progress (Wachturm → AGT, Kraftwerk → Fortschr.):
   *  the building keeps working as its current type until `progress` reaches the
   *  target's buildTime, then becomes `to`. null/absent = not upgrading. */
  upgrade?: { to: BuildingType; progress: number } | null;
}

/** A superweapon on its way to impact. */
export interface Strike {
  id: number;
  kind: SuperweaponKind;
  owner: number;
  /** Fixed-point impact point. */
  x: number;
  y: number;
  /** Ticks until detonation. */
  countdown: number;
}

export interface Projectile {
  id: number;
  owner: number;
  /** Shooter's unit type — weapon stats are looked up from rules. */
  srcType: UnitType;
  x: number;
  y: number;
  targetId: number;
  /** Launch position — where defenders rally to when the shot lands (AGGRO).
   *  Optional so pre-existing saves without it still deserialize. */
  sx?: number;
  sy?: number;
}

export interface ProductionQueue {
  /** UnitType or BuildingType currently in production, null = idle. */
  item: string | null;
  /** Ticks of build time completed (and paid for). */
  progress: number;
  /** Building finished, waiting for the player to place it. */
  ready: boolean;
}

export interface Player {
  id: number;
  name: string;
  faction: Faction;
  /** Command generator runs for this player inside the sim (see ai/). */
  isAi: boolean;
  difficulty: AiDifficulty;
  /** Alliance: players on the same team never target each other. The human is
   *  team 0, every AI opponent shares team 1 (they gang up, not free-for-all). */
  team: number;
  /** Render tint; lives in state so replays carry identical player setups. */
  color: number;
  /** Gave up (SURRENDER command, e.g. dropped from an internet match): no
   *  longer counts as alive for victory; units/buildings remain standing but
   *  uncontrolled. Optional so pre-existing saves deserialize (undefined =
   *  not surrendered); always initialized to false for stable hashing. */
  surrendered?: boolean;
  credits: number;
  queues: Record<ProductionCategory, ProductionQueue>;
  /** Primary producer per unit category: finished units spawn at this
   *  building. Set by SET_RALLY (classic primary-building behavior); stale or
   *  missing entries fall back to the first matching producer. Optional so
   *  pre-existing saves deserialize; always initialized to {} for stable
   *  hashing. */
  primaryBuildings?: Partial<Record<ProductionCategory, number>>;
  /** AI scratch memory — plain data so it hashes/replays. */
  aiLastAttackTick: number;
  /** Paradrop: ticks until ready; counts down only while a Flugfeld stands. */
  paradropCooldown: number;
  /** Cheat: the whole map stays visible for this player. */
  mapRevealed: boolean;
  /** Cheat: flat extra power added to the balance. */
  powerBonus: number;
  /** Cheat (motherload): unlock every unit/building of the faction, top up
   *  credits + power to effectively unlimited each tick and (via mapRevealed,
   *  set alongside) keep the whole map visible. */
  motherload: boolean;
  /** Completed technologies (see TECH_RULES). Plain sorted array for replay. */
  researched: TechId[];
  /** Tech being researched right now (drains credits over time), or null. */
  research: { tech: TechId; progress: number } | null;
}

/** Fog states per cell: 0 = hidden, 1 = explored, 2 = visible. */
export const FOG_HIDDEN = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;

export interface GameState {
  tick: number;
  seed: number;
  rngState: number;
  nextEntityId: number;
  /** Winning player id, -1 while the game is running. */
  winner: number;
  mapWidth: number;
  mapHeight: number;
  /** Layout this game was generated with (BADLANDS/RIVER/ISLANDS). Read by the
   *  AI to decide when it needs air/naval to cross water. */
  mapType: MapType;
  terrain: Uint8Array;
  /** Harvestable resource units per cell. */
  ore: Uint16Array;
  /** Permanent field kind per cell (RESOURCE_*) — depleted fields regrow. */
  resourceKind: Uint8Array;
  /** Per cell: 0 = free, +id = vehicle/ship, -n = n infantry sharing the
   *  tile (see the occupancy helpers in map.ts). */
  occupancy: Int32Array;
  /** Building id covering each cell, 0 = free. */
  structures: Int32Array;
  /** Gate cells: owner id + 1 (0 = no gate). Own gates open for their owner. */
  gateOwner: Int32Array;
  /** Per-player fog grids (see FOG_* constants). */
  fogs: Uint8Array[];
  /** Base/island centre cell per player id (camera home, victory context). */
  spawns: ReadonlyArray<readonly [number, number]>;
  players: Player[];
  units: Unit[];
  buildings: Building[];
  projectiles: Projectile[];
  strikes: Strike[];
  /** Presentation events of the current tick (see events.ts). */
  events: SimEvent[];
}

function emptyQueue(): ProductionQueue {
  return { item: null, progress: 0, ready: false };
}

export function spawnUnit(
  state: GameState,
  type: UnitType,
  owner: number,
  cx: number,
  cy: number,
): Unit {
  const cell = cellIndex(state, cx, cy);
  const isAir = unitRule(type).air === true;
  // Aircraft fly over everything, so they never claim a ground cell.
  // Infantry may spawn into a not-yet-full pack on the cell.
  const occ = state.occupancy[cell]!;
  const spawnBlocked = isInfantryType(type)
    ? occ > 0 || occ <= -INFANTRY_STACK
    : occ !== 0;
  if (!isAir && (spawnBlocked || state.structures[cell] !== 0)) {
    throw new Error(`spawn cell ${cx},${cy} occupied`);
  }
  const unit: Unit = {
    id: state.nextEntityId++,
    type,
    owner,
    x: cellCenter(cx),
    y: cellCenter(cy),
    hp: unitRule(type).maxHp,
    facing: 12,
    cell,
    path: null,
    pathIndex: 0,
    blockedTicks: 0,
    repathCount: 0,
    order: null,
    cooldown: 0,
    cargo: 0,
    passengers: [],
    curtainTicks: 0,
    ammo: unitRule(type).ammo ?? 0,
  };
  if (!isAir) reserveCell(state, unit, cell);
  state.units.push(unit);
  return unit;
}

/**
 * Creates a unit directly into a carrier's `passengers` array: full field init
 * like spawnUnit, but no occupancy claim and not in state.units — so it dies
 * silently with its carrier (deathSystem only sweeps state.units). Position
 * fields are placeholders; the drop/unload code rewrites x/y/cell on landing.
 */
export function createPassenger(
  state: GameState,
  type: UnitType,
  owner: number,
  cx: number,
  cy: number,
): Unit {
  return {
    id: state.nextEntityId++,
    type,
    owner,
    x: cellCenter(cx),
    y: cellCenter(cy),
    hp: unitRule(type).maxHp,
    facing: 12,
    cell: cellIndex(state, cx, cy),
    path: null,
    pathIndex: 0,
    blockedTicks: 0,
    repathCount: 0,
    order: null,
    cooldown: 0,
    cargo: 0,
    passengers: [],
    curtainTicks: 0,
    ammo: unitRule(type).ammo ?? 0,
  };
}

/** Creates a building and stamps its footprint into the structures grid. */
export function constructBuilding(
  state: GameState,
  type: BuildingType,
  owner: number,
  cx: number,
  cy: number,
): Building {
  const rule = buildingRule(type);
  const building: Building = {
    id: state.nextEntityId++,
    type,
    owner,
    cx,
    cy,
    hp: rule.maxHp,
    x: cx * SUBCELL + (rule.width * SUBCELL) / 2,
    y: cy * SUBCELL + (rule.height * SUBCELL) / 2,
    rallyCx: -1,
    rallyCy: -1,
    level: 1,
    cooldown: 0,
    charge: 0,
    curtainTicks: 0,
  };
  // Bridge spans never enter the structures grid: ground units drive over
  // them and ships sail beneath — the span is only a damage target.
  if (type !== 'BRIDGE') {
    for (let y = cy; y < cy + rule.height; y++) {
      for (let x = cx; x < cx + rule.width; x++) {
        const idx = cellIndex(state, x, y);
        state.structures[idx] = building.id;
        if (type === 'GATE') state.gateOwner[idx] = owner + 1;
      }
    }
  }
  state.buildings.push(building);
  return building;
}

/**
 * Ensures every TERRAIN_BRIDGE cell carries a neutral, destructible BRIDGE
 * span (classic C&C: force-fire drops the bridge). Idempotent — called at
 * game creation and after loading saves from before spans existed.
 */
export function spawnBridgeSpans(state: GameState): void {
  const spanned = new Set<number>();
  for (const b of state.buildings) {
    if (b.type === 'BRIDGE') spanned.add(cellIndex(state, b.cx, b.cy));
  }
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const idx = cellIndex(state, cx, cy);
      if (state.terrain[idx] !== TERRAIN_BRIDGE || spanned.has(idx)) continue;
      constructBuilding(state, 'BRIDGE', NEUTRAL_OWNER, cx, cy);
    }
  }
}

/** The cell in front of a refinery where harvesters dock to unload. */
export function dockCell(building: Building): PathCell {
  const rule = buildingRule(building.type);
  return { cx: building.cx + 1, cy: building.cy + rule.height };
}

/** Classic two-player spawn centres; the actual game uses state.spawns. */
export const PLAYER_SPAWNS: ReadonlyArray<readonly [number, number]> = spawnCenters(2);

/** Distinct AI tints (never blue/red, so they don't clash with a faction). */
const AI_COLORS: readonly number[] = [0x5fd873, 0xff8a3a, 0xb98cff, 0x35c4c4, 0xf2d33c];

/** Fixed seat tints for multiplayer (FFA): distinct even when two players pick
 *  the same faction; seat order = lobby order, identical on every client. */
const MP_COLORS: readonly number[] = [0x3aa0ff, 0xe04a3a, 0x5fd873, 0xf2d33c];

/** One human seat in an internet match (lobby order = player id). */
export interface MultiplayerSeat {
  faction: Faction;
  /** Display name from the lobby — part of the serialized state, so it MUST
   *  be identical on every client (comes from the host's start payload). */
  name: string;
}

export interface GameOptions {
  /** Per-player factions; index 0 is the human. Missing entries alternate. */
  factions?: Faction[];
  /** Number of AI opponents (1–5). Total players = 1 + opponents. */
  opponents?: number;
  /** Players 1..N are controlled by the built-in AI. */
  ai?: boolean;
  aiDifficulty?: AiDifficulty;
  /** Map layout (default BADLANDS). */
  mapType?: MapType;
  mapWidth?: number;
  mapHeight?: number;
  /** Balance overrides (balance.json) applied to the rules for this game. */
  balance?: BalanceConfig | undefined;
  /**
   * Hand-authored map (editor). When set, terrain/ore/spawns come from the map
   * instead of the procedural generator; mapType/mapWidth/mapHeight are ignored
   * and the opponent count is capped at `customMap.spawns.length - 1`.
   */
  customMap?: CustomMapData | undefined;
  /**
   * Internet match (lockstep): one entry per human seat, player id = array
   * index, every seat on its OWN team (FFA). Overrides factions/opponents/ai.
   * Every client must pass the identical seats array (host's start payload)
   * or the sims diverge immediately.
   */
  multiplayer?: { seats: readonly MultiplayerSeat[] } | undefined;
}

/** Owner id of neutral map structures (Erz-Bohrturm): no Player record exists
 *  for it, so it never counts for victory, fog, power or storage. */
export const NEUTRAL_OWNER = -1;

/** Two owners are enemies unless they share a team (self is never an enemy).
 *  A missing player record (neutral structures, owner -1) is hostile to NO
 *  one — auto-targeting ignores neutrals; only explicit attacks touch them. */
export function areEnemies(state: GameState, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = state.players[a];
  const pb = state.players[b];
  if (!pa || !pb) return false;
  return pa.team !== pb.team;
}

const otherFaction = (f: Faction): Faction => (f === 'ALLIES' ? 'SOVIETS' : 'ALLIES');

/** Total ore-storage capacity of a player = sum of their buildings' storage. */
export function storageCapacity(state: GameState, owner: number): number {
  let cap = 0;
  for (const b of state.buildings) {
    if (b.owner === owner) cap += buildingRule(b.type).storage ?? 0;
  }
  return cap;
}

/**
 * Credits "held" in one storage building — its share of the owner's stored ore,
 * i.e. `min(credits, capacity) * thisStorage / capacity`. This is the amount
 * forfeited when the building is destroyed, or stolen when it is infiltrated.
 */
export function storedInBuilding(state: GameState, building: Building): number {
  const bStorage = buildingRule(building.type).storage ?? 0;
  if (bStorage <= 0) return 0;
  const cap = storageCapacity(state, building.owner);
  const player = state.players[building.owner];
  if (cap <= 0 || !player) return 0;
  const effective = Math.min(player.credits, cap);
  return Math.floor((effective * bStorage) / cap);
}

export function createGame(seed: number, options: GameOptions = {}): GameState {
  applyBalance(options.balance); // resets to defaults when no config is given
  const customMap = options.customMap;
  if (customMap) {
    const check = validateCustomMap(customMap);
    if (!check.ok) throw new Error(`Ungültige Karte: ${check.errors.join(' ')}`);
  }
  const mapWidth = customMap?.width ?? options.mapWidth ?? 64;
  const mapHeight = customMap?.height ?? options.mapHeight ?? 64;
  const size = mapWidth * mapHeight;
  const mapType = customMap?.mapType ?? options.mapType ?? 'BADLANDS';

  const seats = options.multiplayer?.seats;
  const maxPlayers = customMap ? customMap.spawns.length : 6;
  const playerCount = Math.max(
    2,
    Math.min(maxPlayers, seats ? seats.length : 1 + (options.opponents ?? 1)),
  );
  const spawns = customMap
    ? customMap.spawns.slice(0, playerCount).map(([x, y]) => [x, y] as const)
    : spawnCenters(playerCount, mapWidth, mapHeight);
  const humanFaction = options.factions?.[0] ?? 'ALLIES';
  // AIs alternate factions for variety; team 1 gangs up on the human (team 0).
  const factionFor = (id: number): Faction =>
    options.factions?.[id] ?? (id === 0 ? humanFaction : id % 2 === 1 ? otherFaction(humanFaction) : humanFaction);

  const makePlayer = (id: number): Player => ({
    id,
    // Multiplayer seats: every player is human, on their own team (FFA), with
    // a fixed per-seat tint — identical on every client by construction.
    name: seats
      ? seats[id]!.name
      : id === 0
        ? 'Spieler'
        : playerCount > 2
          ? `Gegner ${id}`
          : 'Gegner',
    faction: seats ? seats[id]!.faction : factionFor(id),
    isAi: !seats && id !== 0 && options.ai === true,
    difficulty: options.aiDifficulty ?? 'normal',
    team: seats ? id : id === 0 ? 0 : 1,
    color: seats
      ? MP_COLORS[id % MP_COLORS.length]!
      : id === 0
        ? FACTION_COLORS[humanFaction]
        : AI_COLORS[(id - 1) % AI_COLORS.length]!,
    surrendered: false,
    credits: STARTING_CREDITS,
    queues: {
      building: emptyQueue(),
      infantry: emptyQueue(),
      vehicle: emptyQueue(),
      air: emptyQueue(),
      naval: emptyQueue(),
    },
    primaryBuildings: {},
    aiLastAttackTick: 0,
    paradropCooldown: PARADROP_COOLDOWN_TICKS,
    mapRevealed: false,
    powerBonus: 0,
    motherload: false,
    researched: [],
    research: null,
  });

  const state: GameState = {
    tick: 0,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    nextEntityId: 1,
    winner: -1,
    mapWidth,
    mapHeight,
    mapType,
    terrain: new Uint8Array(0),
    ore: new Uint16Array(size),
    resourceKind: new Uint8Array(size),
    occupancy: new Int32Array(size),
    structures: new Int32Array(size),
    gateOwner: new Int32Array(size),
    fogs: Array.from({ length: playerCount }, () => new Uint8Array(size)),
    spawns,
    players: Array.from({ length: playerCount }, (_, id) => makePlayer(id)),
    units: [],
    buildings: [],
    projectiles: [],
    strikes: [],
    events: [],
  };

  if (customMap) {
    // Authored map: copy the layers (createGame mutates terrain when placing
    // buildings, so never alias the source) and skip generation/stamping
    // entirely — the author's layout is used verbatim. clearArea is skipped
    // too: validateCustomMap already guarantees open ground around spawns.
    state.terrain = Uint8Array.from(customMap.terrain);
    state.ore = Uint16Array.from(customMap.ore);
    state.resourceKind = Uint8Array.from(customMap.resourceKind);
  } else {
    state.terrain = generateTerrain(mapWidth, mapHeight, state, mapType, spawns);
    for (const [sx, sy] of spawns) clearArea(state.terrain, mapWidth, sx, sy, 4);
  }

  if (!customMap && playerCount === 2 && mapWidth === 64 && mapHeight === 64) {
    // Classic hand-tuned 1v1 setup (kept byte-for-byte so existing maps/tests
    // are unchanged); the N-player generator below runs for 3+ players or any
    // non-default map size.
    if (mapType === 'ISLANDS') {
      stampResourcePatch(state, state, 23, 17, 2, RESOURCE_ORE);
      stampResourcePatch(state, state, 39, 45, 2, RESOURCE_ORE);
      stampResourcePatch(state, state, 32, 32, 2, RESOURCE_ORE);
      stampResourcePatch(state, state, 22, 10, 1, RESOURCE_GEMS);
      stampResourcePatch(state, state, 40, 52, 1, RESOURCE_GEMS);
    } else {
      stampResourcePatch(state, state, 23, 17, 2, RESOURCE_ORE);
      stampResourcePatch(state, state, 39, 45, 2, RESOURCE_ORE);
      stampResourcePatch(state, state, 32, 32, 3, RESOURCE_ORE);
      stampResourcePatch(state, state, 20, 44, 1, RESOURCE_GEMS);
      stampResourcePatch(state, state, 44, 20, 1, RESOURCE_GEMS);
    }
    constructBuilding(state, 'CONYARD', 0, 13, 13);
    spawnUnit(state, 'TANK', 0, 17, 13);
    spawnUnit(state, 'TANK', 0, 18, 13);
    spawnUnit(state, 'RIFLEMAN', 0, 13, 18);
    spawnUnit(state, 'RIFLEMAN', 0, 14, 18);
    spawnUnit(state, 'HARVESTER', 0, 19, 17);
    constructBuilding(state, 'CONYARD', 1, 45, 44);
    spawnUnit(state, 'TANK', 1, 44, 43);
    spawnUnit(state, 'TANK', 1, 44, 44);
    spawnUnit(state, 'RIFLEMAN', 1, 48, 48);
    spawnUnit(state, 'RIFLEMAN', 1, 49, 48);
    spawnUnit(state, 'HARVESTER', 1, 43, 47);
    spawnBridgeSpans(state); // river-map bridge cells need their spans too
    return state;
  }

  if (!customMap) {
    // 3+ players (or any non-default map size): one ore field beside each base,
    // biased toward the contested middle, plus a central prize and two gem fields.
    // All anchors scale with the map size (64² reference).
    const midX = Math.round(mapWidth / 2);
    const midY = Math.round(mapHeight / 2);
    const offX = Math.max(3, Math.round((mapWidth * 5) / 64));
    const offY = Math.max(3, Math.round((mapHeight * 5) / 64));
    const toward = (v: number, mid: number, off: number): number =>
      v === mid ? off : Math.sign(mid - v) * off;
    for (const [cx, cy] of spawns) {
      stampResourcePatch(state, state, cx + toward(cx, midX, offX), cy + toward(cy, midY, offY), 2, RESOURCE_ORE);
    }
    const centreTaken = spawns.some(([x, y]) => Math.abs(x - midX) <= 8 && Math.abs(y - midY) <= 8);
    stampResourcePatch(state, state, midX, midY, mapType === 'ISLANDS' ? 2 : 3, RESOURCE_ORE);
    if (!centreTaken || mapType !== 'ISLANDS') {
      stampResourcePatch(state, state, Math.round((mapWidth * 29) / 64), Math.round((mapHeight * 35) / 64), 1, RESOURCE_GEMS);
      stampResourcePatch(state, state, Math.round((mapWidth * 35) / 64), Math.round((mapHeight * 29) / 64), 1, RESOURCE_GEMS);
    }
  }

  // Construction yard, harvester and a small guard force at each base.
  for (let id = 0; id < playerCount; id++) {
    const [cx, cy] = spawns[id]!;
    constructBuilding(state, 'CONYARD', id, cx - 1, cy - 1);
    spawnUnit(state, 'TANK', id, cx + 3, cy - 1);
    spawnUnit(state, 'TANK', id, cx + 3, cy);
    spawnUnit(state, 'RIFLEMAN', id, cx - 1, cy + 3);
    spawnUnit(state, 'RIFLEMAN', id, cx, cy + 3);
    spawnUnit(state, 'HARVESTER', id, cx + 3, cy + 2);
  }

  // Neutral structures authored into the map (Erz-Bohrturm): owner -1, no
  // player record — capturable by engineers, ignored by auto-targeting.
  for (const nb of customMap?.neutralBuildings ?? []) {
    constructBuilding(state, nb.type as BuildingType, NEUTRAL_OWNER, nb.cx, nb.cy);
  }

  // Destructible neutral span on every authored bridge cell.
  spawnBridgeSpans(state);

  return state;
}

/** Canonical JSON serialization (typed arrays as plain arrays). */
export function serialize(state: GameState): string {
  return JSON.stringify({
    ...state,
    terrain: Array.from(state.terrain),
    ore: Array.from(state.ore),
    resourceKind: Array.from(state.resourceKind),
    occupancy: Array.from(state.occupancy),
    structures: Array.from(state.structures),
    gateOwner: Array.from(state.gateOwner),
    fogs: state.fogs.map((f) => Array.from(f)),
  });
}

export function deserialize(json: string): GameState {
  const raw = JSON.parse(json) as GameState & {
    terrain: number[];
    ore: number[];
    resourceKind: number[];
    occupancy: number[];
    structures: number[];
    gateOwner: number[];
    fogs: number[][];
  };
  // Saves from before the primary-building field: default it in.
  for (const p of raw.players) {
    if (!p.primaryBuildings) p.primaryBuildings = {};
  }
  // Saves from before the aircraft-ammo field: top the planes up on load.
  for (const u of raw.units) {
    if (typeof u.ammo !== 'number') u.ammo = unitRule(u.type).ammo ?? 0;
    for (const p of u.passengers) {
      if (typeof p.ammo !== 'number') p.ammo = unitRule(p.type).ammo ?? 0;
    }
  }
  // NOTE: no bridge-span retrofit here — deserialize(serialize(s)) must
  // reproduce s exactly (lockstep resync depends on it). Saves from before
  // destructible bridges simply keep their spans-less, indestructible decks.
  return {
    ...raw,
    terrain: Uint8Array.from(raw.terrain),
    ore: Uint16Array.from(raw.ore),
    resourceKind: Uint8Array.from(raw.resourceKind),
    occupancy: Int32Array.from(raw.occupancy),
    structures: Int32Array.from(raw.structures),
    gateOwner: Int32Array.from(raw.gateOwner),
    fogs: raw.fogs.map((f) => Uint8Array.from(f)),
  };
}
