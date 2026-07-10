import type { AggroKind } from '../events.js';
import { SUBCELL, toCell } from '../fixed.js';
import { unitRule, type UnitRule } from '../rules.js';
import type { GameState } from '../state.js';

/** Idle defenders within this radius of a hit friendly unit/building respond. */
const ALERT_RADIUS_CELLS = 14;
const ALERT_RADIUS_SQ = (ALERT_RADIUS_CELLS * SUBCELL) ** 2;

/** Can this unit's weapon plausibly fight an attacker of the given kind?
 *  Keeps dogs from charging tanks and flak troopers from charging artillery. */
function canAnswer(rule: UnitRule, akind: AggroKind): boolean {
  const weapon = rule.weapon;
  if (!weapon) return false; // harvesters, MCV, spy
  if (akind === 'air') return weapon.targets !== 'ground';
  if (weapon.targets === 'air') return false;
  if (rule.antiInfantryOnly === true) return akind === 'infantry';
  if (rule.navalOnly === true) return akind === 'naval';
  return true;
}

/**
 * Base-under-attack response: every AGGRO event of this tick (someone of
 * `owner` took damage from an attacker at ax/ay) sends idle units near the
 * victim on an attack-move toward the attacker's position — but only units
 * whose weapon can actually answer that attacker. This closes the gap left by
 * the 8-cell guard stance: artillery and V3 shell a base from beyond guard
 * range, and without this the defenders would just stand there.
 *
 * Runs late in the tick (after combat/defense/projectile damage) so it sees
 * all of this tick's events. Deterministic: events and units are iterated in
 * their fixed array order, and only order-less units are touched.
 */
export function defenseReactionSystem(state: GameState): void {
  for (const ev of state.events) {
    if (ev.type !== 'AGGRO') continue;
    const acx = toCell(ev.ax);
    const acy = toCell(ev.ay);
    for (const unit of state.units) {
      if (unit.owner !== ev.owner || unit.order !== null || unit.path !== null) continue;
      if (!canAnswer(unitRule(unit.type), ev.akind)) continue;
      const dx = unit.x - ev.x;
      const dy = unit.y - ev.y;
      if (dx * dx + dy * dy > ALERT_RADIUS_SQ) continue;
      // Attack-move: fight everything on the way, re-evaluate on arrival —
      // the same self-limiting behavior the guard stance uses.
      unit.order = { kind: 'ATTACK_MOVE', cx: acx, cy: acy };
    }
  }
}
