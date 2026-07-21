import { validateCustomMap, type CustomMapData } from './customMap.js';
import {
  TERRAIN_WATER,
  cellIndex,
  inBounds,
  isBuildableKind,
  isNavigableWater,
  isPassableKind,
  isPassableTerrain,
  type GridView,
} from './map.js';
import { findPath } from './path/astar.js';
import {
  FACTIONS,
  buildingRule,
  isBuildingType,
  isUnitType,
  unitRule,
  type AiDifficulty,
  type BuildingType,
  type Faction,
  type UnitType,
} from './rules.js';
import type { GameState, Unit } from './state.js';

/**
 * Campaign missions ("Kampagne"): a MissionDef describes one scripted match —
 * map, players, starting forces, objectives and one-shot triggers. The def is
 * authored client-side; everything the running sim needs (objective/trigger
 * status) is copied into GameState.mission at createGame, so saves are
 * self-contained and lockstep rules keep holding. The sim stores only stable
 * IDs — all human-readable text lives in the client.
 */

/** Per-mission AI tuning overrides, merged over DIFFICULTY_PARAMS (see ai/). */
export interface AiTuning {
  interval?: number;
  firstAttackTick?: number;
  attackStrength?: number;
  attackCooldown?: number;
  riflemenCap?: number;
  vehicleCap?: number;
  airCap?: number;
  navalCap?: number;
  useHighTech?: boolean;
  incomeBonus?: number;
}

/** Standing order a placed/spawned unit starts with. */
export type PlacementOrder =
  | { kind: 'MOVE'; cx: number; cy: number }
  | { kind: 'ATTACK_MOVE'; cx: number; cy: number }
  | { kind: 'HOLD' };

export interface MissionUnitPlacement {
  type: UnitType;
  /** Player id (index into MissionDef.players). Units are never neutral. */
  owner: number;
  cx: number;
  cy: number;
  /** Referenced by objectives/triggers; stored on the entity. */
  tag?: string;
  order?: PlacementOrder;
}

export interface MissionBuildingPlacement {
  type: BuildingType;
  /** Player id, or -1 for a neutral (capturable) structure. */
  owner: number;
  cx: number;
  cy: number;
  tag?: string;
}

export interface MissionPlayerDef {
  faction: Faction;
  /** Player 0 (the human) is team 0 by convention; allied AIs may join it. */
  team: number;
  credits: number;
  /** false on an enemy team = static garrison: units defend via auto-aggro
   *  but the player never builds or launches attacks (RA2 commando feel). */
  isAi: boolean;
  aiDifficulty?: AiDifficulty;
  aiTuning?: AiTuning;
  name?: string;
  color?: number;
}

/** Objective status values — small ints for compact, stable hashing. */
export const OBJ_HIDDEN = 0;
export const OBJ_ACTIVE = 1;
export const OBJ_COMPLETE = 2;
export const OBJ_FAILED = 3;

export type ObjectiveSpec =
  /** Every player on an enemy team has neither units nor (non-wall) buildings. */
  | { kind: 'DESTROY_ALL_ENEMIES' }
  /** No living entity carries the tag any more. */
  | { kind: 'DESTROY_TAG'; tag: string }
  /** All tagged buildings are owned by the human team; FAILS if one dies. */
  | { kind: 'CAPTURE_TAG'; tag: string }
  /** Completes when the sim reaches this tick. */
  | { kind: 'SURVIVE_UNTIL'; tick: number }
  /** Fails if any tagged entity dies; auto-completes on mission win. */
  | { kind: 'PROTECT_TAG'; tag: string }
  /** A human-team unit (with the tag, if given) stands inside the rect. */
  | { kind: 'REACH_AREA'; tag?: string; cx: number; cy: number; w: number; h: number };

export interface MissionObjectiveDef {
  /** Stable id, e.g. 'primary-1' — the client maps it to German text. */
  id: string;
  spec: ObjectiveSpec;
  /** Bonus objective: tracked and shown, but never gates win/lose. */
  optional?: boolean;
  /** Starts hidden; a REVEAL_OBJECTIVE trigger activates it later. */
  hidden?: boolean;
}

