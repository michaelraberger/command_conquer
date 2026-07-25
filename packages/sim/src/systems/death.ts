import { TERRAIN_BRIDGE_WRECK, cellIndex, releaseCell } from '../map.js';
import { buildingRule, unitRule } from '../rules.js';
import {
  bumpStat,
  footprintOf,
  storedInBuilding,
  type Building,
  type GameState,
  type Unit,
} from '../state.js';
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

  // Kernschmelze: a dying meltdown building (Atomkraftwerk) blasts EVERYTHING
  // around it — friend and foe, unattributed like the crate bomb. Worklist
  // loop so a chain reaction (meltdown kills the neighbor ATOM) fires within
  // the same tick regardless of array order; iron curtain shields as usual.
  // Runs before the sweeps so all victims are removed this very tick.
  const melted = new Set<number>();
  for (let again = true; again; ) {
    again = false;
    for (const b of state.buildings) {
      if (b.hp > 0 || melted.has(b.id)) continue;
      const meltdown = buildingRule(b.type).meltdown;
      if (!meltdown) continue;
      melted.add(b.id);
      again = true;
      const bf = footprintOf(b);
      const ccx = b.cx + (bf.w >> 1);
      const ccy = b.cy + (bf.h >> 1);
      const r2 = meltdown.radius * meltdown.radius;
      for (const u of state.units) {
        if (u.curtainTicks > 0 || unitRule(u.type).air === true) continue;
        const ux = u.cell % state.mapWidth;
        const uy = (u.cell - ux) / state.mapWidth;
        if ((ux - ccx) * (ux - ccx) + (uy - ccy) * (uy - ccy) > r2) continue;
        u.hp -= meltdown.damage;
        state.events.push({ type: 'HIT', x: u.x, y: u.y });
      }
      for (const other of state.buildings) {
        if (other.id === b.id || other.hp <= 0 || other.curtainTicks > 0) continue;
        const ofp = footprintOf(other);
        let inRange = false;
        for (let y = other.cy; y < other.cy + ofp.h && !inRange; y++) {
          for (let x = other.cx; x < other.cx + ofp.w; x++) {
            if ((x - ccx) * (x - ccx) + (y - ccy) * (y - ccy) <= r2) {
              inRange = true;
              break;
            }
          }
        }
        if (!inRange) continue;
        other.hp -= meltdown.damage;
        state.events.push({ type: 'HIT', x: other.x, y: other.y });
      }
      state.events.push({ type: 'MELTDOWN', x: b.x, y: b.y });
    }
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
      // Match stats: losses count on the victim's side, passengers sink with
      // their transport. (Consumed engineers/spies never pass through here —
      // capture/spy remove them directly, so they are deliberately NOT losses.)
      const owner = state.players[unit.owner];
      if (owner) {
        bumpStat(owner.stats.unitsLost, unit.type);
        for (const pas of unit.passengers) {
          const pOwner = state.players[pas.owner];
          if (pOwner) bumpStat(pOwner.stats.unitsLost, pas.type);
        }
      }
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
      const { w, h } = footprintOf(building);
      for (let y = building.cy; y < building.cy + h; y++) {
        for (let x = building.cx; x < building.cx + w; x++) {
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
      // Match stats: neutral scenery (bridges, tech buildings) has no player.
      if (building.owner >= 0) {
        const owner = state.players[building.owner];
        if (owner) bumpStat(owner.stats.buildingsLost, building.type);
      }
    }
    state.buildings = standing;
  }
}
