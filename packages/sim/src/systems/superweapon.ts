import { distSq, isqrt } from '../fixed.js';
import {
  IRON_CURTAIN_TICKS,
  SUPERWEAPON_CHARGE_TICKS,
  SUPERWEAPON_STATS,
  buildingRule,
  unitRule,
} from '../rules.js';
import type { GameState, Strike } from '../state.js';
import { powerBalance } from './production.js';

/**
 * Superweapons: silos charge over time (paused while low on power), fired
 * strikes count down and detonate with an armor-ignoring area blast whose
 * damage falls off linearly to 50% at the blast edge. The iron curtain is the
 * odd one out: its "blast" deals no damage and instead grants invulnerability.
 */
export function superweaponSystem(state: GameState): void {
  // Iron curtain wears off tick by tick.
  for (const unit of state.units) if (unit.curtainTicks > 0) unit.curtainTicks--;
  for (const building of state.buildings) if (building.curtainTicks > 0) building.curtainTicks--;

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

  const inBlast = (x: number, y: number): boolean =>
    distSq(x - strike.x, y - strike.y) <= stats.radius * stats.radius;

  if (strike.kind === 'CURTAIN') {
    // Invulnerability for vehicles/ships and structures in the area — infantry
    // and aircraft are not affected (classic iron curtain rules).
    for (const unit of state.units) {
      const rule = unitRule(unit.type);
      if (rule.category === 'infantry' || rule.air === true) continue;
      if (inBlast(unit.x, unit.y)) unit.curtainTicks = IRON_CURTAIN_TICKS;
    }
    for (const building of state.buildings) {
      if (inBlast(building.x, building.y)) building.curtainTicks = IRON_CURTAIN_TICKS;
    }
    return;
  }

  const blastDamage = (x: number, y: number): number => {
    const d2 = distSq(x - strike.x, y - strike.y);
    if (d2 > stats.radius * stats.radius) return 0;
    const dist = isqrt(d2);
    // 100% at ground zero, 50% at the edge — superweapons ignore armor.
    return Math.trunc((stats.damage * (stats.radius * 2 - dist)) / (stats.radius * 2));
  };

  for (const unit of state.units) {
    if (unit.curtainTicks > 0) continue; // iron curtain shrugs off even nukes
    const dmg = blastDamage(unit.x, unit.y);
    if (dmg > 0) {
      unit.hp -= dmg;
      state.events.push({ type: 'HIT', x: unit.x, y: unit.y });
    }
  }
  for (const building of state.buildings) {
    if (building.curtainTicks > 0) continue;
    const dmg = blastDamage(building.x, building.y);
    if (dmg > 0) {
      building.hp -= dmg;
      state.events.push({ type: 'HIT', x: building.x, y: building.y });
    }
  }
}
