import { SUBCELL } from './fixed.js';

/**
 * Data tables for all game content — the moral equivalent of RA2's rules.ini.
 * Adding a unit or building should be an entry here plus a sprite, not new
 * code.
 *
 * speed is in fixed-point sub-cells per tick (256 sub-cells = 1 cell,
 * 15 ticks = 1 second → speed 36 ≈ 2.1 cells/second). buildTime is in ticks;
 * cost drains gradually over the build time (RA2 model). sight is in cells.
 */
export type ArmorClass = 'none' | 'light' | 'heavy';
export type UnitCategory = 'infantry' | 'vehicle' | 'air' | 'naval';
export type ProductionCategory = 'building' | UnitCategory;
/** What layer a weapon can hit. Ground weapons cannot touch aircraft. */
export type WeaponTargets = 'ground' | 'air' | 'both';
export type Faction = 'ALLIES' | 'SOVIETS';

export type SuperweaponKind = 'NUKE' | 'STORM';
export type AiDifficulty = 'easy' | 'normal' | 'hard';

/** Researchable technologies. A unit/building with a `tech` is only buildable
 *  once that tech has been researched at a Techzentrum. */
export type TechId =
  | 'armor'
  | 'artillery'
  | 'air'
  | 'navy'
  | 'flak'
  | 'repair'
  | 'tesla'
  | 'super'
  | 'spy';

export const FACTIONS: readonly Faction[] = ['ALLIES', 'SOVIETS'];
export const FACTION_NAMES: Record<Faction, string> = {
  ALLIES: 'Alliierte',
  SOVIETS: 'Sowjets',
};
/** Team colors are fixed by faction: Allies blue, Soviets red. */
export const FACTION_COLORS: Record<Faction, number> = {
  ALLIES: 0x4da6ff,
  SOVIETS: 0xff5555,
};

/** Visual/audio flavor of a weapon, consumed by the client effect layer. */
export type WeaponFx = 'BULLET' | 'CANNON' | 'TESLA' | 'ARTY' | 'FLAME' | 'ROCKET';

export interface WeaponRule {
  damage: number;
  /** Max firing distance in fixed-point sub-cells. */
  range: number;
  /** Squared range, precomputed for the hot targeting loop. */
  rangeSq: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Sub-cells per tick; 0 = instant hit (hitscan). */
  projectileSpeed: number;
  /** Warhead vs armor-class damage multiplier in percent (RA2 model). */
  vs: Record<ArmorClass, number>;
  fx: WeaponFx;
  /** Which layer this weapon can engage (default 'ground'). */
  targets: WeaponTargets;
  /** Can hit submerged units (depth charges/torpedoes). */
  antiSub: boolean;
}

export interface UnitRule {
  name: string;
  maxHp: number;
  speed: number;
  /** Selection/collision radius in fixed-point sub-cells (visual aid). */
  radius: number;
  armor: ArmorClass;
  weapon: WeaponRule | null;
  cost: number;
  buildTime: number;
  category: UnitCategory;
  /** Building types that must exist before this unit can be queued. */
  requires: readonly string[];
  /** null = available to every faction. */
  factions: readonly Faction[] | null;
  sight: number;
  /** Weapon only engages enemy infantry (e.g. attack dog) — never vehicles or buildings. */
  antiInfantryOnly?: boolean;
  /** Aircraft: flies in a straight line over any terrain, ignores occupancy,
   *  and can only be hit by anti-air weapons. */
  air?: boolean;
  /** Weapon only engages ships (torpedoes) — never land targets or buildings. */
  navalOnly?: boolean;
  /** Submerged (submarine): only weapons with antiSub can hit it. */
  submerged?: boolean;
  /** Carries ground units as cargo (LOAD/UNLOAD): the sea transport and the
   *  air transport. Up to TRANSPORT_CAPACITY passengers ride inside. */
  carrier?: boolean;
  /** Spy: walks into an enemy storage building (INFILTRATE) to steal its stored
   *  ore, then is consumed. Has no weapon. */
  infiltrator?: boolean;
  /** Only buildable once this technology is researched (undefined = immediate). */
  tech?: TechId;
}

function weapon(
  damage: number,
  rangeCells: number,
  cooldown: number,
  projectileSpeed: number,
  vs: Record<ArmorClass, number>,
  fx: WeaponFx,
  targets: WeaponTargets = 'ground',
  antiSub = false,
): WeaponRule {
  const range = Math.round(rangeCells * SUBCELL);
  return { damage, range, rangeSq: range * range, cooldown, projectileSpeed, vs, fx, targets, antiSub };
}

