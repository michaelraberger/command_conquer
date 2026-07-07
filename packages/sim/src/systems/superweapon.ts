import { distSq, isqrt } from '../fixed.js';
import {
  SUPERWEAPON_CHARGE_TICKS,
  SUPERWEAPON_STATS,
  buildingRule,
} from '../rules.js';
import type { GameState, Strike } from '../state.js';
import { powerBalance } from './production.js';

/**
 * Superweapons: silos charge over time (paused while low on power), fired
 * strikes count down and detonate with an armor-ignoring area blast whose
 * damage falls off linearly to 50% at the blast edge.
 */
export function superweaponSystem(state: GameState): void {
  let lowPower: boolean[] | null = null;
  for (const building of state.buildings) {
    if (buildingRule(building.type).superweapon === null) continue;
    if (building.charge >= SUPERWEAPON_CHARGE_TICKS) continue;
    lowPower ??= state.players.map((p) => {
      const { produced, used } = powerBalance(state, p.id);
      return used > produced;
    });
    if (!lowPower[building.owner]) building.charge++;
  }

  if (state.strikes.length === 0) return;
  const pending: Strike[] = [];
  for (const strike of state.strikes) {
    strike.countdown--;
    if (strike.countdown > 0) {
      pending.push(strike);
      continue;
    }
    detonate(state, strike);
  }
  state.strikes = pending;
}

function detonate(state: GameState, strike: Strike): void {
  const stats = SUPERWEAPON_STATS[strike.kind];
  state.events.push({ type: 'SUPERWEAPON', x: strike.x, y: strike.y, kind: strike.kind });

  const blastDamage = (x: number, y: number): number => {
    const d2 = distSq(x - strike.x, y - strike.y);
    if (d2 > stats.radius * stats.radius) return 0;
    const dist = isqrt(d2);
    // 100% at ground zero, 50% at the edge — superweapons ignore armor.
    return Math.trunc((stats.damage * (stats.radius * 2 - dist)) / (stats.radius * 2));
  };

  for (const unit of state.units) {
    const dmg = blastDamage(unit.x, unit.y);
    if (dmg > 0) {
      unit.hp -= dmg;
      state.events.push({ type: 'HIT', x: unit.x, y: unit.y });
    }
  }
  for (const building of state.buildings) {
    const dmg = blastDamage(building.x, building.y);
    if (dmg > 0) {
      building.hp -= dmg;
      state.events.push({ type: 'HIT', x: building.x, y: building.y });
    }
  }
}
