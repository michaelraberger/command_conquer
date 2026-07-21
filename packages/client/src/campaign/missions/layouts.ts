import type { Faction, MissionBuildingPlacement, MissionUnitPlacement } from '@cac/sim';

/**
 * Reusable starting-force layouts. All coordinates are relative to a base
 * centre (usually the player's spawn) and assume the mission map cleared a
 * generous buildable plot around it (see clearRect in mapTools).
 */

export interface ForcePack {
  buildings: MissionBuildingPlacement[];
  units: MissionUnitPlacement[];
}

/** A functioning AI base: yard, economy, production, faction defenses.
 *  Soviet bases carry a THIRD power plant: four tesla coils (à −75) plus the
 *  economy draw 420 — with only two plants (+300) every coil would sit dark
 *  from tick 0 (defenses go offline in a deficit). */
export function aiBase(owner: number, sx: number, sy: number, faction: Faction): ForcePack {
  const defense = faction === 'SOVIETS' ? 'TESLA' : 'PILLBOX';
  const tank = faction === 'SOVIETS' ? 'TANK' : 'LIGHTTANK';
  const extraPower: MissionBuildingPlacement[] =
    faction === 'SOVIETS' ? [{ type: 'POWER', owner, cx: sx - 8, cy: sy - 1 }] : [];
  return {
    buildings: [
      { type: 'CONYARD', owner, cx: sx - 1, cy: sy - 1 },
      { type: 'POWER', owner, cx: sx - 6, cy: sy - 3 },
      { type: 'POWER', owner, cx: sx - 6, cy: sy },
      ...extraPower,
      { type: 'REFINERY', owner, cx: sx + 2, cy: sy - 3 },
      { type: 'BARRACKS', owner, cx: sx - 5, cy: sy + 3 },
      { type: 'FACTORY', owner, cx: sx + 1, cy: sy + 3 },
      { type: defense, owner, cx: sx - 7, cy: sy - 5 },
      { type: defense, owner, cx: sx + 5, cy: sy - 5 },
      { type: defense, owner, cx: sx - 7, cy: sy + 6 },
      { type: defense, owner, cx: sx + 5, cy: sy + 6 },
    ],
    units: [
      { type: 'HARVESTER', owner, cx: sx + 4, cy: sy + 1 },
      { type: tank, owner, cx: sx - 3, cy: sy + 5 },
      { type: tank, owner, cx: sx - 3, cy: sy + 6 },
      { type: 'RIFLEMAN', owner, cx: sx, cy: sy + 6 },
      { type: 'RIFLEMAN', owner, cx: sx + 4, cy: sy + 6 },
    ],
  };
}

/** The classic mission opener: an MCV with a small escort. */
export function mcvStart(owner: number, sx: number, sy: number, faction: Faction): ForcePack {
  const tank = faction === 'SOVIETS' ? 'TANK' : 'LIGHTTANK';
  return {
    buildings: [],
    units: [
      { type: 'MCV', owner, cx: sx, cy: sy },
      { type: tank, owner, cx: sx - 2, cy: sy - 1 },
      { type: tank, owner, cx: sx - 2, cy: sy + 1 },
      { type: 'RIFLEMAN', owner, cx: sx + 2, cy: sy - 1 },
      { type: 'RIFLEMAN', owner, cx: sx + 2, cy: sy + 1 },
    ],
  };
}

/** A pre-built player base for defense missions. Soviet variant: third power
 *  plant for the tesla coils (same arithmetic as aiBase above). */
export function playerBase(owner: number, sx: number, sy: number, faction: Faction): ForcePack {
  const defense = faction === 'SOVIETS' ? 'TESLA' : 'GUARDTOWER';
  const tank = faction === 'SOVIETS' ? 'TANK' : 'LIGHTTANK';
  const extraPower: MissionBuildingPlacement[] =
    faction === 'SOVIETS' ? [{ type: 'POWER', owner, cx: sx - 8, cy: sy - 1 }] : [];
  return {
    buildings: [
      { type: 'CONYARD', owner, cx: sx - 1, cy: sy - 1 },
      { type: 'POWER', owner, cx: sx - 6, cy: sy - 3 },
      { type: 'POWER', owner, cx: sx - 6, cy: sy },
      ...extraPower,
      { type: 'REFINERY', owner, cx: sx + 2, cy: sy - 3 },
      { type: 'BARRACKS', owner, cx: sx - 5, cy: sy + 3 },
      { type: 'FACTORY', owner, cx: sx + 1, cy: sy + 3 },
      { type: defense, owner, cx: sx - 7, cy: sy - 5 },
      { type: defense, owner, cx: sx + 5, cy: sy - 5 },
      { type: defense, owner, cx: sx - 7, cy: sy + 6 },
      { type: defense, owner, cx: sx + 5, cy: sy + 6 },
    ],
    units: [
      { type: 'HARVESTER', owner, cx: sx + 4, cy: sy + 1 },
      { type: tank, owner, cx: sx - 3, cy: sy + 5 },
      { type: tank, owner, cx: sx - 3, cy: sy + 6 },
      { type: 'RIFLEMAN', owner, cx: sx, cy: sy + 6 },
      { type: 'RIFLEMAN', owner, cx: sx + 4, cy: sy + 6 },
    ],
  };
}

/** Merge helper — concatenates force packs into one placement list pair. */
export function merge(...packs: ForcePack[]): ForcePack {
  return {
    buildings: packs.flatMap((p) => p.buildings),
    units: packs.flatMap((p) => p.units),
  };
}