export const UNIT_RULES = {
  TANK: {
    name: 'Panzer',
    maxHp: 300,
    speed: 36,
    radius: 100,
    armor: 'heavy',
    weapon: weapon(45, 4.5, 25, 200, { none: 60, light: 80, heavy: 100 }, 'CANNON'),
    cost: 900,
    buildTime: 80,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: null,
    sight: 6,
  },
  MAMMOTH: {
    name: 'Mammutpanzer',
    maxHp: 900,
    speed: 20,
    radius: 130,
    armor: 'heavy',
    weapon: weapon(60, 4.75, 15, 200, { none: 70, light: 90, heavy: 110 }, 'CANNON'),
    cost: 1800,
    buildTime: 150,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: ['SOVIETS'],
    sight: 6,
    tech: 'armor',
  },
  ARTILLERY: {
    name: 'Artillerie',
    maxHp: 200,
    speed: 22,
    radius: 110,
    armor: 'light',
    weapon: weapon(90, 7, 45, 140, { none: 90, light: 80, heavy: 70 }, 'ARTY'),
    cost: 1200,
    buildTime: 120,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: ['ALLIES'],
    sight: 7,
    tech: 'artillery',
  },
  RIFLEMAN: {
    name: 'Schütze',
    maxHp: 100,
    speed: 20,
    radius: 60,
    armor: 'none',
    weapon: weapon(12, 3.5, 8, 0, { none: 100, light: 55, heavy: 25 }, 'BULLET'),
    cost: 200,
    buildTime: 30,
    category: 'infantry',
    requires: ['BARRACKS'],
    factions: null,
    sight: 5,
  },
  HARVESTER: {
    name: 'Sammler',
    maxHp: 600,
    speed: 30,
    radius: 110,
    armor: 'light',
    weapon: null,
    cost: 1400,
    buildTime: 100,
    category: 'vehicle',
    requires: ['FACTORY', 'REFINERY'],
    factions: null,
    sight: 6,
  },
  REPAIR: {
    name: 'Reparaturfahrzeug',
    maxHp: 250,
    speed: 32,
    radius: 100,
    armor: 'light',
    weapon: null,
    cost: 800,
    buildTime: 80,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: null,
    sight: 6,
    tech: 'repair',
  },
  ROCKETEER: {
    name: 'Raketensoldat',
    maxHp: 90,
    speed: 18,
    radius: 60,
    armor: 'none',
    // Anti-armor homing rocket (strong vs heavy, weak vs infantry) that also
    // engages aircraft — the mobile jack-of-all-trades anti-air, C&C-style.
    weapon: weapon(30, 5, 30, 160, { none: 40, light: 90, heavy: 110 }, 'ROCKET', 'both'),
    cost: 400,
    buildTime: 45,
    category: 'infantry',
    requires: ['BARRACKS'],
    factions: null,
    sight: 5,
  },
  SCOUT: {
    name: 'Späher',
    maxHp: 140,
    speed: 54,
    radius: 90,
    armor: 'light',
    weapon: weapon(10, 4, 6, 0, { none: 100, light: 60, heavy: 25 }, 'BULLET'),
    cost: 500,
    buildTime: 40,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: ['ALLIES'],
    sight: 9,
  },
  LIGHTTANK: {
    name: 'Leichter Panzer',
    maxHp: 220,
    speed: 46,
    radius: 95,
    armor: 'heavy',
    weapon: weapon(32, 4.25, 22, 200, { none: 55, light: 75, heavy: 90 }, 'CANNON'),
    cost: 650,
    buildTime: 60,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: ['ALLIES'],
    sight: 6,
  },
  FLAMER: {
    name: 'Flammenwerfer',
    maxHp: 120,
    speed: 17,
    radius: 60,
    armor: 'none',
    // Short-range flamer: brutal vs infantry/light, weak vs heavy armor.
    weapon: weapon(24, 2.75, 14, 0, { none: 120, light: 100, heavy: 35 }, 'FLAME'),
    cost: 450,
    buildTime: 50,
    category: 'infantry',
    requires: ['BARRACKS'],
    factions: ['SOVIETS'],
    sight: 4,
  },
  DOG: {
    name: 'Kampfhund',
    maxHp: 60,
    speed: 62,
    radius: 55,
    armor: 'none',
    // Fast melee hunter that only ever attacks enemy infantry.
    weapon: weapon(50, 1.5, 20, 0, { none: 130, light: 100, heavy: 100 }, 'BULLET'),
    cost: 200,
    buildTime: 20,
    category: 'infantry',
    requires: ['BARRACKS'],
    factions: ['SOVIETS'],
    sight: 5,
    antiInfantryOnly: true,
  },
  TESLATANK: {
    name: 'Tesla-Panzer',
    maxHp: 260,
    speed: 30,
    radius: 100,
    armor: 'heavy',
    weapon: weapon(90, 5, 35, 0, { none: 100, light: 100, heavy: 100 }, 'TESLA'),
    cost: 1300,
    buildTime: 110,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: ['SOVIETS'],
    sight: 6,
    tech: 'tesla',
  },
  FLAK: {
    name: 'Flak-Panzer',
    maxHp: 180,
    speed: 36,
    radius: 100,
    armor: 'light',
    // Anti-air only: rapid flak that shreds aircraft but can't touch the ground.
    weapon: weapon(20, 6, 6, 0, { none: 100, light: 100, heavy: 100 }, 'BULLET', 'air'),
    cost: 700,
    buildTime: 70,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: null,
    sight: 7,
    tech: 'flak',
  },
  HELI: {
    name: 'Kampfhubschrauber',
    maxHp: 160,
    speed: 48,
    radius: 100,
    armor: 'light',
    weapon: weapon(35, 5, 28, 220, { none: 60, light: 100, heavy: 85 }, 'ROCKET'),
    cost: 1200,
    buildTime: 110,
    category: 'air',
    requires: ['HELIPAD'],
    factions: null,
    sight: 8,
    air: true,
  },
  JET: {
    name: 'Kampfjet',
    maxHp: 120,
    speed: 72,
    radius: 100,
    armor: 'light',
    weapon: weapon(50, 4.5, 35, 0, { none: 70, light: 100, heavy: 80 }, 'CANNON'),
    cost: 1400,
    buildTime: 120,
    category: 'air',
    requires: ['HELIPAD'],
    factions: ['SOVIETS'],
    sight: 9,
    air: true,
  },
  GUNBOAT: {
    name: 'Kanonenboot',
    maxHp: 180,
    speed: 44,
    radius: 110,
    armor: 'light',
    // Fast patrol boat: MG vs shore infantry and other light ships.
    weapon: weapon(16, 4.5, 8, 0, { none: 100, light: 70, heavy: 30 }, 'BULLET'),
    cost: 500,
    buildTime: 50,
    category: 'naval',
    requires: ['SHIPYARD'],
    factions: null,
    sight: 7,
  },
  DESTROYER: {
    name: 'Zerstörer',
    maxHp: 420,
    speed: 30,
    radius: 130,
    armor: 'heavy',
    // Naval workhorse: deck gun for shore bombardment, depth charges vs subs.
    weapon: weapon(55, 6, 30, 200, { none: 80, light: 90, heavy: 100 }, 'CANNON', 'ground', true),
    cost: 1200,
    buildTime: 110,
    category: 'naval',
    requires: ['SHIPYARD'],
    factions: ['ALLIES'],
    sight: 7,
  },
  SUB: {
    name: 'U-Boot',
    maxHp: 240,
    speed: 26,
    radius: 120,
    armor: 'light',
    // Submerged hunter: torpedoes only hit ships; only antiSub weapons hit it.
    weapon: weapon(95, 5.5, 50, 90, { none: 60, light: 110, heavy: 120 }, 'ROCKET', 'ground', true),
    cost: 1000,
    buildTime: 100,
    category: 'naval',
    requires: ['SHIPYARD'],
    factions: ['SOVIETS'],
    sight: 6,
    navalOnly: true,
    submerged: true,
  },
  TRANSPORT: {
    name: 'Transportschiff',
    maxHp: 400,
    speed: 32,
    radius: 130,
    armor: 'light',
    weapon: null,
    cost: 800,
    buildTime: 90,
    category: 'naval',
    requires: ['SHIPYARD'],
    factions: null,
    sight: 5,
    carrier: true,
  },
  AIRLIFT: {
    name: 'Transporthubschrauber',
    maxHp: 200,
    speed: 46,
    radius: 110,
    armor: 'light',
    // Unarmed troop lifter: flies squads straight over any terrain and drops
    // them anywhere on land — behind lines or onto a defended island. Only
    // anti-air can bring it down, so escort or a clear approach matters.
    weapon: null,
    cost: 1000,
    buildTime: 90,
    category: 'air',
    requires: ['HELIPAD'],
    factions: ['ALLIES'],
    sight: 7,
    air: true,
    carrier: true,
  },
  SPION: {
    name: 'Spion',
    maxHp: 100,
    speed: 20,
    radius: 60,
    armor: 'none',
    // Unarmed infiltrator: sneaks into an enemy refinery/silo, steals the ore
    // stored there and is spent doing so. Defenceless — needs cover to get in.
    weapon: null,
    cost: 1000,
    buildTime: 60,
    category: 'infantry',
    requires: ['BARRACKS'],
    factions: ['ALLIES'],
    sight: 5,
    infiltrator: true,
    tech: 'spy',
  },
  MCV: {
    name: 'Baufahrzeug',
    maxHp: 800,
    speed: 16,
    radius: 130,
    armor: 'heavy',
    // Mobile construction vehicle: unarmed, deploys (DEPLOY) into a new
    // construction yard — your insurance against losing your base.
    weapon: null,
    cost: 2500,
    buildTime: 150,
    category: 'vehicle',
    requires: ['FACTORY'],
    factions: null,
    sight: 5,
  },
} as const satisfies Record<string, UnitRule>;

