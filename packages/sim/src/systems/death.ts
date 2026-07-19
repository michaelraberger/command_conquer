import { TERRAIN_BRIDGE_WRECK, cellIndex, releaseCell } from '../map.js';
import { buildingRule, unitRule } from '../rules.js';
import { storedInBuilding, type Building, type GameState, type Unit } from '../state.js';
import { crashBoundJets } from './airbase.js';

/**
 * Removes units and buildings at 0 hp, frees their grid reservations and
 * emits DEATH events. Runs last so entities killed this tick still acted
 * deterministically.
 */
export function deathSystem(state: GameState): void {
  // A dying Flugfeld takes its bound jet down with it (RA2-style): crash the
  // jet first so the unit sweep below removes it in the same tick.
  for (const b of state.buildings) {
    if (b.hp <= 0 && b.type === 'FLUGFELD') crashBoundJets(state, b);
  }

  // A collapsing bridge span leaves an impassable wreck cell and drops
  // everyone standing on the deck into the water (ships passing beneath and
  // aircraft above are spared). Runs before the unit sweep so victims are
  // removed in the same tick.
  for (const b of state.buildings) {
    if (b.hp > 0 || b.type !== 'BRIDGE') continue;
    const idx = cellIndex(state, b.cx, b.cy);
    state.terrain[idx] = TERRAIN_BRIDGE_WRECK;
    for (const u of state.units) {
      const rule = unitRule(u.type);
      if (u.hp > 0 && u.cell === idx && rule.air !== true && rule.category !== 'naval') {
        u.hp = 0;
      }
    }
    state.events.push({ type: 'BRIDGE_DOWN', cx: b.cx, cy: b.cy });
  }

  if (state.units.some((u) => u.hp <= 0)) {
    const survivors: Unit[] = [];
    for (const unit of state.units) {
      if (unit.hp > 0) {
        survivors.push(unit);
        continue;
      }
      releaseCell(state, unit);
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
      // A destroyed storage building forfeits the ore held in it (computed
      // against the still-full building list, before removal).
      const stored = storedInBuilding(state, building);
      if (stored > 0) {
        const player = state.players[building.owner];
        if (player) player.credits = Math.max(0, player.credits - stored);
      }
      const rule = buildingRule(building.type);
      for (let y = building.cy; y < building.cy + rule.height; y++) {
        for (let x = building.cx; x < building.cx + rule.width; x++) {
          const idx = y * state.mapWidth + x;
          if (state.structures[idx] === building.id) {
            state.structures[idx] = 0;
            state.gateOwner[idx] = 0;
          }
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
