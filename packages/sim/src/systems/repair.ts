import { SUBCELL } from '../fixed.js';
import {
  REPAIR_COST_PER_TICK,
  REPAIR_HP_PER_TICK,
  REPAIR_RADIUS,
  buildingRule,
  unitRule,
} from '../rules.js';
import type { GameState } from '../state.js';

/**
 * Werkstatt: repairs the owner's damaged vehicles parked near the building
 * for a small credit fee per tick.
 */
export function repairSystem(state: GameState): void {
  for (const building of state.buildings) {
    if (building.type !== 'WERKSTATT') continue;
    const player = state.players.find((p) => p.id === building.owner);
    if (!player) continue;
    // Radius measured from the footprint edge, in fixed-point units.
    const rule = buildingRule(building.type);
    const reach =
      (REPAIR_RADIUS + Math.max(rule.width, rule.height) / 2) * SUBCELL;

    for (const unit of state.units) {
      if (unit.owner !== building.owner) continue;
      const uRule = unitRule(unit.type);
      if (uRule.category !== 'vehicle' || unit.hp >= uRule.maxHp) continue;
      const dx = unit.x - building.x;
      const dy = unit.y - building.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (player.credits < REPAIR_COST_PER_TICK) break;
      player.credits -= REPAIR_COST_PER_TICK;
      const healed = unit.hp + REPAIR_HP_PER_TICK;
      const newHp = healed > uRule.maxHp ? uRule.maxHp : healed;
      player.stats.healingDone += newHp - unit.hp;
      unit.hp = newHp;
    }
  }
}