export type TriggerCondition =
  | { kind: 'AT_TICK'; tick: number }
  | { kind: 'OBJECTIVE_STATUS'; objectiveId: string; status: number }
  /** No living entity carries the tag any more. */
  | { kind: 'TAG_DEAD'; tag: string }
  /** Any unit of a player on `team` stands inside the rect. */
  | { kind: 'AREA_ENTERED'; team: number; cx: number; cy: number; w: number; h: number };

export type TriggerAction =
  /** Reinforcements/attack waves; blocked cells fall back to a ring search. */
  | { kind: 'SPAWN'; units: MissionUnitPlacement[] }
  | { kind: 'GRANT_CREDITS'; player: number; amount: number }
  /** Client shows the text mapped to msgId (SimEvent MISSION_MESSAGE). */
  | { kind: 'MESSAGE'; msgId: string }
  | { kind: 'REVEAL_OBJECTIVE'; objectiveId: string }
  /** Opens the attack gates of an AI player right now. */
  | { kind: 'AI_ATTACK_NOW'; player: number }
  /** Stamps FOG_EXPLORED for `player` in a radius around the cell. */
  | { kind: 'REVEAL_AREA'; player: number; cx: number; cy: number; radius: number }
  | { kind: 'WIN' }
  | { kind: 'LOSE' };

export interface MissionTriggerDef {
  id: string;
  when: TriggerCondition;
  actions: TriggerAction[];
}

export interface MissionDef {
  /** Stable mission id, e.g. 'allies-03'. */
  id: string;
  map: CustomMapData;
  /** Index = player id; player 0 is the human. */
  players: MissionPlayerDef[];
  units: MissionUnitPlacement[];
  buildings: MissionBuildingPlacement[];
  objectives: MissionObjectiveDef[];
  triggers: MissionTriggerDef[];
}

/** Runtime objective — spec embedded so saves are self-contained. */
export interface ObjectiveState {
  id: string;
  spec: ObjectiveSpec;
  optional: boolean;
  /** OBJ_HIDDEN/ACTIVE/COMPLETE/FAILED. */
  status: number;
}

export interface TriggerState {
  id: string;
  when: TriggerCondition;
  actions: TriggerAction[];
  fired: boolean;
}

/** Lives on GameState.mission; absent = skirmish/multiplayer game. */
export interface MissionState {
  missionId: string;
  objectives: ObjectiveState[];
  triggers: TriggerState[];
}

