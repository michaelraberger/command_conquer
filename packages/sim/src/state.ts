import type { SimEvent } from './events.js';
import { cellCenter, SUBCELL } from './fixed.js';
import {
  RESOURCE_GEMS,
  RESOURCE_ORE,
  cellIndex,
  clearArea,
  generateTerrain,
  stampResourcePatch,
} from './map.js';
import {
  FACTION_COLORS,
  buildingRule,
  unitRule,
  type AiDifficulty,
  type BuildingType,
  type Faction,
  type ProductionCategory,
  type SuperweaponKind,
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
  | { kind: 'REPAIR_BUILDING'; targetId: number };

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
  /** Render tint; lives in state so replays carry identical player setups. */
  color: number;
  credits: number;
  queues: Record<ProductionCategory, ProductionQueue>;
  /** AI scratch memory — plain data so it hashes/replays. */
  aiLastAttackTick: number;
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
  terrain: Uint8Array;
  /** Harvestable resource units per cell. */
  ore: Uint16Array;
  /** Permanent field kind per cell (RESOURCE_*) — depleted fields regrow. */
  resourceKind: Uint8Array;
  /** Unit id occupying/reserving each cell, 0 = free. */
  occupancy: Int32Array;
  /** Building id covering each cell, 0 = free. */
  structures: Int32Array;
  /** Per-player fog grids (see FOG_* constants). */
  fogs: Uint8Array[];
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
  if (state.occupancy[cell] !== 0 || state.structures[cell] !== 0) {
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
  };
  state.occupancy[cell] = unit.id;
  state.units.push(unit);
  return unit;
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
  };
  for (let y = cy; y < cy + rule.height; y++) {
    for (let x = cx; x < cx + rule.width; x++) {
      state.structures[cellIndex(state, x, y)] = building.id;
    }
  }
  state.buildings.push(building);
  return building;
}

/** The cell in front of a refinery where harvesters dock to unload. */
export function dockCell(building: Building): PathCell {
  const rule = buildingRule(building.type);
  return { cx: building.cx + 1, cy: building.cy + rule.height };
}

export const PLAYER_SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [16, 16],
  [46, 46],
];

export interface GameOptions {
  factions?: [Faction, Faction];
  /** Player 1 is controlled by the built-in AI. */
  ai?: boolean;
  aiDifficulty?: AiDifficulty;
  mapWidth?: number;
  mapHeight?: number;
}

export function createGame(seed: number, options: GameOptions = {}): GameState {
  const mapWidth = options.mapWidth ?? 64;
  const mapHeight = options.mapHeight ?? 64;
  const factions = options.factions ?? ['ALLIES', 'SOVIETS'];
  const size = mapWidth * mapHeight;

  const makePlayer = (id: number, name: string, color: number): Player => ({
    id,
    name,
    faction: factions[id as 0 | 1],
    isAi: id === 1 && options.ai === true,
    difficulty: options.aiDifficulty ?? 'normal',
    color,
    credits: 5000,
    queues: { building: emptyQueue(), infantry: emptyQueue(), vehicle: emptyQueue() },
    aiLastAttackTick: 0,
  });

  const state: GameState = {
    tick: 0,
    seed: seed >>> 0,
    rngState: seed >>> 0,
    nextEntityId: 1,
    winner: -1,
    mapWidth,
    mapHeight,
    terrain: new Uint8Array(0),
    ore: new Uint16Array(size),
    resourceKind: new Uint8Array(size),
    occupancy: new Int32Array(size),
    structures: new Int32Array(size),
    fogs: [new Uint8Array(size), new Uint8Array(size)],
    players: [
      makePlayer(0, 'Spieler', FACTION_COLORS[factions[0]]),
      makePlayer(1, 'Gegner', FACTION_COLORS[factions[1]]),
    ],
    units: [],
    buildings: [],
    projectiles: [],
    strikes: [],
    events: [],
  };

  state.terrain = generateTerrain(mapWidth, mapHeight, state);
  for (const [sx, sy] of PLAYER_SPAWNS) {
    clearArea(state.terrain, mapWidth, sx, sy, 4);
  }
  // Ore fields: one per spawn plus a rich contested one in the middle.
  stampResourcePatch(state, state, 23, 17, 2, RESOURCE_ORE);
  stampResourcePatch(state, state, 39, 45, 2, RESOURCE_ORE);
  stampResourcePatch(state, state, 32, 32, 3, RESOURCE_ORE);
  // Gem fields ("Edelsteine", double value): mirrored off-center prizes.
  stampResourcePatch(state, state, 20, 44, 1, RESOURCE_GEMS);
  stampResourcePatch(state, state, 44, 20, 1, RESOURCE_GEMS);

  // Symmetric starts: construction yard, harvester, small guard force.
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
    fogs: number[][];
  };
  return {
    ...raw,
    terrain: Uint8Array.from(raw.terrain),
    ore: Uint16Array.from(raw.ore),
    resourceKind: Uint8Array.from(raw.resourceKind),
    occupancy: Int32Array.from(raw.occupancy),
    structures: Int32Array.from(raw.structures),
    fogs: raw.fogs.map((f) => Uint8Array.from(f)),
  };
}
