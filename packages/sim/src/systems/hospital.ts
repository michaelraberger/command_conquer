import { isInfantryType } from '../map.js';
import { HOSPITAL_HP_PER_TICK, buildingRule, unitRule } from '../rules.js';
import type { GameState } from '../state.js';

/**
 * Lazarett (neutral tech building, capturable by engineers): while a player
 * owns at least one hospital, their infantry slowly regenerates in the field,
 * free of charge. Computed as a per-player boolean first, so several
 * hospitals never stack.
 */
export function hospitalSystem(state: GameState): void {
  let owners: Set<number> | null = null;
  for (const b of state.buildings) {
    if (b.owner < 0) continue;
    if ((buildingRule(b.type).heal ?? 0) <= 0) continue;
    (owners ??= new Set()).add(b.owner);
  }
  if (!owners) return;
  for (const unit of state.units) {
    if (!owners.has(unit.owner)) continue;
    if (!isInfantryType(unit.type)) continue;
    const maxHp = unitRule(unit.type).maxHp;
    if (unit.hp < maxHp) {
      const healed = Math.min(maxHp, unit.hp + HOSPITAL_HP_PER_TICK);
      const p = state.players[unit.owner];
      if (p) p.stats.healingDone += healed - unit.hp;
      unit.hp = healed;
    }
  }
}
