import { buildingRule } from '../rules.js';
import type { Building, GameState, Unit } from '../state.js';

/**
 * Removes units and buildings at 0 hp, frees their grid reservations and
 * emits DEATH events. Runs last so entities killed this tick still acted
 * deterministically.
 */
export function deathSystem(state: GameState): void {
  if (state.units.some((u) => u.hp <= 0)) {
    const survivors: Unit[] = [];
    for (const unit of state.units) {
      if (unit.hp > 0) {
        survivors.push(unit);
        continue;
      }
      if (state.occupancy[unit.cell] === unit.id) state.occupancy[unit.cell] = 0;
      state.events.push({ type: 'DEATH', x: unit.x, y: unit.y, big: false });
    }
    state.units = survivors;
  }

  if (state.buildings.some((b) => b.hp <= 0)) {
    const standing: Building[] = [];
    for (const building of state.buildings) {
      if (building.hp > 0) {
        standing.push(building);
        continue;
      }
      const rule = buildingRule(building.type);
      for (let y = building.cy; y < building.cy + rule.height; y++) {
        for (let x = building.cx; x < building.cx + rule.width; x++) {
          const idx = y * state.mapWidth + x;
          if (state.structures[idx] === building.id) state.structures[idx] = 0;
        }
      }
      state.events.push({
        type: 'DEATH',
        x: building.x,
        y: building.y,
        big: building.type !== 'WALL',
      });
    }
    state.buildings = standing;
  }
}