export type UnitType = keyof typeof UNIT_RULES;

export function unitRule(type: UnitType): UnitRule {
  return UNIT_RULES[type];
}

export interface BuildingRule {
  name: string;
  maxHp: number;
  cost: number;
  buildTime: number;
  /** Positive = produces power, negative = consumes power. */
  power: number;
  width: number;
  height: number;
  armor: ArmorClass;
  /** Unit category this building trains, if any. */
  produces: UnitCategory | null;
  /** Auto-firing base defense weapon (offline while low on power). */
  weapon: WeaponRule | null;
  /** Superweapon launched from this building once charged. */
  superweapon: SuperweaponKind | null;
  /** Building types that must exist before this can be queued. */
  requires: readonly string[];
  /** false = starting structure or special flow (walls), not in the queue. */
  buildable: boolean;
  factions: readonly Faction[] | null;
  sight: number;
  /** Ore storage capacity this building adds to its owner (undefined/0 = none).
   *  Credits cannot be harvested past the sum of a player's storage; a destroyed
   *  or infiltrated storage building forfeits the ore held in it. */
  storage?: number;
  /** Footprint must sit on open water instead of buildable land (shipyard). */
  onWater?: boolean;
  /** Only buildable once this technology is researched (undefined = immediate). */
  tech?: TechId;
}

