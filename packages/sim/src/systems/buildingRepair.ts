import {
  BUILDING_REPAIR_COST_DIVISOR,
  BUILDING_REPAIR_HP_PER_TICK,
  buildingRule,
} from '../rules.js';
import type { GameState } from '../state.js';
import { buildingMaxHp } from '../targeting.js';

/** Emit a repair sparkle every few ticks (avoids event spam). */
const SPARKLE_INTERVAL = 5;

/**
 * Building self-repair mode (sidebar wrench): every flagged building heals a
 * few hp per tick, paid from the owner's credits at a rate proportional to
 * the building's price — a full 0→max repair costs 1/DIVISOR of the build
 * cost. Broke players keep the flag but the repair pauses; at full hp the
 * flag clears itself.
 */
export function buildingRepairSystem(state: GameState): void {
  for (const building of state.buildings) {
    if (!building.repairing) continue;
    const maxHp = buildingMaxHp(building);
    if (building.hp >= maxHp) {
      building.repairing = false;
      continue;
    }
    const player = state.players.find((p) => p.id === building.owner);
    if (!player) {
      building.repairing = false; // neutral/ownerless: nobody can pay
      continue;
    }
    const costPerTick = Math.max(
      1,
      Math.round(
        (buildingRule(building.type).cost * BUILDING_REPAIR_HP_PER_TICK) /
          (maxHp * BUILDING_REPAIR_COST_DIVISOR),
      ),
    );
    if (player.credits < costPerTick) continue; // broke: pause, keep the flag
    player.credits -= costPerTick;
    building.hp = Math.min(maxHp, building.hp + BUILDING_REPAIR_HP_PER_TICK);
    if (building.hp >= maxHp) building.repairing = false;
    if (state.tick % SPARKLE_INTERVAL === 0) {
      state.events.push({ type: 'REPAIR', x: building.x, y: building.y });
    }
  }
}
