import { describe, expect, it } from 'vitest';
import {
  buildingRule,
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  type GameState,
} from '../src/index.js';

/** Bare battlefield: a CONYARD per side so nobody is auto-eliminated. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** Damage a fresh enemy tank takes from the player-0 defenses in one tick. */
function beamDamage(state: GameState, tankCx: number, tankCy: number): number {
  const tank = spawnUnit(state, 'TANK', 1, tankCx, tankCy);
  const before = tank.hp;
  tick(state);
  return before - tank.hp;
}

describe('prism tower', () => {
  it('is an Allied, prereq-gated, power-hungry base defense', () => {
    const rule = buildingRule('PRISM');
    expect(rule.factions).toEqual(['ALLIES']);
    expect(rule.requires).toContain('HELIPAD');
    expect(rule.power).toBeLessThan(0);
    expect(rule.weapon?.fx).toBe('PRISM');
  });

  it('fires a light beam at ground units when powered', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 0, 8, 5); // covers the tower's draw
    constructBuilding(state, 'PRISM', 0, 13, 13);
    expect(beamDamage(state, 13, 19)).toBeGreaterThan(0);
  });

  it('goes offline while the base is low on power', () => {
    const state = arena();
    constructBuilding(state, 'PRISM', 0, 13, 13); // no power plant → deficit
    expect(beamDamage(state, 13, 19)).toBe(0);
  });

  it('linked prism towers combine into a stronger beam', () => {
    // Solo tower.
    const solo = arena();
    constructBuilding(solo, 'POWER', 0, 8, 5);
    constructBuilding(solo, 'PRISM', 0, 13, 13);
    const soloDmg = beamDamage(solo, 13, 19);

    // Same shot, but a friendly tower sits in link range (4 cells) yet out of
    // weapon range of the target (11 cells), so it only boosts, never fires.
    const linked = arena();
    constructBuilding(linked, 'POWER', 0, 8, 5);
    constructBuilding(linked, 'POWER', 0, 8, 8);
    constructBuilding(linked, 'PRISM', 0, 13, 13);
    constructBuilding(linked, 'PRISM', 0, 13, 9);
    const linkedDmg = beamDamage(linked, 13, 19);

    expect(linkedDmg).toBeGreaterThan(soloDmg);
  });
});
