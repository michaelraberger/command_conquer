import { buildingRule } from '../rules.js';
import { damageTarget, nearestEnemyUnit, weaponAcceptsUnit } from '../targeting.js';
import type { GameState } from '../state.js';
import { powerBalance } from './production.js';

/**
 * Auto-firing base defenses (Tesla coil, pillbox, flak tower). Classic rule:
 * defenses go OFFLINE while the owner has a power deficit. Flak towers only
 * hit aircraft; ground defenses only hit ground (per weapon.targets).
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

    const target = nearestEnemyUnit(
      state,
      building.owner,
      building.x,
      building.y,
      weapon.rangeSq,
      weaponAcceptsUnit(weapon),
    );
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
    // Both current defenses are hitscan; projectile support comes free via
    // the unit path if ever needed.
    damageTarget(state, { kind: 'unit', unit: target }, weapon);
  }
}
