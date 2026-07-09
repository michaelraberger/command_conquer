import {
  PRISM_LINK_BONUS_PCT,
  PRISM_LINK_MAX,
  PRISM_LINK_RANGE_SQ,
  buildingRule,
  unitRule,
} from '../rules.js';
import { damageTarget, nearestEnemyUnit, weaponAcceptsUnit } from '../targeting.js';
import type { Building, GameState } from '../state.js';
import { powerBalance } from './production.js';

/**
 * Prism towers reinforce each other: every friendly, living Prism Tower within
 * link range adds a slice of damage to a firing tower (RA2 "prism linking"),
 * capped at PRISM_LINK_MAX links. Returns the number of contributing towers.
 */
function prismLinks(state: GameState, tower: Building): number {
  let links = 0;
  for (const other of state.buildings) {
    if (other === tower || other.type !== 'PRISM' || other.owner !== tower.owner) continue;
    if (other.hp <= 0) continue;
    const dx = other.x - tower.x;
    const dy = other.y - tower.y;
    if (dx * dx + dy * dy <= PRISM_LINK_RANGE_SQ) links++;
  }
  return links > PRISM_LINK_MAX ? PRISM_LINK_MAX : links;
}

/**
 * Auto-firing base defenses (Tesla coil, pillbox, flak tower, prism tower).
 * Classic rule: defenses go OFFLINE while the owner has a power deficit. Flak
 * towers only hit aircraft; ground defenses only hit ground (per weapon.targets).
 * Towers deliberately IGNORE wall cover (losBlockedByWall): they are elevated,
 * so the classic wall-ring-plus-towers base keeps working while attackers on
 * the ground cannot shoot back through the wall.
 */
export function defenseSystem(state: GameState): void {
  const lowPower: boolean[] = state.players.map((p) => {
    const { produced, used } = powerBalance(state, p.id);
    return used > produced;
  });

  for (const building of state.buildings) {
    const weapon = buildingRule(building.type).weapon;
    if (!weapon) continue;
    if (building.cooldown > 0) building.cooldown--;
    if (lowPower[building.owner]!) continue; // offline
    if (building.cooldown > 0) continue;

    // Threat priority: armed attackers soak tower fire before a harvester
    // that merely trundles past (same rule as unit auto-acquisition).
    const accept = weaponAcceptsUnit(weapon);
    const target =
      nearestEnemyUnit(
        state,
        building.owner,
        building.x,
        building.y,
        weapon.rangeSq,
        (u) => accept(u) && unitRule(u.type).weapon !== null,
      ) ?? nearestEnemyUnit(state, building.owner, building.x, building.y, weapon.rangeSq, accept);
    if (!target) continue;
    building.cooldown = weapon.cooldown;
    state.events.push({
      type: 'SHOT',
      x: building.x,
      y: building.y,
      tx: target.x,
      ty: target.y,
      fx: weapon.fx,
    });
    // Prism towers combine beams: boost damage by each linked friendly tower.
    const links = building.type === 'PRISM' ? prismLinks(state, building) : 0;
    const shot =
      links > 0
        ? { ...weapon, damage: Math.trunc((weapon.damage * (100 + links * PRISM_LINK_BONUS_PCT)) / 100) }
        : weapon;
    // All current defenses are hitscan; projectile support comes free via
    // the unit path if ever needed.
    damageTarget(state, { kind: 'unit', unit: target }, shot);
  }
}
