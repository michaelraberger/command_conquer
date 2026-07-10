import {
  RESOURCE_GEMS,
  RESOURCE_NONE,
  TERRAIN_DIRT,
  TERRAIN_BRIDGE,
  TERRAIN_WATER,
  isBuildableKind,
  isPassableKind,
  type MapType,
} from './map.js';
import { buildingRule, isBuildingType } from './rules.js';

/** Legal side lengths for hand-authored maps (square not required). */
export const CUSTOM_MAP_SIZES: readonly number[] = [48, 64, 96];

/** Spawns must keep this margin to the map edge (room for base + units). */
export const SPAWN_EDGE_MARGIN = 5;
/** Minimum pairwise Chebyshev distance between spawns. */
export const SPAWN_MIN_DISTANCE = 12;
/** The square of this radius around a spawn must be open ground (cf. clearArea). */
export const SPAWN_CLEAR_RADIUS = 4;

/**
 * A hand-authored map, as produced by the editor and stored in the cloud.
 * Layers are row-major plain number arrays (same convention as serialize()),
 * so the format is JSON-safe without any codec. `spawns.length` is the map's
 * maximum player count (2–6).
 */
export interface CustomMapData {
  version: 1;
  name: string;
  width: number;
  height: number;
  /** TERRAIN_* per cell. */
  terrain: number[];
  /** Harvestable amount per cell (0–65535). */
  ore: number[];
  /** RESOURCE_* per cell — permanent fertility, fields regrow on it. */
  resourceKind: number[];
  /** Base centre per player; index = player id. */
  spawns: [number, number][];
  /** Derived from the layout (see validateCustomMap) — the AI reads this. */
  mapType: MapType;
  /** Neutral (owner -1) structures authored into the map, e.g. Erz-Bohrtürme.
   *  (cx, cy) is the footprint's top-left cell. Older maps lack the field. */
  neutralBuildings?: Array<{ type: string; cx: number; cy: number }>;
}

/** Building types a map author may place as neutral structures. */
export const NEUTRAL_BUILDING_TYPES: ReadonlySet<string> = new Set(['ERZ_BOHRTURM']);

export interface CustomMapValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Layout-derived map type (only meaningful when `ok`). */
  mapType: MapType;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Flood fill over passable ground from (sx, sy); returns the visited mask.
 * Unlike findPath this is exact and has no expansion cap, so it stays reliable
 * on 96×96 maps. 4-neighbour on purpose: diagonal-only gaps between rocks
 * should not count as a ground connection.
 */
function floodGround(terrain: number[], width: number, height: number, sx: number, sy: number): Uint8Array {
  const visited = new Uint8Array(width * height);
  const queue: number[] = [sy * width + sx];
  visited[sy * width + sx] = 1;
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const cx = idx % width;
    const cy = (idx - cx) / width;
    const tryCell = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = y * width + x;
      if (visited[i] || !isPassableKind(terrain[i]!)) return;
      visited[i] = 1;
      queue.push(i);
    };
    tryCell(cx - 1, cy);
    tryCell(cx + 1, cy);
    tryCell(cx, cy - 1);
    tryCell(cx, cy + 1);
  }
  return visited;
}

/**
 * Validates an authored map and derives its `mapType` from the layout:
 * spawns not all ground-connected → ISLANDS (naval/air matter); otherwise
 * water share > 20% → RIVER, else BADLANDS. Errors block playing the map,
 * warnings are advisory (shown in the editor, ignored by createGame).
 */