export interface MissionValidation {
  ok: boolean;
  errors: string[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** All tags carried by mission placements (initial or trigger-spawned). */
function placedTags(def: MissionDef): Set<string> {
  const tags = new Set<string>();
  for (const u of def.units) if (u.tag !== undefined) tags.add(u.tag);
  for (const b of def.buildings) if (b.tag !== undefined) tags.add(b.tag);
  for (const t of def.triggers) {
    for (const a of t.actions) {
      if (a.kind === 'SPAWN') for (const u of a.units) if (u.tag !== undefined) tags.add(u.tag);
    }
  }
  return tags;
}

function checkUnitPlacement(
  def: MissionDef,
  u: MissionUnitPlacement,
  label: string,
  errors: string[],
): void {
  const map = def.map;
  if (!isUnitType(u.type)) {
    errors.push(`${label}: unbekannter Einheitentyp „${u.type}".`);
    return;
  }
  if (!isInt(u.owner) || u.owner < 0 || u.owner >= def.players.length) {
    errors.push(`${label}: ungültiger Besitzer ${u.owner}.`);
  }
  if (!isInt(u.cx) || !isInt(u.cy) || u.cx < 0 || u.cy < 0 || u.cx >= map.width || u.cy >= map.height) {
    errors.push(`${label}: liegt außerhalb der Karte.`);
    return;
  }
  const rule = unitRule(u.type);
  const terrain = map.terrain[u.cy * map.width + u.cx]!;
  if (rule.air !== true) {
    if (rule.category === 'naval' ? !isNavigableForKindCheck(terrain) : !isPassableKind(terrain)) {
      errors.push(`${label}: Zelle (${u.cx},${u.cy}) ist für diese Einheit nicht begehbar.`);
    }
  }
  if (u.order && u.order.kind !== 'HOLD') {
    if (!isInt(u.order.cx) || !isInt(u.order.cy) || u.order.cx < 0 || u.order.cy < 0 || u.order.cx >= map.width || u.order.cy >= map.height) {
      errors.push(`${label}: Befehlsziel liegt außerhalb der Karte.`);
    }
  }
}

// Naval placement check against raw terrain values (validation has no state).
function isNavigableForKindCheck(terrain: number): boolean {
  return terrain === TERRAIN_WATER;
}

/**
 * Validates a mission definition (map, players, placements, objective and
 * trigger references). Mirrors validateCustomMap: errors block createGame.
 */
export function validateMissionDef(def: MissionDef): MissionValidation {
  const errors: string[] = [];
  const map = def.map;

  const mapCheck = validateCustomMap(map);
  if (!mapCheck.ok) errors.push(...mapCheck.errors);

  if (def.players.length < 2 || def.players.length > map.spawns.length) {
    errors.push(`Mission braucht 2 bis ${map.spawns.length} Spieler (Karte hat ${map.spawns.length} Startpunkte).`);
  }
  const human = def.players[0];
  if (human && (human.isAi || human.team !== 0)) {
    errors.push('Spieler 0 muss der Mensch sein (isAi=false, team=0).');
  }
  if (human && !def.players.some((p) => p.team !== human.team)) {
    errors.push('Mission braucht mindestens einen Gegner auf einem anderen Team.');
  }
  def.players.forEach((p, i) => {
    if (!FACTIONS.includes(p.faction)) errors.push(`Spieler ${i}: unbekannte Fraktion.`);
    if (!isInt(p.credits) || p.credits < 0) errors.push(`Spieler ${i}: ungültige Startcredits.`);
    if (!isInt(p.team) || p.team < 0) errors.push(`Spieler ${i}: ungültiges Team.`);
  });

  // Building placements: known type, in bounds, buildable ground, no overlap
  // with each other or the map's authored neutral structures.
  const footprints: Array<{ cx: number; cy: number; w: number; h: number; label: string }> = [];
  for (const nb of map.neutralBuildings ?? []) {
    if (!isBuildingType(nb.type)) continue;
    const rule = buildingRule(nb.type);
    footprints.push({ cx: nb.cx, cy: nb.cy, w: rule.width, h: rule.height, label: 'Karten-Struktur' });
  }
  def.buildings.forEach((b, i) => {
    const label = `Gebäude ${i + 1}`;
    if (!isBuildingType(b.type)) {
      errors.push(`${label}: unbekannter Gebäudetyp „${b.type}".`);
      return;
    }
    if (!isInt(b.owner) || b.owner < -1 || b.owner >= def.players.length) {
      errors.push(`${label}: ungültiger Besitzer ${b.owner}.`);
    }
    const rule = buildingRule(b.type);
    if (!isInt(b.cx) || !isInt(b.cy) || b.cx < 0 || b.cy < 0 || b.cx + rule.width > map.width || b.cy + rule.height > map.height) {
      errors.push(`${label}: liegt außerhalb der Karte.`);
      return;
    }
    if (b.type !== 'BRIDGE') {
      for (let y = b.cy; y < b.cy + rule.height; y++) {
        for (let x = b.cx; x < b.cx + rule.width; x++) {
          if (!isBuildableKind(map.terrain[y * map.width + x]!)) {
            errors.push(`${label}: braucht bebaubaren Boden bei (${x},${y}).`);
            y = b.cy + rule.height;
            break;
          }
        }
      }
    }
    for (const other of footprints) {
      if (b.cx < other.cx + other.w && other.cx < b.cx + rule.width && b.cy < other.cy + other.h && other.cy < b.cy + rule.height) {
        errors.push(`${label}: überlappt ${other.label}.`);
      }
    }
    footprints.push({ cx: b.cx, cy: b.cy, w: rule.width, h: rule.height, label });
  });

  // Unit placements: legal cell, one non-air unit per cell, never on a footprint.
  const unitCells = new Set<number>();
  def.units.forEach((u, i) => {
    const label = `Einheit ${i + 1}`;
    checkUnitPlacement(def, u, label, errors);
    if (!isUnitType(u.type) || unitRule(u.type).air === true) return;
    if (!isInt(u.cx) || !isInt(u.cy)) return;
    const idx = u.cy * map.width + u.cx;
    if (unitCells.has(idx)) errors.push(`${label}: Zelle (${u.cx},${u.cy}) ist doppelt belegt.`);
    unitCells.add(idx);
    for (const fp of footprints) {
      if (u.cx >= fp.cx && u.cx < fp.cx + fp.w && u.cy >= fp.cy && u.cy < fp.cy + fp.h) {
        errors.push(`${label}: steht auf ${fp.label}.`);
      }
    }
  });

  // Objectives: unique ids, at least one mandatory, resolvable tag references.
  const tags = placedTags(def);
  const objIds = new Set<string>();
  if (def.objectives.length === 0) errors.push('Mission braucht mindestens ein Missionsziel.');
  if (!def.objectives.some((o) => o.optional !== true)) {
    errors.push('Mission braucht mindestens ein Pflichtziel.');
  }
  for (const o of def.objectives) {
    if (objIds.has(o.id)) errors.push(`Missionsziel-ID „${o.id}" ist doppelt.`);
    objIds.add(o.id);
    const spec = o.spec;
    if ((spec.kind === 'DESTROY_TAG' || spec.kind === 'CAPTURE_TAG' || spec.kind === 'PROTECT_TAG') && !tags.has(spec.tag)) {
      errors.push(`Missionsziel „${o.id}": keine Platzierung trägt den Tag „${spec.tag}".`);
    }
    if (spec.kind === 'REACH_AREA' && spec.tag !== undefined && !tags.has(spec.tag)) {
      errors.push(`Missionsziel „${o.id}": keine Platzierung trägt den Tag „${spec.tag}".`);
    }
    if (spec.kind === 'SURVIVE_UNTIL' && (!isInt(spec.tick) || spec.tick <= 0)) {
      errors.push(`Missionsziel „${o.id}": ungültiger Zeitpunkt.`);
    }
  }

  // Triggers: unique ids, valid references and payloads.
  const trigIds = new Set<string>();
  for (const t of def.triggers) {
    if (trigIds.has(t.id)) errors.push(`Trigger-ID „${t.id}" ist doppelt.`);
    trigIds.add(t.id);
    if (t.when.kind === 'OBJECTIVE_STATUS' && !objIds.has(t.when.objectiveId)) {
      errors.push(`Trigger „${t.id}": unbekanntes Missionsziel „${t.when.objectiveId}".`);
    }
    if (t.when.kind === 'TAG_DEAD' && !tags.has(t.when.tag)) {
      errors.push(`Trigger „${t.id}": keine Platzierung trägt den Tag „${t.when.tag}".`);
    }
    for (const a of t.actions) {
      if (a.kind === 'SPAWN') {
        a.units.forEach((u, i) => checkUnitPlacement(def, u, `Trigger „${t.id}" Spawn ${i + 1}`, errors));
      }
      if (a.kind === 'REVEAL_OBJECTIVE') {
        const target = def.objectives.find((o) => o.id === a.objectiveId);
        if (!target) errors.push(`Trigger „${t.id}": unbekanntes Missionsziel „${a.objectiveId}".`);
        else if (target.hidden !== true) errors.push(`Trigger „${t.id}": Missionsziel „${a.objectiveId}" ist nicht versteckt.`);
      }
      if ((a.kind === 'GRANT_CREDITS' || a.kind === 'AI_ATTACK_NOW' || a.kind === 'REVEAL_AREA') &&
          (!isInt(a.player) || a.player < 0 || a.player >= def.players.length)) {
        errors.push(`Trigger „${t.id}": ungültiger Spieler.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Builds the runtime mission state — every field concretely initialized. */
export function buildMissionState(def: MissionDef): MissionState {
  return {
    missionId: def.id,
    objectives: def.objectives.map((o) => ({
      id: o.id,
      spec: o.spec,
      optional: o.optional === true,
      status: o.hidden === true ? OBJ_HIDDEN : OBJ_ACTIVE,
    })),
    triggers: def.triggers.map((t) => ({
      id: t.id,
      when: t.when,
      actions: t.actions,
      fired: false,
    })),
  };
}

/**
 * Applies a placement's standing order to a freshly spawned unit. Mirrors the
 * command handlers (commands.ts) without going through applyCommands, so it
 * works during createGame before the first tick.
 */
export function applyPlacementOrder(state: GameState, unit: Unit, order: PlacementOrder): void {
  const rule = unitRule(unit.type);
  if (order.kind === 'HOLD') {
    if (rule.air === true && rule.hover !== true) return; // jets can't hold
    unit.order = { kind: 'HOLD' };
    return;
  }
  if (!inBounds(state, order.cx, order.cy)) return;
  if (order.kind === 'ATTACK_MOVE' && rule.weapon !== null) {
    unit.order = { kind: 'ATTACK_MOVE', cx: order.cx, cy: order.cy };
    unit.path = null; // combat system paths toward the order cell
    unit.pathIndex = 0;
    return;
  }
  // Plain move (or attack-move of a weaponless unit).
  if (rule.air === true) {
    unit.path = [{ cx: order.cx, cy: order.cy }];
    unit.pathIndex = 0;
    return;
  }
  const ucx = unit.cell % state.mapWidth;
  const ucy = (unit.cell - ucx) / state.mapWidth;
  unit.path = findPath(state, ucx, ucy, order.cx, order.cy, {
    avoidUnits: false,
    selfId: unit.id,
    owner: unit.owner,
    water: rule.category === 'naval',
  });
  unit.pathIndex = 0;
}

/**
 * Deterministic free-cell search for trigger spawns: the target cell first,
 * then rings of growing radius. Returns null when everything nearby is taken.
 */
export function findSpawnCell(
  state: GameState,
  type: UnitType,
  cx: number,
  cy: number,
): { cx: number; cy: number } | null {
  const rule = unitRule(type);
  if (rule.air === true) return inBounds(state, cx, cy) ? { cx, cy } : null;
  const fits = (x: number, y: number): boolean => {
    if (!inBounds(state as GridView, x, y)) return false;
    const passable = rule.category === 'naval' ? isNavigableWater(state, x, y) : isPassableTerrain(state, x, y);
    if (!passable) return false;
    const idx = cellIndex(state, x, y);
    return state.occupancy[idx] === 0 && state.structures[idx] === 0;
  };
  for (let r = 0; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ax = dx < 0 ? -dx : dx;
        const ay = dy < 0 ? -dy : dy;
        if ((ax > ay ? ax : ay) !== r) continue;
        if (fits(cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
      }
    }
  }
  return null;
}

/** True while the player still fields anything: units (incl. passengers) or a
 *  non-wall building. Campaign aliveness — commando missions have no base. */
export function missionAlive(state: GameState, id: number): boolean {
  if (state.players[id]?.surrendered === true) return false;
  return (
    state.units.some((u) => u.owner === id || u.passengers.some((p) => p.owner === id)) ||
    state.buildings.some((b) => b.owner === id && b.type !== 'WALL')
  );
}

/** Lowest-id player on a team hostile to the human — the "winner" on defeat. */
export function missionEnemyRep(state: GameState): number {
  const humanTeam = state.players[0]?.team ?? 0;
  for (const p of state.players) {
    if (p.team !== humanTeam) return p.id;
  }
  return 1;
}
