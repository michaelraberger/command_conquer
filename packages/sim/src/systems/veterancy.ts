import { ELITE_HEAL_INTERVAL, unitRule, veterancyRank } from '../rules.js';
import type { GameState } from '../state.js';

/**
 * Elite perk (rank 2): slow self-healing in the field, +1 hp every
 * ELITE_HEAL_INTERVAL ticks, staggered by unit id so a whole elite army
 * doesn't pulse in sync. Damage bonuses live in damageTarget; promotion is
 * just a kill-count threshold (veterancyRank) — nothing to tick there.
 */
export function veterancySystem(state: GameState): void {
  for (const unit of state.units) {
    if (veterancyRank(unit.kills) < 2) continue;
    if ((state.tick + unit.id) % ELITE_HEAL_INTERVAL !== 0) continue;
    const maxHp = unitRule(unit.type).maxHp;
    if (unit.hp > 0 && unit.hp < maxHp) unit.hp++;
  }
}
