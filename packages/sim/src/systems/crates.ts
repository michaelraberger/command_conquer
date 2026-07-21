import { cellCenter } from '../fixed.js';
import {
  RESOURCE_NONE,
  TERRAIN_BRIDGE,
  cellIndex,
  cellsAroundRect,
  inBounds,
  isPassableTerrain,
} from '../map.js';
import { nextInt } from '../rng.js';
import {
  CRATE_BOMB_DAMAGE,
  CRATE_BOMB_RADIUS,
  CRATE_HEAL_RADIUS,
  CRATE_INTERVAL_TICKS,
  CRATE_LIFETIME_TICKS,
  CRATE_MONEY,
  ELITE_KILLS,
  VETERAN_KILLS,
  availableToFaction,
  crateMax,
  unitRule,
  veterancyRank,
  type UnitType,
} from '../rules.js';
import { FOG_EXPLORED, FOG_HIDDEN, spawnUnit, type Crate, type GameState } from '../state.js';

/** Free-unit crate candidates, filtered by the collector's faction. */
const CRATE_UNITS: readonly UnitType[] = ['TANK', 'LIGHTTANK', 'SCOUT'];

/** Spawn attempts per interval — a busy map may simply yield no crate. */
const SPAWN_ATTEMPTS = 10;
/** Squared cell distance a crate keeps from every player spawn (base area). */
const SPAWN_KEEPOUT_SQ = 10 * 10;

/**
 * Classic C&C goodie crates: every CRATE_INTERVAL_TICKS a crate drops on a
 * random free ground cell (never near a base), up to a map-size-scaled cap.
 * The first ground unit standing on the cell collects it: money, a squad
 * heal, a map reveal (explored, not live vision), or a free vehicle.
 * Everything runs off the seeded sim RNG and fixed iteration order, so it is
 * lockstep-deterministic.
 */
export function crateSystem(state: GameState): void {
  expireCrates(state);
  spawnCrates(state);
  collectCrates(state);
}

/** Unclaimed crates evaporate after a while — nothing may clog the cap. */
function expireCrates(state: GameState): void {
  if (state.crates.length === 0) return;
  const cutoff = state.tick - CRATE_LIFETIME_TICKS;
  if (state.crates.some((c) => c.born <= cutoff)) {
    state.crates = state.crates.filter((c) => c.born > cutoff);
  }
}

function spawnCrates(state: GameState): void {
  if (state.tick === 0 || state.tick % CRATE_INTERVAL_TICKS !== 0) return;
  if (state.crates.length >= crateMax(state.mapWidth * state.mapHeight)) return;
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const cx = nextInt(state, state.mapWidth);
    const cy = nextInt(state, state.mapHeight);
    const idx = cellIndex(state, cx, cy);
    if (!isPassableTerrain(state, cx, cy)) continue;
    // Never on a bridge deck: a collapsed span would strand the crate on an
    // unreachable wreck cell for good.
    if (state.terrain[idx] === TERRAIN_BRIDGE) continue;
    if (state.structures[idx] !== 0 || state.occupancy[idx] !== 0) continue;
    if (state.ore[idx] !== 0 || state.resourceKind[idx] !== RESOURCE_NONE) continue;
    if (state.spawns.some(([sx, sy]) => (cx - sx) * (cx - sx) + (cy - sy) * (cy - sy) <= SPAWN_KEEPOUT_SQ)) {
      continue;
    }
    if (state.crates.some((c) => c.cx === cx && c.cy === cy)) continue;
    // 3/8 money, then one slot each: heal, reveal, free unit, promotion — and
    // one booby trap, so grabbing an unscouted crate carries real risk.
    const roll = nextInt(state, 8);
    const kind =
      roll <= 2
        ? 'MONEY'
        : roll === 3
          ? 'HEAL'
          : roll === 4
            ? 'REVEAL'
            : roll === 5
              ? 'UNIT'
              : roll === 6
                ? 'VETERAN'
                : 'BOMB';
    state.crates.push({ id: state.nextEntityId++, cx, cy, kind, born: state.tick });
    return;
  }
}