export const BUILDING_RULES = {
  CONYARD: {
    name: 'Bauhof',
    maxHp: 1500,
    cost: 3000,
    buildTime: 300,
    power: 0,
    width: 3,
    height: 3,
    armor: 'heavy',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: [],
    buildable: false,
    factions: null,
    sight: 6,
    storage: 2000,
  },
  POWER: {
    name: 'Kraftwerk',
    maxHp: 750,
    cost: 300,
    buildTime: 60,
    power: 150,
    width: 2,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['CONYARD'],
    buildable: true,
    factions: null,
    sight: 4,
  },
  REFINERY: {
    name: 'Raffinerie',
    maxHp: 1000,
    cost: 2000,
    buildTime: 150,
    power: -50,
    width: 3,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['POWER'],
    buildable: true,
    factions: null,
    sight: 4,
    storage: 2000,
  },
  SILO: {
    name: 'Erzsilo',
    maxHp: 600,
    cost: 600,
    buildTime: 60,
    power: 0,
    width: 2,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['REFINERY'],
    buildable: true,
    factions: null,
    sight: 3,
    storage: 1200,
  },
  BARRACKS: {
    name: 'Kaserne',
    maxHp: 800,
    cost: 500,
    buildTime: 90,
    power: -20,
    width: 2,
    height: 2,
    armor: 'light',
    produces: 'infantry',
    weapon: null,
    superweapon: null,
    requires: ['POWER'],
    buildable: true,
    factions: null,
    sight: 4,
  },
  FACTORY: {
    name: 'Waffenfabrik',
    maxHp: 1200,
    cost: 2000,
    buildTime: 150,
    power: -50,
    width: 3,
    height: 3,
    armor: 'light',
    produces: 'vehicle',
    weapon: null,
    superweapon: null,
    requires: ['REFINERY'],
    buildable: true,
    factions: null,
    sight: 4,
  },
  WERKSTATT: {
    name: 'Werkstatt',
    maxHp: 900,
    cost: 1200,
    buildTime: 100,
    power: -30,
    width: 3,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['FACTORY'],
    buildable: true,
    factions: null,
    sight: 4,
    tech: 'repair',
  },
  TESLA: {
    name: 'Tesla-Spule',
    maxHp: 600,
    cost: 1200,
    buildTime: 90,
    power: -75,
    width: 1,
    height: 1,
    armor: 'light',
    produces: null,
    weapon: weapon(130, 6, 35, 0, { none: 100, light: 100, heavy: 100 }, 'TESLA'),
    superweapon: null,
    requires: ['REFINERY'],
    buildable: true,
    factions: ['SOVIETS'],
    sight: 7,
    tech: 'tesla',
  },
  PILLBOX: {
    name: 'MG-Stellung',
    maxHp: 700,
    cost: 600,
    buildTime: 60,
    power: -10,
    width: 1,
    height: 1,
    armor: 'heavy',
    produces: null,
    weapon: weapon(14, 4.5, 6, 0, { none: 100, light: 55, heavy: 25 }, 'BULLET'),
    superweapon: null,
    requires: ['BARRACKS'],
    buildable: true,
    factions: ['ALLIES'],
    sight: 6,
  },
  HELIPAD: {
    name: 'Flugplatz',
    maxHp: 900,
    cost: 1000,
    buildTime: 120,
    power: -40,
    width: 3,
    height: 3,
    armor: 'light',
    produces: 'air',
    weapon: null,
    superweapon: null,
    requires: ['FACTORY'],
    buildable: true,
    factions: null,
    sight: 5,
    tech: 'air',
  },
  FLAKTOWER: {
    name: 'Flak-Turm',
    maxHp: 600,
    cost: 800,
    buildTime: 70,
    power: -20,
    width: 1,
    height: 1,
    armor: 'heavy',
    produces: null,
    // Static anti-air: only shoots aircraft.
    weapon: weapon(22, 7, 5, 0, { none: 100, light: 100, heavy: 100 }, 'BULLET', 'air'),
    superweapon: null,
    requires: ['BARRACKS'],
    buildable: true,
    factions: null,
    sight: 7,
    tech: 'flak',
  },
  SHIPYARD: {
    name: 'Werft',
    maxHp: 1200,
    cost: 1500,
    buildTime: 140,
    power: -50,
    width: 3,
    height: 3,
    armor: 'light',
    produces: 'naval',
    weapon: null,
    superweapon: null,
    requires: ['FACTORY'],
    buildable: true,
    factions: null,
    sight: 5,
    onWater: true,
    tech: 'navy',
  },
  NUKESILO: {
    name: 'Raketensilo',
    maxHp: 1000,
    cost: 2500,
    buildTime: 240,
    power: -100,
    width: 2,
    height: 2,
    armor: 'heavy',
    produces: null,
    weapon: null,
    superweapon: 'NUKE',
    requires: ['FACTORY'],
    buildable: true,
    factions: ['SOVIETS'],
    sight: 4,
    tech: 'super',
  },
  WEATHER: {
    name: 'Wetterkontrolle',
    maxHp: 1000,
    cost: 2500,
    buildTime: 240,
    power: -100,
    width: 2,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: 'STORM',
    requires: ['FACTORY'],
    buildable: true,
    factions: ['ALLIES'],
    sight: 4,
    tech: 'super',
  },
  TECHCENTER: {
    name: 'Techzentrum',
    maxHp: 800,
    cost: 1500,
    buildTime: 120,
    power: -60,
    width: 2,
    height: 2,
    armor: 'light',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['FACTORY'],
    buildable: true,
    factions: null,
    sight: 4,
  },
  WALL: {
    name: 'Mauer',
    maxHp: 250,
    cost: 50,
    buildTime: 1,
    power: 0,
    width: 1,
    height: 1,
    armor: 'heavy',
    produces: null,
    weapon: null,
    superweapon: null,
    requires: ['CONYARD'],
    buildable: false, // placed instantly via PLACE_WALL, not the build queue
    factions: null,
    sight: 1,
  },
} as const satisfies Record<string, BuildingRule>;

