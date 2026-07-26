import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  constructBuilding,
  createGame,
  spawnUnit,
  unitRule,
  type GameState,
} from '../src/index.js';
import { computeInfluence, resetInfluenceCache } from '../src/ai/influence.js';

/** Empty battlefield with both HQs so nobody auto-loses (air.test.ts pattern). */
function arena(seed = 7, size?: number): GameState {
  const state = createGame(seed, size ? { mapWidth: size, mapHeight: size } : undefined);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** Influence radius of a unit type, mirroring the RANGE_PAD in influence.ts. */
function influenceRadius(type: 'TANK' | 'FLAK'): number {
  return (unitRule(type).weapon!.range >> 8) + 4;
}

describe('influence maps', () => {
  it('is deterministic: two computes of the same state match cell by cell', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 1, 20, 20);
    spawnUnit(state, 'RIFLEMAN', 1, 30, 30);
    spawnUnit(state, 'TANK', 0, 10, 40);
    constructBuilding(state, 'REFINERY', 1, 40, 12);

    resetInfluenceCache();
    const a = computeInfluence(state, 0);
    const snapshot: number[] = [];
    for (let cy = 0; cy < state.mapHeight; cy++) {
      for (let cx = 0; cx < state.mapWidth; cx++) {
        snapshot.push(a.threatGroundAt(cx, cy), a.ownStrengthAt(cx, cy), a.econAt(cx, cy));
      }
    }
    resetInfluenceCache();
    const b = computeInfluence(state, 0);
    let i = 0;
    for (let cy = 0; cy < state.mapHeight; cy++) {
      for (let cx = 0; cx < state.mapWidth; cx++) {
        expect(b.threatGroundAt(cx, cy)).toBe(snapshot[i++]);
        expect(b.ownStrengthAt(cx, cy)).toBe(snapshot[i++]);
        expect(b.econAt(cx, cy)).toBe(snapshot[i++]);
      }
    }
  });

  it('never bleeds stale data after the scratch grew for a larger map', () => {
    // Fill the scratch on a big map first …
    const big = arena(7, 192);
    for (let n = 0; n < 20; n++) spawnUnit(big, 'TANK', 1, 10 + n * 8, 10 + n * 8);
    resetInfluenceCache();
    const bigView = computeInfluence(big, 0);
    expect(bigView.threatGroundAt(10, 10)).toBeGreaterThan(0);

    // … then an empty small map must read zero everywhere (stamp bug guard).
    const small = arena(8, 48);
    small.buildings = [];
    resetInfluenceCache();
    const view = computeInfluence(small, 0);
    for (let cy = 0; cy < 48; cy++) {
      for (let cx = 0; cx < 48; cx++) {
        expect(view.threatGroundAt(cx, cy)).toBe(0);
        expect(view.econAt(cx, cy)).toBe(0);
      }
    }
  });

  it('threat peaks at the enemy unit and falls off monotonically to zero', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 1, 20, 20);
    resetInfluenceCache();
    const view = computeInfluence(state, 0);
    const r = influenceRadius('TANK');
    let prev = view.threatGroundAt(20, 20);
    expect(prev).toBeGreaterThan(0);
    for (let d = 1; d < r; d++) {
      const t = view.threatGroundAt(20 + d, 20);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
    expect(view.threatGroundAt(20 + r, 20)).toBe(0);
  });

  it('splits threat by weapon layer: FLAK threatens air, not ground', () => {
    const state = arena();
    spawnUnit(state, 'FLAK', 1, 20, 20);
    resetInfluenceCache();
    const view = computeInfluence(state, 0);
    expect(view.threatAirAt(20, 20)).toBeGreaterThan(0);
    expect(view.threatGroundAt(20, 20)).toBe(0);
  });

  it('respects alliances: allied units count as own strength, not threat', () => {
    const state = arena();
    state.players[0]!.team = 1;
    state.players[1]!.team = 1;
    spawnUnit(state, 'TANK', 1, 20, 20);
    resetInfluenceCache();
    const view = computeInfluence(state, 0);
    expect(view.threatGroundAt(20, 20)).toBe(0);
    expect(view.ownStrengthAt(20, 20)).toBeGreaterThan(0);
    expect(view.netAt(20, 20)).toBeGreaterThan(0);
  });

  it('marks enemy economy but not own buildings in the econ layer', () => {
    const state = arena();
    constructBuilding(state, 'REFINERY', 1, 40, 12);
    constructBuilding(state, 'REFINERY', 0, 10, 12);
    resetInfluenceCache();
    const view = computeInfluence(state, 0);
    expect(view.econAt(41, 13)).toBeGreaterThan(0);
    expect(view.econAt(11, 13)).toBe(0);
  });

  it('lowestThreatRingCell picks the ring cell facing away from the enemy', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 1, 30, 20);
    resetInfluenceCache();
    const view = computeInfluence(state, 0);
    const best = view.lowestThreatRingCell(20, 20, 5);
    expect(best).not.toBeNull();
    // The safest ring cell must not be more threatened than the cell pointing
    // straight at the tank.
    expect(view.threatGroundAt(best!.cx, best!.cy)).toBeLessThanOrEqual(
      view.threatGroundAt(25, 20),
    );
    expect(best!.cx).toBeLessThan(25);
  });

  it('memoizes per (state, tick, enemy mask) and shares across allied AIs', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 1, 20, 20);
    resetInfluenceCache();
    const a = computeInfluence(state, 0);
    expect(computeInfluence(state, 0)).toBe(a);
    resetInfluenceCache();
    expect(computeInfluence(state, 0)).not.toBe(a);
  });
});