function collectCrates(state: GameState): void {
  if (state.crates.length === 0) return;
  // Units iterate in array order (deterministic); the first ground unit on a
  // crate cell wins it and the crate disappears before anyone else checks.
  for (const unit of state.units) {
    if (state.crates.length === 0) return;
    if (unit.hp <= 0) continue; // the dying collect nothing this tick
    if (unitRule(unit.type).air === true) continue; // fliers pass over crates
    const crate = state.crates.find(
      (c) => cellIndex(state, c.cx, c.cy) === unit.cell,
    );
    if (!crate) continue;
    const player = state.players.find((p) => p.id === unit.owner);
    if (!player) continue;
    applyCrate(state, crate, unit.owner);
    state.events.push({
      type: 'CRATE_PICKUP',
      x: cellCenter(crate.cx),
      y: cellCenter(crate.cy),
      kind: crate.kind,
    });
    state.crates = state.crates.filter((c) => c.id !== crate.id);
  }
}

function applyCrate(state: GameState, crate: Crate, ownerId: number): void {
  const player = state.players.find((p) => p.id === ownerId)!;
  switch (crate.kind) {
    case 'MONEY':
      player.credits += CRATE_MONEY;
      return;
    case 'VETERAN': {
      // Field promotion: the collector jumps to the next veterancy rank.
      const collector = state.units.find(
        (u) => u.owner === ownerId && u.cell === cellIndex(state, crate.cx, crate.cy),
      );
      if (!collector) return;
      const rank = veterancyRank(collector.kills);
      if (rank === 0) collector.kills = VETERAN_KILLS;
      else if (rank === 1) collector.kills = ELITE_KILLS;
      return;
    }
    case 'BOMB': {
      // Booby trap: flat blast damage to EVERY unit near the crate — the
      // collector included. deathSystem sweeps the victims this same tick.
      for (const u of state.units) {
        if (unitRule(u.type).air === true) continue;
        const ux = u.cell % state.mapWidth;
        const uy = (u.cell - ux) / state.mapWidth;
        const dx = ux - crate.cx;
        const dy = uy - crate.cy;
        if (dx * dx + dy * dy > CRATE_BOMB_RADIUS * CRATE_BOMB_RADIUS) continue;
        if (u.curtainTicks > 0) continue; // iron curtain shrugs it off
        u.hp -= CRATE_BOMB_DAMAGE;
        state.events.push({ type: 'HIT', x: u.x, y: u.y });
      }
      return;
    }
    case 'HEAL': {
      // The collector plus every own LIVING unit near the crate gets patched
      // up — units that already fell this tick stay fallen (no resurrection;
      // deathSystem sweeps them later in the same tick).
      for (const u of state.units) {
        if (u.owner !== ownerId || u.hp <= 0) continue;
        const ux = u.cell % state.mapWidth;
        const uy = (u.cell - ux) / state.mapWidth;
        const dx = ux - crate.cx;
        const dy = uy - crate.cy;
        if (dx * dx + dy * dy > CRATE_HEAL_RADIUS * CRATE_HEAL_RADIUS) continue;
        u.hp = unitRule(u.type).maxHp;
      }
      return;
    }
    case 'REVEAL': {
      // Permanent map knowledge, not live vision: hidden cells turn explored.
      // fogSystem only ever demotes VISIBLE, so the reveal survives its decay.
      const fog = state.fogs[ownerId]!;
      for (let i = 0; i < fog.length; i++) {
        if (fog[i] === FOG_HIDDEN) fog[i] = FOG_EXPLORED;
      }
      return;
    }
    case 'UNIT': {
      const candidates = CRATE_UNITS.filter((t) =>
        availableToFaction(unitRule(t).factions, player.faction),
      );
      if (candidates.length > 0) {
        const type = candidates[nextInt(state, candidates.length)]!;
        for (let r = 1; r <= 3; r++) {
          for (const cell of cellsAroundRect(crate.cx, crate.cy, 1, 1, r)) {
            if (!inBounds(state, cell.cx, cell.cy)) continue;
            if (!isPassableTerrain(state, cell.cx, cell.cy)) continue;
            const idx = cellIndex(state, cell.cx, cell.cy);
            if (state.structures[idx] !== 0 || state.occupancy[idx] !== 0) continue;
            spawnUnit(state, type, ownerId, cell.cx, cell.cy);
            return;
          }
        }
      }
      // Fully enclosed (or no faction candidate): fall back to money.
      player.credits += CRATE_MONEY;
      return;
    }
  }
}