export type BuildingType = keyof typeof BUILDING_RULES;

export function buildingRule(type: BuildingType): BuildingRule {
  return BUILDING_RULES[type];
}

export function isBuildingType(item: string): item is BuildingType {
  return item in BUILDING_RULES;
}

export function isUnitType(item: string): item is UnitType {
  return item in UNIT_RULES;
}

export interface TechRule {
  name: string;
  cost: number;
  /** Research time in ticks (cost drains gradually over it, like production). */
  time: number;
  /** Buildings that must stand to research this (always a Techzentrum). */
  requires: readonly string[];
  /** null = both factions may research it. */
  factions: readonly Faction[] | null;
}

const MIN = 60 * 15; // ticks per minute (15 tps)
/**
 * Researchable technologies. Default research time scales with how advanced the
 * unlock is (the more powerful, the longer). All costs/times are tunable in
 * balance.json under "research".
 */
export const TECH_RULES = {
  repair: { name: 'Feldreparatur', cost: 800, time: 6 * MIN, requires: ['TECHCENTER'], factions: null },
  flak: { name: 'Flugabwehr', cost: 800, time: 6 * MIN, requires: ['TECHCENTER'], factions: null },
  spy: { name: 'Spionage', cost: 1000, time: 8 * MIN, requires: ['TECHCENTER'], factions: ['ALLIES'] },
  artillery: { name: 'Artillerie-Doktrin', cost: 1200, time: 10 * MIN, requires: ['TECHCENTER'], factions: ['ALLIES'] },
  armor: { name: 'Schwere Panzerung', cost: 1500, time: 10 * MIN, requires: ['TECHCENTER'], factions: ['SOVIETS'] },
  air: { name: 'Luftwaffentechnik', cost: 1500, time: 10 * MIN, requires: ['TECHCENTER'], factions: null },
  navy: { name: 'Marine-Doktrin', cost: 1500, time: 10 * MIN, requires: ['TECHCENTER'], factions: null },
  tesla: { name: 'Tesla-Technologie', cost: 1800, time: 12 * MIN, requires: ['TECHCENTER'], factions: ['SOVIETS'] },
  super: { name: 'Superwaffen-Programm', cost: 2500, time: 15 * MIN, requires: ['TECHCENTER'], factions: null },
} as const satisfies Record<TechId, TechRule>;

