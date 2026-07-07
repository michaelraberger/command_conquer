import { cellIndex, inBounds } from '../map.js';
import { buildingRule, unitRule } from '../rules.js';
import { FOG_EXPLORED, FOG_VISIBLE, type GameState } from '../state.js';

/** Fog refresh cadence in ticks (cheap enough, still feels instant). */
const FOG_INTERVAL = 3;

/** Precomputed circular sight offsets per radius (pure geometry, cacheable). */
const offsetCache = new Map<number, Array<[number, number]>>();

function sightOffsets(radius: number): Array<[number, number]> {
  let cached = offsetCache.get(radius);
  if (cached) return cached;
  cached = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius + 1) cached.push([dx, dy]);
    }
  }
  offsetCache.set(radius, cached);
  return cached;
}

/**
 * Per-player fog of war: visible cells decay to explored, then every own
 * unit and building stamps its sight radius back in. Fog lives in the sim —
 * the AI and (later) the server need the same truth as the renderer.
 */
export function fogSystem(state: GameState): void {
  if (state.tick % FOG_INTERVAL !== 0) return;

  for (const player of state.players) {
    const fog = state.fogs[player.id]!;
    if (player.mapRevealed) {
      // Reveal cheat: everything stays permanently visible.
      fog.fill(FOG_VISIBLE);
      continue;
    }
    for (let i = 0; i < fog.length; i++) {
      if (fog[i] === FOG_VISIBLE) fog[i] = FOG_EXPLORED;
    }

    const stamp = (cx: number, cy: number, radius: number): void => {
      for (const [dx, dy] of sightOffsets(radius)) {
        const x = cx + dx;
        const y = cy + dy;
        if (inBounds(state, x, y)) fog[cellIndex(state, x, y)] = FOG_VISIBLE;
      }
    };

    /**
     * Buildings see `radius` cells beyond their FOOTPRINT edge (distance to
     * the rectangle, not to a center cell) — otherwise even-sized footprints
     * stamp off-center and the revealed area sits lopsided around big
     * structures (visible as black bites inside the build-radius circle).
     */
    const stampRect = (bx: number, by: number, w: number, h: number, radius: number): void => {
      for (let y = by - radius; y <= by + h - 1 + radius; y++) {
        for (let x = bx - radius; x <= bx + w - 1 + radius; x++) {
          if (!inBounds(state, x, y)) continue;
          const dx = x < bx ? bx - x : x > bx + w - 1 ? x - (bx + w - 1) : 0;
          const dy = y < by ? by - y : y > by + h - 1 ? y - (by + h - 1) : 0;
          if (dx * dx + dy * dy <= radius * radius + 1) {
            fog[cellIndex(state, x, y)] = FOG_VISIBLE;
          }
        }
      }
    };

    for (const unit of state.units) {
      if (unit.owner !== player.id) continue;
      const cx = unit.cell % state.mapWidth;
      stamp(cx, (unit.cell - cx) / state.mapWidth, unitRule(unit.type).sight);
    }
    for (const building of state.buildings) {
      if (building.owner !== player.id) continue;
      const rule = buildingRule(building.type);
      stampRect(building.cx, building.cy, rule.width, rule.height, rule.sight);
    }
  }
}
