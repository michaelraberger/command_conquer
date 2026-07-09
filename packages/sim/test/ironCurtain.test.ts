import { describe, expect, it } from 'vitest';
import {
  IRON_CURTAIN_TICKS,
  SUPERWEAPON_CHARGE_TICKS,
  buildingRule,
  constructBuilding,
  createGame,
  damageTarget,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

/** Bare Soviet-vs-Allies battlefield with both HQs standing. */
function arena(seed = 7): GameState {
  const state = createGame(seed, { factions: ['SOVIETS', 'ALLIES'] });
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** A charged iron curtain device (plus power so it keeps charging). */
function chargedCurtain(state: GameState): void {
  constructBuilding(state, 'POWER', 0, 9, 5);
  const device = constructBuilding(state, 'IRONCURTAIN', 0, 5, 10);
  device.charge = SUPERWEAPON_CHARGE_TICKS;
}

describe('iron curtain device', () => {
  it('is a unique Soviet superweapon gated behind Techzentrum + super tech', () => {
    const rule = buildingRule('IRONCURTAIN');
    expect(rule.factions).toEqual(['SOVIETS']);
    expect(rule.cost).toBe(3500);
    expect(rule.power).toBe(-200);
    expect(rule.requires).toContain('TECHCENTER');
    expect(rule.tech).toBe('super');
    expect(rule.superweapon).toBe('CURTAIN');
    expect(rule.unique).toBe(true);
  });

  it('only one device can be queued per player', () => {
    const state = arena();
    const p = state.players[0]!;
    p.motherload = true; // bypass prereq/tech gates, NOT the unique gate
    constructBuilding(state, 'IRONCURTAIN', 0, 5, 10);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'IRONCURTAIN' }]);
    expect(p.queues.building.item).toBeNull(); // second device refused
  });

  it('makes vehicles and buildings invulnerable, but not infantry', () => {
    const state = arena();
    chargedCurtain(state);
    const tank = spawnUnit(state, 'TANK', 0, 30, 30);
    const grunt = spawnUnit(state, 'RIFLEMAN', 0, 31, 30);
    const depot = constructBuilding(state, 'SILO', 0, 29, 29);
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 30, cy: 30, kind: 'CURTAIN' }]);
    tick(state); // instant strike resolves next tick

    expect(tank.curtainTicks).toBeGreaterThan(0);
    expect(depot.curtainTicks).toBeGreaterThan(0);
    expect(grunt.curtainTicks).toBe(0); // classic rule: infantry unprotected

    const weapon = unitRule('TANK').weapon!;
    damageTarget(state, { kind: 'unit', unit: tank }, weapon);
    damageTarget(state, { kind: 'building', building: depot }, weapon);
    damageTarget(state, { kind: 'unit', unit: grunt }, weapon);
    expect(tank.hp).toBe(unitRule('TANK').maxHp); // shrugged off
    expect(depot.hp).toBe(buildingRule('SILO').maxHp);
    expect(grunt.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });

  it('protection wears off after IRON_CURTAIN_TICKS', () => {
    const state = arena();
    chargedCurtain(state);
    const tank = spawnUnit(state, 'TANK', 0, 30, 30);
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 30, cy: 30, kind: 'CURTAIN' }]);
    for (let i = 0; i <= IRON_CURTAIN_TICKS + 1; i++) tick(state);
    expect(tank.curtainTicks).toBe(0);
    damageTarget(state, { kind: 'unit', unit: tank }, unitRule('TANK').weapon!);
    expect(tank.hp).toBeLessThan(unitRule('TANK').maxHp); // vulnerable again
  });

  it('a curtained building survives even a nuke', () => {
    const state = arena();
    chargedCurtain(state);
    const nukesilo = constructBuilding(state, 'NUKESILO', 0, 12, 10);
    nukesilo.charge = SUPERWEAPON_CHARGE_TICKS;
    const depot = constructBuilding(state, 'SILO', 1, 30, 30);
    // Protect the ENEMY depot (area effect ignores ownership), then nuke it.
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 30, cy: 30, kind: 'CURTAIN' }]);
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 30, cy: 30, kind: 'NUKE' }]);
    for (let i = 0; i < 80; i++) tick(state); // nuke travel + impact
    expect(depot.hp).toBe(buildingRule('SILO').maxHp);
  });

  it('the kind field fires the right silo when a player owns both superweapons', () => {
    const state = arena();
    chargedCurtain(state);
    const nukesilo = constructBuilding(state, 'NUKESILO', 0, 12, 10);
    nukesilo.charge = SUPERWEAPON_CHARGE_TICKS;
    const curtain = state.buildings.find((b) => b.type === 'IRONCURTAIN')!;
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 30, cy: 30, kind: 'NUKE' }]);
    expect(nukesilo.charge).toBe(0); // the nuke silo fired …
    expect(curtain.charge).toBe(SUPERWEAPON_CHARGE_TICKS); // … the curtain kept its charge
  });
});