export function techRule(id: TechId): TechRule {
  return TECH_RULES[id];
}

export function isTechId(item: string): item is TechId {
  return item in TECH_RULES;
}

/** The tech that unlocks an item, if any (undefined = always buildable). */
export function techFor(item: string): TechId | undefined {
  if (isBuildingType(item)) return buildingRule(item).tech;
  if (isUnitType(item)) return unitRule(item).tech;
  return undefined;
}

export function availableToFaction(
  factions: readonly Faction[] | null,
  faction: Faction,
): boolean {
  return factions === null || factions.includes(faction);
}

/**
 * Wall tiers ("Ausbaustufen"): level 1 is placed for WALL.cost; each upgrade
 * costs `upgradeCost` and raises the wall to `maxHp` (fully repaired).
 */
export const WALL_LEVELS: ReadonlyArray<{ maxHp: number; upgradeCost: number }> = [
  { maxHp: 250, upgradeCost: 0 }, // level 1 (sandbags)
  { maxHp: 600, upgradeCost: 100 }, // level 2 (concrete)
  { maxHp: 1400, upgradeCost: 200 }, // level 3 (reinforced)
];

/** Superweapon warheads: blast radius (sub-cells) and center damage. Damage
 * falls off linearly to half at the blast edge and ignores armor classes. */
export interface SuperweaponStats {
  name: string;
  radius: number;
  damage: number;
}
export const SUPERWEAPON_STATS: Record<SuperweaponKind, SuperweaponStats> = {
  NUKE: { name: 'Atomrakete', radius: Math.round(3.5 * SUBCELL), damage: 1000 },
  STORM: { name: 'Wettersturm', radius: Math.round(4.5 * SUBCELL), damage: 550 },
};
/** Ticks a silo needs to charge (2 minutes). */
export const SUPERWEAPON_CHARGE_TICKS = 1800;
/** Ticks between firing and impact. */
export const SUPERWEAPON_TRAVEL_TICKS = 75;

/**
 * Selling refunds half of everything invested (classic C&C). For walls that
 * includes the paid upgrade tiers.
 */
export function sellRefund(type: BuildingType, level: number): number {
  let invested = BUILDING_RULES[type].cost;
  if (type === 'WALL') {
    for (let l = 1; l < level; l++) invested += WALL_LEVELS[l]!.upgradeCost;
  }
  return Math.trunc(invested / 2);
}

/** New buildings must be within this many cells of an existing own building. */
export const BUILD_ADJACENCY = 3;

/**
 * How far a building of `type` projects the buildable area, in cells.
 * Walls project 0 — they never extend where you can build (you can only place
 * a wall inside the area your real buildings already opened).
 */
export function buildAdjacency(type: BuildingType): number {
  return type === 'WALL' ? 0 : BUILD_ADJACENCY;
}
/**
 * Economy defaults. The live values below are `let` exports so a balance
 * config (see applyBalance) can retune them; importers see the live binding.
 */
