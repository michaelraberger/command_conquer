import { SUBCELL, distSq } from '../fixed.js';
import { unitRule } from '../rules.js';
import type { Building, GameState, Unit } from '../state.js';

/** A plane counts as "home" within this distance of its pad/building. */
const HOME_RADIUS = Math.round(2.5 * SUBCELL);
const HOME_RADIUS_SQ = HOME_RADIUS * HOME_RADIUS;
/** Rearm cadence at a pad/airfield: one rack per second. */
const REARM_INTERVAL_TICKS = 15;

/**
 * True while a living unit of the field's owner is bound to this Flugfeld.
 * Owner-matched on purpose: a captured field is immediately free for its new
 * owner, while the previous owner's jet lives on as an orphan (flies and
 * fights, but never rearms and no longer crashes with the field).
 */
export function airfieldOccupied(state: GameState, field: Building): boolean {
  return state.units.some(
    (u) => u.homeId === field.id && u.owner === field.owner && u.hp > 0,
  );
}

/** First own free Flugfeld in ascending building order (deterministic), or null. */
export function findFreeAirfield(state: GameState, playerId: number): Building | null {
  for (const b of state.buildings) {
    if (b.owner !== playerId || b.type !== 'FLUGFELD' || b.hp <= 0) continue;
    if (!airfieldOccupied(state, b)) return b;
  }
  return null;
}

/** Crash every own jet bound to this Flugfeld (hp = 0) — the death sweep
 *  removes them with normal DEATH events. Orphans of a previous owner survive. */
export function crashBoundJets(state: GameState, field: Building): void {
  for (const u of state.units) {
    if (u.homeId === field.id && u.owner === field.owner && u.hp > 0) u.hp = 0;
  }
}

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

/** The pad an aircraft rearms at: airfield-bound jets use ONLY their own
 *  Flugfeld (null once it is lost or captured — orphans never rearm); helis
 *  use the nearest own Hubschrauber-Landefläche. */
function rearmPad(state: GameState, unit: Unit): Building | null {
  if (unitRule(unit.type).airfieldBound === true) {
    const field = state.buildings.find((b) => b.id === unit.homeId);
    return field !== undefined && field.owner === unit.owner ? field : null;
  }
  return nearestHome(state, unit, true);
}

/**
 * Air bases: combat aircraft (rules with `ammo`) never loiter in the field.
 * Idle planes fly back home — jets to their bound Flugfeld, helis to the
 * nearest own pad, and with none left to the base — and rearm one rack per
 * second while parked at their pad. Runs after movement so a plane that just
 * finished its sortie turns for home on the same tick it goes idle.
 */
export function airbaseSystem(state: GameState): void {
  for (const unit of state.units) {
    const rule = unitRule(unit.type);
    if (rule.air !== true || rule.ammo === undefined) continue;

    const pad = rearmPad(state, unit);
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
