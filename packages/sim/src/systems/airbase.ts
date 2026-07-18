import { SUBCELL, distSq } from '../fixed.js';
import { unitRule } from '../rules.js';
import type { Building, GameState, Unit } from '../state.js';

/** A plane counts as "home" within this distance of its pad/building. */
const HOME_RADIUS = Math.round(2.5 * SUBCELL);
const HOME_RADIUS_SQ = HOME_RADIUS * HOME_RADIUS;
/** Rearm cadence at a Flugplatz: one rack per second. */
const REARM_INTERVAL_TICKS = 15;

/** Nearest own building of the wanted kind, by squared distance (ties: lower id). */
function nearestHome(state: GameState, unit: Unit, padsOnly: boolean): Building | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of state.buildings) {
    if (b.owner !== unit.owner) continue;
    if (padsOnly ? b.type !== 'HELIPAD' : b.type === 'WALL') continue;
    const d = distSq(b.x - unit.x, b.y - unit.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/**
 * Air bases: combat aircraft (rules with `ammo`) never loiter in the field.
 * Idle planes fly back to the nearest own Flugplatz — or, with no pad left,
 * to the base — and rearm one rack per second while parked at a pad. Runs
 * after movement so a plane that just finished its sortie turns for home on
 * the same tick it goes idle.
 */
export function airbaseSystem(state: GameState): void {
  for (const unit of state.units) {
    const rule = unitRule(unit.type);
    if (rule.air !== true || rule.ammo === undefined) continue;

    const pad = nearestHome(state, unit, true);
    const home = pad ?? nearestHome(state, unit, false);
    if (!home) continue; // nothing left to return to — hold position

    const atHome = distSq(home.x - unit.x, home.y - unit.y) <= HOME_RADIUS_SQ;

    // Rearm at the pad (never at a mere rally building like the Bauhof).
    if (
      pad !== null &&
      home === pad &&
      atHome &&
      unit.ammo < rule.ammo &&
      state.tick % REARM_INTERVAL_TICKS === 0
    ) {
      unit.ammo++;
    }

    // Idle and away from home → fly back. Small per-id offset spreads a wing
    // around the pad instead of stacking every plane on the same spot.
    if (unit.order === null && unit.path === null && !atHome) {
      const w = state.mapWidth;
      const hcx = Math.min(w - 1, Math.max(0, Math.trunc(home.x / SUBCELL) + (unit.id % 3) - 1));
      const hcy = Math.min(state.mapHeight - 1, Math.max(0, Math.trunc(home.y / SUBCELL) + (Math.trunc(unit.id / 3) % 3) - 1));
      unit.path = [{ cx: hcx, cy: hcy }];
      unit.pathIndex = 0;
    }
  }
}
