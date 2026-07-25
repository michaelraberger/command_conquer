import { cellIndex, inBounds, isBuildableTerrain, isOpenWater } from '../map.js';
import { buildAdjacency, buildingRule, type BuildingType } from '../rules.js';
import { footprintOf, type GameState } from '../state.js';

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
  rotated = false,
): boolean {
  const rule = buildingRule(type);
  const w = rotated ? rule.height : rule.width;
  const h = rotated ? rule.width : rule.height;
  for (let y = cy; y < cy + h; y++) {
    for (let x = cx; x < cx + w; x++) {
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
    if (crate.cx >= cx && crate.cx < cx + w && crate.cy >= cy && crate.cy < cy + h) {
      return false;
    }
  }
  // Adjacency: the footprint must lie within a real building's build radius.
  // Walls never open buildable area, so they are skipped as sources — you can
  // only place a wall inside the zone your real buildings already opened.
  for (const b of state.buildings) {
    if (b.owner !== playerId || b.type === 'WALL') continue;
    const bf = footprintOf(b);
    const dx = rectGap(cx, w, b.cx, bf.w);
    const dy = rectGap(cy, h, b.cy, bf.h);
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