const ECONOMY_DEFAULTS = {
  /** Credits every player starts with. */
  startCredits: 5000,
  /** Ore credits a harvester can carry per trip. */
  harvestCapacity: 500,
  /** Ore extracted per tick while parked on an ore cell (lower = slower). */
  harvestRate: 4,
  /** Credits per extracted unit from a gem cell ("Edelsteine"). */
  gemValue: 2,
  /**
   * Resource regrowth: every N ticks fertile cells gain AMOUNT, up to CAP.
   * Deliberately very slow (~2 min per pulse) so ore stays scarce, hoarding is
   * curbed (together with the storage cap) and matches run long — never fast
   * enough to be free income. Tunable in balance.json.
   */
  regrowthInterval: 1800,
  regrowthAmount: 3,
  regrowthCap: 500,
};
export let STARTING_CREDITS = ECONOMY_DEFAULTS.startCredits;
export let HARVEST_CAPACITY = ECONOMY_DEFAULTS.harvestCapacity;
export let HARVEST_RATE = ECONOMY_DEFAULTS.harvestRate;
export let GEM_VALUE = ECONOMY_DEFAULTS.gemValue;
export let REGROWTH_INTERVAL = ECONOMY_DEFAULTS.regrowthInterval;
export let REGROWTH_AMOUNT = ECONOMY_DEFAULTS.regrowthAmount;
export let REGROWTH_CAP = ECONOMY_DEFAULTS.regrowthCap;
/** Werkstatt repair: hp per tick and credits per tick, radius in cells. */
export const REPAIR_HP_PER_TICK = 4;
export const REPAIR_COST_PER_TICK = 1;
export const REPAIR_RADIUS = 2;
/**
 * Repair vehicle ("Reparaturfahrzeug"): drives to a damaged own building and
 * restores its hp per tick for a small credit fee. Reach is measured from the
 * building footprint edge in cells.
 */
export const VEHICLE_REPAIR_HP_PER_TICK = 8;
export const VEHICLE_REPAIR_COST_PER_TICK = 1;
export const VEHICLE_REPAIR_REACH = 1.6;
/** Ground units a transport ship can carry. */
export const TRANSPORT_CAPACITY = 5;
/** Board/unload reach between a shore unit and the ship, in cells. */
export const TRANSPORT_REACH = 2;
/** Cheats (solo games): credits per money cheat, watts per power cheat. */
export const CHEAT_MONEY = 10_000;
export const CHEAT_POWER = 300;

/* ----------------------------- balance config ---------------------------- */

/**
 * Runtime-tunable balance ("rules.ini light"). A config is applied per game
 * via GameOptions.balance. Unknown keys are ignored; broken numbers fall
 * back to the default. All values are truncated to integers (the sim only
 * does integer math); rangeCells may be fractional (converted to sub-cells).
 */