export function validateCustomMap(map: CustomMapData): CustomMapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (map.version !== 1) errors.push('Unbekannte Kartenversion.');
  if (!CUSTOM_MAP_SIZES.includes(map.width) || !CUSTOM_MAP_SIZES.includes(map.height)) {
    errors.push(`Kartengröße muss ${CUSTOM_MAP_SIZES.join('/')} sein.`);
    return { ok: false, errors, warnings, mapType: 'BADLANDS' };
  }
  const size = map.width * map.height;
  if (map.terrain.length !== size || map.ore.length !== size || map.resourceKind.length !== size) {
    errors.push('Kartendaten haben die falsche Länge.');
    return { ok: false, errors, warnings, mapType: 'BADLANDS' };
  }

  let waterCells = 0;
  for (let i = 0; i < size; i++) {
    const t = map.terrain[i]!;
    if (!isInt(t) || t < TERRAIN_DIRT || t > TERRAIN_BRIDGE) {
      errors.push('Ungültiger Geländewert in den Kartendaten.');
      return { ok: false, errors, warnings, mapType: 'BADLANDS' };
    }
    const kind = map.resourceKind[i]!;
    const ore = map.ore[i]!;
    if (!isInt(kind) || kind < RESOURCE_NONE || kind > RESOURCE_GEMS || !isInt(ore) || ore < 0 || ore > 0xffff) {
      errors.push('Ungültiger Rohstoffwert in den Kartendaten.');
      return { ok: false, errors, warnings, mapType: 'BADLANDS' };
    }
    if ((kind !== RESOURCE_NONE || ore > 0) && !isPassableKind(t)) {
      errors.push('Rohstofffelder müssen auf begehbarem Boden liegen.');
      return { ok: false, errors, warnings, mapType: 'BADLANDS' };
    }
    if (t === TERRAIN_WATER) waterCells++;
  }

  if (map.spawns.length < 2 || map.spawns.length > 6) {
    errors.push('Eine Karte braucht 2 bis 6 Startpunkte.');
  }
  for (let i = 0; i < map.spawns.length; i++) {
    const [sx, sy] = map.spawns[i]!;
    if (!isInt(sx) || !isInt(sy)) {
      errors.push(`Startpunkt ${i + 1} ist ungültig.`);
      continue;
    }
    if (
      sx < SPAWN_EDGE_MARGIN ||
      sy < SPAWN_EDGE_MARGIN ||
      sx >= map.width - SPAWN_EDGE_MARGIN ||
      sy >= map.height - SPAWN_EDGE_MARGIN
    ) {
      errors.push(`Startpunkt ${i + 1} liegt zu nah am Kartenrand (Abstand mind. ${SPAWN_EDGE_MARGIN}).`);
      continue;
    }
    for (let j = 0; j < i; j++) {
      const [ox, oy] = map.spawns[j]!;
      const cheb = Math.max(Math.abs(sx - ox), Math.abs(sy - oy));
      if (cheb < SPAWN_MIN_DISTANCE) {
        errors.push(`Startpunkte ${j + 1} und ${i + 1} liegen zu nah beieinander (Abstand mind. ${SPAWN_MIN_DISTANCE}).`);
      }
    }
    let blocked = false;
    for (let y = sy - SPAWN_CLEAR_RADIUS; y <= sy + SPAWN_CLEAR_RADIUS && !blocked; y++) {
      for (let x = sx - SPAWN_CLEAR_RADIUS; x <= sx + SPAWN_CLEAR_RADIUS && !blocked; x++) {
        // Buildable, not just passable: the Bauhof and first base need solid
        // ground, so a spawn area on ice is rejected.
        if (!isBuildableKind(map.terrain[y * map.width + x]!)) blocked = true;
      }
    }
    if (blocked) {
      errors.push(
        `Um Startpunkt ${i + 1} muss ein Bereich von ${SPAWN_CLEAR_RADIUS} Feldern frei sein (nur Erde/Gras).`,
      );
    }
  }

  // Neutral structures (Erz-Bohrtürme): known type, footprint in bounds on
  // clear buildable ground, no overlap with each other or spawn clear zones.
  const neutrals = map.neutralBuildings ?? [];
  for (let i = 0; i < neutrals.length; i++) {
    const nb = neutrals[i]!;
    if (!NEUTRAL_BUILDING_TYPES.has(nb.type) || !isBuildingType(nb.type)) {
      errors.push(`Neutrales Gebäude ${i + 1} hat einen unbekannten Typ.`);
      continue;
    }
    const rule = buildingRule(nb.type);
    if (
      !isInt(nb.cx) ||
      !isInt(nb.cy) ||
      nb.cx < 0 ||
      nb.cy < 0 ||
      nb.cx + rule.width > map.width ||
      nb.cy + rule.height > map.height
    ) {
      errors.push(`${rule.name} ${i + 1} liegt außerhalb der Karte.`);
      continue;
    }
    let blockedCell = false;
    for (let y = nb.cy; y < nb.cy + rule.height && !blockedCell; y++) {
      for (let x = nb.cx; x < nb.cx + rule.width && !blockedCell; x++) {
        const idx = y * map.width + x;
        if (!isBuildableKind(map.terrain[idx]!) || map.ore[idx]! > 0 || map.resourceKind[idx]! !== RESOURCE_NONE) {
          blockedCell = true;
        }
      }
    }
    if (blockedCell) {
      errors.push(`${rule.name} ${i + 1} braucht freien, bebaubaren Boden ohne Rohstoffe.`);
      continue;
    }
    for (let j = 0; j < i; j++) {
      const other = neutrals[j]!;
      if (!isBuildingType(other.type)) continue;
      const otherRule = buildingRule(other.type);
      if (
        nb.cx < other.cx + otherRule.width &&
        other.cx < nb.cx + rule.width &&
        nb.cy < other.cy + otherRule.height &&
        other.cy < nb.cy + rule.height
      ) {
        errors.push(`Neutrale Gebäude ${j + 1} und ${i + 1} überlappen sich.`);
      }
    }
    for (let s = 0; s < map.spawns.length; s++) {
      const [sx, sy] = map.spawns[s]!;
      if (!isInt(sx) || !isInt(sy)) continue;
      if (
        nb.cx <= sx + SPAWN_CLEAR_RADIUS &&
        sx - SPAWN_CLEAR_RADIUS <= nb.cx + rule.width - 1 &&
        nb.cy <= sy + SPAWN_CLEAR_RADIUS &&
        sy - SPAWN_CLEAR_RADIUS <= nb.cy + rule.height - 1
      ) {
        errors.push(`${rule.name} ${i + 1} liegt in der Freizone von Startpunkt ${s + 1}.`);
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings, mapType: 'BADLANDS' };

  // Layout-derived map type via exact ground connectivity from spawn 1.
  const [s0x, s0y] = map.spawns[0]!;
  const reach = floodGround(map.terrain, map.width, map.height, s0x, s0y);
  const allConnected = map.spawns.every(([x, y]) => reach[y * map.width + x] === 1);
  let mapType: MapType;
  if (!allConnected) {
    mapType = 'ISLANDS';
    warnings.push('Nicht alle Startpunkte sind am Boden erreichbar — die Karte gilt als Inselkarte.');
  } else {
    mapType = waterCells * 5 > size ? 'RIVER' : 'BADLANDS';
  }

  // Advisory: a base without nearby ore starves its harvester.
  const ORE_RADIUS = 12;
  for (let i = 0; i < map.spawns.length; i++) {
    const [sx, sy] = map.spawns[i]!;
    let hasOre = false;
    for (let y = Math.max(0, sy - ORE_RADIUS); y <= Math.min(map.height - 1, sy + ORE_RADIUS) && !hasOre; y++) {
      for (let x = Math.max(0, sx - ORE_RADIUS); x <= Math.min(map.width - 1, sx + ORE_RADIUS) && !hasOre; x++) {
        const idx = y * map.width + x;
        if (map.ore[idx]! > 0 || map.resourceKind[idx]! !== RESOURCE_NONE) hasOre = true;
      }
    }
    if (!hasOre) warnings.push(`Startpunkt ${i + 1} hat kein Erz in der Nähe (Radius ${ORE_RADIUS}).`);
  }

  return { ok: true, errors, warnings, mapType };
}

/** Creates an empty (all-dirt) map of the given size — the editor's blank slate. */
export function emptyCustomMap(width: number, height: number, name = 'Neue Karte'): CustomMapData {
  const size = width * height;
  return {
    version: 1,
    name,
    width,
    height,
    terrain: new Array<number>(size).fill(TERRAIN_DIRT),
    ore: new Array<number>(size).fill(0),
    resourceKind: new Array<number>(size).fill(RESOURCE_NONE),
    spawns: [
      [SPAWN_EDGE_MARGIN + 3, SPAWN_EDGE_MARGIN + 3],
      [width - SPAWN_EDGE_MARGIN - 4, height - SPAWN_EDGE_MARGIN - 4],
    ],
    mapType: 'BADLANDS',
  };
}
