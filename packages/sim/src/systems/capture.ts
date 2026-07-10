import { buildingRule } from '../rules.js';
import { areEnemies, type Building, type GameState, type Unit } from '../state.js';
import { targetDistSq } from '../targeting.js';
import { REACH_SQ, chaseBuilding } from './spy.js';

/** The building this engineer still targets, or null if the order is stale. */
function captureTarget(state: GameState, unit: Unit): Building | null {
  const order = unit.order;
  if (!order || order.kind !== 'CAPTURE') return null;
  const building = state.buildings.find((b) => b.id === order.targetId);
  if (
    !building ||
    building.owner === unit.owner ||
    (building.owner >= 0 && !areEnemies(state, unit.owner, building.owner))
  ) {
    return null; // gone, already ours, or an ally captured it first
  }
  return building;
}

/**
 * Engineers ("Ingenieur"): walk into any enemy or neutral building and convert
 * it to their owner — the engineer is consumed, the building keeps its hp,
 * charge and rally point. Capturing an Erz-Bohrturm additionally pays its
 * one-time captureBonus. Runs BEFORE movement (like the spy) so an arriving
 * engineer captures instead of stepping past.
 */
export function captureSystem(state: GameState): void {
  const consumed = new Set<number>();

  for (const unit of state.units) {
    if (!unit.order || unit.order.kind !== 'CAPTURE') continue;
    const building = captureTarget(state, unit);
    if (!building) {
      unit.order = null;
      unit.path = null;
      unit.pathIndex = 0;
      continue;
    }
    const target = { kind: 'building', building } as const;

    if (targetDistSq(target, unit.x, unit.y) <= REACH_SQ) {
      building.owner = unit.owner;
      // Gates cache their owner in the pathing grid — re-stamp the footprint,
      // otherwise the captured gate keeps opening for the old owner.
      if (building.type === 'GATE') {
        const rule = buildingRule(building.type);
        for (let y = building.cy; y < building.cy + rule.height; y++) {
          for (let x = building.cx; x < building.cx + rule.width; x++) {
            state.gateOwner[y * state.mapWidth + x] = unit.owner + 1;
          }
        }
      }
      // Capture bounty (Erz-Bohrturm): paid unconditionally, like the drip —
      // deliberately not capped by storage.
      const bonus = buildingRule(building.type).captureBonus ?? 0;
      const player = state.players[unit.owner];
      if (bonus > 0 && player) player.credits += bonus;

      state.events.push({ type: 'HIT', x: building.x, y: building.y });
      state.events.push({ type: 'DEATH', x: unit.x, y: unit.y, big: false });
      if (state.occupancy[unit.cell] === unit.id) state.occupancy[unit.cell] = 0;
      consumed.add(unit.id);
      continue;
    }

    chaseBuilding(state, unit, target);
  }

  if (consumed.size > 0) {
    state.units = state.units.filter((u) => !consumed.has(u.id));
  }
}
