import { cellIndex, inBounds, isBuildableTerrain, isOpenWater } from '../map.js';
import { buildAdjacency, buildingRule, type BuildingType } from '../rules.js';
import type { GameState } from '../state.js';

/**
 * Placement validation: every footprint cell must be buildable ground (grass,
 * no structure, no unit, no ore) and the footprint must touch the build
 * radius of an existing own building. Water buildings (shipyard) invert the
 * terrain rule: the footprint must be open water instead.
 */
export function canPlaceBuilding(
  state: GameState,
  playerId: number,
  type: BuildingType,
  cx: number,
  cy: number,
): boolean {
  const rule = buildingRule(type);
  for (let y = cy; y < cy + rule.height; y++) {
    for (let x = cx; x < cx + rule.width; x++) {
      if (!inBounds(state, x, y)) return false;
      // Shipyards need genuinely open water — the passage under a bridge is
      // navigable for ships but not a construction site.
      const buildableHere =
        rule.onWater === true ? isOpenWater(state, x, y) : isBuildableTerrain(state, x, y);
      if (!buildableHere) return false;
      const idx = cellIndex(state, x, y);
      if (state.occupancy[idx] !== 0) return false;
      if (state.ore[idx]! > 0) return false;
    }
  }
  // Never build over a goodie crate — it would be buried unreachable forever
  // (crates are only removed by pickup or expiry).
  for (const crate of state.crates) {
    if (
      crate.cx >= cx &&
      crate.cx < cx + rule.width &&
      crate.cy >= cy &&
      crate.cy < cy + rule.height
    ) {
      return false;
    }
  }
  // Adjacency: the footprint must lie within a real building's build radius.
  // Walls never open buildable area, so they are skipped as sources — you can
  // only place a wall inside the zone your real buildings already opened.
  for (const b of state.buildings) {
    if (b.owner !== playerId || b.type === 'WALL') continue;
    const br = buildingRule(b.type);
    const dx = rectGap(cx, rule.width, b.cx, br.width);
    const dy = rectGap(cy, rule.height, b.cy, br.height);
    if ((dx > dy ? dx : dy) <= buildAdjacency(b.type)) return true;
  }
  return false;
}

/** Gap in cells between two 1-D intervals (0 if they touch/overlap). */
function rectGap(a: number, aLen: number, b: number, bLen: number): number {
  if (a + aLen - 1 < b) return b - (a + aLen - 1);
  if (b + bLen - 1 < a) return a - (b + bLen - 1);
  return 0;
}
