import { RESOURCE_GEMS, cellIndex, inBounds } from '../map.js';
import { findPath } from '../path/astar.js';
import { GEM_VALUE, HARVEST_CAPACITY, HARVEST_RATE } from '../rules.js';
import { dockCell, storageCapacity, type Building, type GameState, type Unit } from '../state.js';

/**
 * Harvester state machine: drive to ore → extract while parked → return to
 * the refinery dock → unload into credits → repeat. Idle harvesters put
 * themselves to work (classic C&C behavior); manual MOVE/STOP interrupts.
 */
export function harvestSystem(state: GameState): void {
  for (const unit of state.units) {
    if (unit.type !== 'HARVESTER') continue;

    // Auto-dispatch when completely idle.
    if (unit.order === null && unit.path === null) {
      if (unit.cargo >= HARVEST_CAPACITY) {
        if (ownRefinery(state, unit.owner)) {
          const cx = unit.cell % state.mapWidth;
          const cy = (unit.cell - cx) / state.mapWidth;
          unit.order = { kind: 'RETURN_ORE', backCx: cx, backCy: cy };
        }
      } else {
        const cx = unit.cell % state.mapWidth;
        const cy = (unit.cell - cx) / state.mapWidth;
        const ore = nearestOreCell(state, cx, cy);
        if (ore) unit.order = { kind: 'HARVEST', cx: ore.cx, cy: ore.cy };
      }
    }

    const order = unit.order;
    if (!order) continue;

    if (order.kind === 'HARVEST') {
      handleHarvest(state, unit, order.cx, order.cy);
    } else if (order.kind === 'RETURN_ORE') {
      handleReturn(state, unit, order.backCx, order.backCy);
    }
  }
}

function handleHarvest(state: GameState, unit: Unit, cx: number, cy: number): void {
  const targetIdx = cellIndex(state, cx, cy);
  const parkedThere = unit.cell === targetIdx && unit.path === null;

  if (parkedThere) {
    const available = state.ore[targetIdx]!;
    // Gems ("Edelsteine") are worth double per extracted unit.
    const value = state.resourceKind[targetIdx] === RESOURCE_GEMS ? GEM_VALUE : 1;
    const room = Math.trunc((HARVEST_CAPACITY - unit.cargo) / value);
    if (available > 0 && room > 0) {
      const take = Math.min(HARVEST_RATE, available, room);
      state.ore[targetIdx] = available - take;
      unit.cargo += take * value;
      return;
    }
    if (room <= 0 && unit.cargo > 0) {
      unit.order = ownRefinery(state, unit.owner)
        ? { kind: 'RETURN_ORE', backCx: cx, backCy: cy }
        : null;
      return;
    }
    // Cell exhausted: hop to the next ore cell nearby.
    const next = nearestOreCell(state, cx, cy);
    unit.order = next ? { kind: 'HARVEST', cx: next.cx, cy: next.cy } : null;
    return;
  }

  if (unit.path === null) {
    const ucx = unit.cell % state.mapWidth;
    const ucy = (unit.cell - ucx) / state.mapWidth;
    const path = findPath(state, ucx, ucy, cx, cy, { avoidUnits: false, selfId: unit.id, owner: unit.owner });
    if (!path) {
      unit.order = null;
      return;
    }
    unit.path = path;
    unit.pathIndex = 0;
    unit.blockedTicks = 0;
    unit.repathCount = 0;
  }
}

function handleReturn(state: GameState, unit: Unit, backCx: number, backCy: number): void {
  const refinery = ownRefinery(state, unit.owner);
  if (!refinery) {
    unit.order = null;
    return;
  }
  const dock = dockCell(refinery);
  const dockIdx = cellIndex(state, dock.cx, dock.cy);

  if (unit.cell === dockIdx && unit.path === null) {
    // Unload into credits, but only up to the owner's storage capacity — ore
    // beyond the cap is wasted (build silos to store more). Never lowers an
    // already-over-cap balance (starting funds sit above storage until spent).
    const player = state.players.find((p) => p.id === unit.owner);
    if (player) {
      const room = Math.max(0, storageCapacity(state, unit.owner) - player.credits);
      const credited = Math.min(unit.cargo, room);
      player.credits += credited;
      player.stats.creditsHarvested += credited;
    }
    unit.cargo = 0;
    const back =
      state.ore[cellIndex(state, backCx, backCy)]! > 0
        ? { cx: backCx, cy: backCy }
        : nearestOreCell(state, backCx, backCy);
    unit.order = back ? { kind: 'HARVEST', cx: back.cx, cy: back.cy } : null;
    return;
  }

  if (unit.path === null) {
    const ucx = unit.cell % state.mapWidth;
    const ucy = (unit.cell - ucx) / state.mapWidth;
    const path = findPath(state, ucx, ucy, dock.cx, dock.cy, { avoidUnits: false, selfId: unit.id, owner: unit.owner });
    if (!path) {
      unit.order = null;
      return;
    }
    unit.path = path;
    unit.pathIndex = 0;
    unit.blockedTicks = 0;
    unit.repathCount = 0;
  }
}

/** The player's refinery with the lowest id (deterministic primary). */
function ownRefinery(state: GameState, playerId: number): Building | null {
  for (const b of state.buildings) {
    if (b.owner === playerId && b.type === 'REFINERY') return b;
  }
  return null;
}

/** Nearest cell with ore via deterministic ring scan (radius ≤ 20). */
function nearestOreCell(
  state: GameState,
  cx: number,
  cy: number,
): { cx: number; cy: number } | null {
  if (inBounds(state, cx, cy) && state.ore[cellIndex(state, cx, cy)]! > 0) return { cx, cy };
  for (let r = 1; r <= 20; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ax = dx < 0 ? -dx : dx;
        const ay = dy < 0 ? -dy : dy;
        if ((ax > ay ? ax : ay) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (inBounds(state, x, y) && state.ore[cellIndex(state, x, y)]! > 0) {
          return { cx: x, cy: y };
        }
      }
    }
  }
  return null;
}