export interface EconomyBalance {
  startCredits?: number;
  harvestCapacity?: number;
  harvestRate?: number;
  gemValue?: number;
  regrowthInterval?: number;
  regrowthAmount?: number;
  regrowthCap?: number;
}
export interface UnitBalance {
  cost?: number;
  buildTime?: number;
  maxHp?: number;
  speed?: number;
  sight?: number;
  /** Weapon tuning — ignored for weaponless units. */
  damage?: number;
  rangeCells?: number;
  cooldown?: number;
}
export interface BuildingBalance {
  cost?: number;
  buildTime?: number;
  maxHp?: number;
  power?: number;
  sight?: number;
  /** Ore storage capacity (refinery/silo/conyard). */
  storage?: number;
  /** Defense-weapon tuning — ignored for unarmed buildings. */
  damage?: number;
  rangeCells?: number;
  cooldown?: number;
}
export interface BalanceConfig {
  economy?: EconomyBalance;
  units?: Partial<Record<UnitType, UnitBalance>>;
  buildings?: Partial<Record<BuildingType, BuildingBalance>>;
  /** Per-tech research cost/time overrides. */
  research?: Partial<Record<TechId, { cost?: number; time?: number }>>;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Pristine copies of the shipped tables, taken before any config touches them. */
const UNIT_DEFAULTS = JSON.parse(JSON.stringify(UNIT_RULES)) as Record<UnitType, UnitRule>;
const BUILDING_DEFAULTS = JSON.parse(JSON.stringify(BUILDING_RULES)) as Record<
  BuildingType,
  BuildingRule
>;
const TECH_DEFAULTS = JSON.parse(JSON.stringify(TECH_RULES)) as Record<TechId, TechRule>;

/** Truncated integer clamped to `min`, or null when the value is unusable. */
function intOr(v: number | undefined, min: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const t = Math.trunc(v);
  return t < min ? min : t;
}

function applyWeapon(
  weapon: WeaponRule | null,
  o: { damage?: number; rangeCells?: number; cooldown?: number },
): void {
  if (!weapon) return;
  const w = weapon as Mutable<WeaponRule>;
  w.damage = intOr(o.damage, 1) ?? w.damage;
  w.cooldown = intOr(o.cooldown, 1) ?? w.cooldown;
  if (typeof o.rangeCells === 'number' && Number.isFinite(o.rangeCells) && o.rangeCells > 0) {
    w.range = Math.round(o.rangeCells * SUBCELL);
    w.rangeSq = w.range * w.range;
  }
}

/**
 * Resets all rules to the shipped defaults, then applies the overrides.
 * Called by createGame with GameOptions.balance — configs never stack across
 * games. Do NOT call this mid-game; rules must stay frozen within a match.
 */
export function applyBalance(config?: BalanceConfig): void {
  for (const type of Object.keys(UNIT_RULES) as UnitType[]) {
    Object.assign(UNIT_RULES[type], JSON.parse(JSON.stringify(UNIT_DEFAULTS[type])));
  }
  for (const type of Object.keys(BUILDING_RULES) as BuildingType[]) {
    Object.assign(BUILDING_RULES[type], JSON.parse(JSON.stringify(BUILDING_DEFAULTS[type])));
  }
  for (const id of Object.keys(TECH_RULES) as TechId[]) {
    Object.assign(TECH_RULES[id], JSON.parse(JSON.stringify(TECH_DEFAULTS[id])));
  }
  STARTING_CREDITS = ECONOMY_DEFAULTS.startCredits;
  HARVEST_CAPACITY = ECONOMY_DEFAULTS.harvestCapacity;
  HARVEST_RATE = ECONOMY_DEFAULTS.harvestRate;
  GEM_VALUE = ECONOMY_DEFAULTS.gemValue;
  REGROWTH_INTERVAL = ECONOMY_DEFAULTS.regrowthInterval;
  REGROWTH_AMOUNT = ECONOMY_DEFAULTS.regrowthAmount;
  REGROWTH_CAP = ECONOMY_DEFAULTS.regrowthCap;
  if (!config) return;

  const eco = config.economy;
  if (eco) {
    STARTING_CREDITS = intOr(eco.startCredits, 0) ?? STARTING_CREDITS;
    HARVEST_CAPACITY = intOr(eco.harvestCapacity, 1) ?? HARVEST_CAPACITY;
    HARVEST_RATE = intOr(eco.harvestRate, 1) ?? HARVEST_RATE;
    GEM_VALUE = intOr(eco.gemValue, 1) ?? GEM_VALUE;
    REGROWTH_INTERVAL = intOr(eco.regrowthInterval, 1) ?? REGROWTH_INTERVAL;
    REGROWTH_AMOUNT = intOr(eco.regrowthAmount, 0) ?? REGROWTH_AMOUNT;
    REGROWTH_CAP = intOr(eco.regrowthCap, 0) ?? REGROWTH_CAP;
  }

  for (const [type, o] of Object.entries(config.units ?? {})) {
    if (!o || !isUnitType(type)) continue;
    const rule = UNIT_RULES[type] as unknown as Mutable<UnitRule>;
    rule.cost = intOr(o.cost, 0) ?? rule.cost;
    rule.buildTime = intOr(o.buildTime, 1) ?? rule.buildTime;
    rule.maxHp = intOr(o.maxHp, 1) ?? rule.maxHp;
    rule.speed = intOr(o.speed, 1) ?? rule.speed;
    rule.sight = intOr(o.sight, 0) ?? rule.sight;
    applyWeapon(rule.weapon, o);
  }

  for (const [type, o] of Object.entries(config.buildings ?? {})) {
    if (!o || !isBuildingType(type)) continue;
    const rule = BUILDING_RULES[type] as unknown as Mutable<BuildingRule>;
    rule.cost = intOr(o.cost, 0) ?? rule.cost;
    rule.buildTime = intOr(o.buildTime, 1) ?? rule.buildTime;
    rule.maxHp = intOr(o.maxHp, 1) ?? rule.maxHp;
    rule.power = intOr(o.power, -100000) ?? rule.power;
    rule.sight = intOr(o.sight, 0) ?? rule.sight;
    rule.storage = intOr(o.storage, 0) ?? rule.storage ?? 0;
    applyWeapon(rule.weapon, o);
  }

  for (const [id, o] of Object.entries(config.research ?? {})) {
    if (!o || !isTechId(id)) continue;
    const rule = TECH_RULES[id] as unknown as Mutable<TechRule>;
    rule.cost = intOr(o.cost, 0) ?? rule.cost;
    rule.time = intOr(o.time, 1) ?? rule.time;
  }
}
