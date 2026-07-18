import { cellCenter } from '../fixed.js';
import { cellIndex, cellsAroundRect, inBounds, isPassableTerrain, reserveCell } from '../map.js';
import {
  PARADROP_COOLDOWN_TICKS,
  PARADROP_COUNTS,
  PARADROP_DROP_RADIUS,
  PARADROP_UNIT,
} from '../rules.js';
import { createPassenger, spawnUnit, type GameState, type Unit } from '../state.js';

/**
 * Paradrop support power: free, gated on owning a Flugfeld, one per-player
 * cooldown (multiple Flugplätze do NOT stack). A real, shoot-downable
 * transport plane (PARAPLANE) flies a straight line across the map — nearest
 * edge in, over the target, opposite edge out — and drops its paratroopers at
 * the target. Passengers live only in `plane.passengers`, so anti-air killing
 * the plane loses the whole squad (deathSystem never sees them).
 */

/** Entry cell on the nearest map edge, on the target's row/column. Fixed
 *  tie-break order West/East/North/South keeps it deterministic. */
function entryCell(state: GameState, cx: number, cy: number): { cx: number; cy: number } {
  const w = state.mapWidth - 1;
  const h = state.mapHeight - 1;
  const candidates = [
    { cx: 0, cy, d: cx }, // west
    { cx: w, cy, d: w - cx }, // east
    { cx, cy: 0, d: cy }, // north
    { cx, cy: h, d: h - cy }, // south
  ];
  let best = candidates[0]!;
  for (const c of candidates) if (c.d < best.d) best = c;
  return { cx: best.cx, cy: best.cy };
}

/** Exit point mirrored onto the opposite edge — one straight flyover line. */
function exitCell(state: GameState, entry: { cx: number; cy: number }, cx: number, cy: number): {
  cx: number;
  cy: number;
} {
  const w = state.mapWidth - 1;
  const h = state.mapHeight - 1;
  if (entry.cx === 0) return { cx: w, cy };
  if (entry.cx === w) return { cx: 0, cy };
  if (entry.cy === 0) return { cx, cy: h };
  return { cx, cy: 0 };
}

/**
 * Launches the paradrop for a validated PARADROP command: resets the player's
 * cooldown and spawns the loaded plane at the map edge, headed for the target.
 * Called from applyCommands; validation (cooldown, Flugfeld) happens there.
 */
export function launchParadrop(state: GameState, playerId: number, cx: number, cy: number): void {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.paradropCooldown = PARADROP_COOLDOWN_TICKS;
  const entry = entryCell(state, cx, cy);
  const plane = spawnUnit(state, 'PARAPLANE', playerId, entry.cx, entry.cy);
  for (let i = 0; i < PARADROP_COUNTS[player.faction]; i++) {
    plane.passengers.push(createPassenger(state, PARADROP_UNIT, playerId, entry.cx, entry.cy));
  }
  plane.order = { kind: 'PARADROP', cx, cy };
  plane.path = [{ cx, cy }];
  plane.pathIndex = 0;
}

/** Spiral-drop around the target cell: passable, unoccupied, structure-free
 *  cells only (stricter than unloadTransport — no landing on buildings).
 *  Troopers that don't fit stay aboard and are lost with the plane. */
function dropPassengers(state: GameState, plane: Unit, cx: number, cy: number): void {
  const remaining: Unit[] = [...plane.passengers];
  for (let r = 0; r <= PARADROP_DROP_RADIUS && remaining.length > 0; r++) {
    const cells = r === 0 ? [{ cx, cy }] : cellsAroundRect(cx, cy, 1, 1, r);
    for (const cell of cells) {
      if (remaining.length === 0) break;
      if (!inBounds(state, cell.cx, cell.cy)) continue;
      if (!isPassableTerrain(state, cell.cx, cell.cy)) continue;
      const idx = cellIndex(state, cell.cx, cell.cy);
      if (state.occupancy[idx] !== 0 || state.structures[idx] !== 0) continue;
      const unit = remaining.shift()!;
      unit.x = cellCenter(cell.cx);
      unit.y = cellCenter(cell.cy);
      unit.path = null;
      unit.pathIndex = 0;
      unit.order = null;
      unit.blockedTicks = 0;
      unit.repathCount = 0;
      reserveCell(state, unit, idx);
      state.units.push(unit);
      state.events.push({ type: 'PARADROP', x: unit.x, y: unit.y });
    }
  }
  plane.passengers = remaining;
}

/**
 * Runs right AFTER movementSystem: flyAir nulls a plane's path exactly on
 * arrival, which is the phase signal here — inbound (order PARADROP) planes
 * drop and turn around, outbound (order null) planes despawn at the edge.
 * Despawn is a silent filter (transport-boarding precedent), NOT an hp kill:
 * no death explosion at the map edge, and a real shoot-down stays
 * distinguishable. Also charges every player's paradrop cooldown.
 */
export function paradropSystem(state: GameState): void {
  for (const player of state.players) {
    if (
      player.paradropCooldown > 0 &&
      state.buildings.some((b) => b.owner === player.id && b.type === 'FLUGFELD')
    ) {
      player.paradropCooldown--;
    }
  }

  let despawn: Set<number> | null = null;
  for (const unit of state.units) {
    if (unit.type !== 'PARAPLANE') continue;
    const order = unit.order;
    if (order && order.kind === 'PARADROP') {
      if (unit.path !== null) continue; // still inbound
      dropPassengers(state, unit, order.cx, order.cy);
      const exit = exitCell(state, entryCell(state, order.cx, order.cy), order.cx, order.cy);
      unit.order = null;
      unit.path = [exit];
      unit.pathIndex = 0;
    } else if (unit.path === null) {
      (despawn ??= new Set()).add(unit.id); // reached the exit edge
    }
  }
  if (despawn !== null) {
    const gone = despawn;
    state.units = state.units.filter((u) => !gone.has(u.id));
  }
}
