import { describe, expect, it } from 'vitest';
import {
  UNIT_RULES,
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

describe('radar tower', () => {
  it('is a faction-free power drain with the widest sight in the game', () => {
    // Both factions build it now — the radar tower gates the minimap.
    const rule = buildingRule('RADAR');
    expect(rule.factions).toBeNull();
    expect(rule.cost).toBe(1000);
    expect(rule.power).toBe(-50);
    const maxUnitSight = Math.max(...Object.values(UNIT_RULES).map((r) => r.sight));
    expect(rule.sight).toBeGreaterThan(maxUnitSight); // the radar sweep
  });
});

describe('V3 rocket launcher', () => {
  it('is Soviet artillery gated behind the Radarturm', () => {
    const state = arena();
    constructBuilding(state, 'FACTORY', 0, 9, 5);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'V3' }]);
    expect(state.players[0]!.queues.vehicle.item).toBeNull(); // no radar yet

    constructBuilding(state, 'RADAR', 0, 9, 9);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'V3' }]);
    expect(state.players[0]!.queues.vehicle.item).toBe('V3');
  });

  it('out-ranges every other ground vehicle', () => {
    const v3Range = unitRule('V3').weapon!.range;
    for (const [type, rule] of Object.entries(UNIT_RULES)) {
      if (type === 'V3' || rule.weapon === null) continue;
      if (rule.category !== 'vehicle' && rule.category !== 'infantry') continue;
      expect(v3Range).toBeGreaterThan(rule.weapon.range);
    }
  });

  it('devastates buildings far harder than Allied artillery', () => {
    const state = arena();
    const target = constructBuilding(state, 'FACTORY', 1, 40, 40);
    const before = target.hp;
    damageTarget(state, { kind: 'building', building: target }, unitRule('V3').weapon!);
    const v3Hit = before - target.hp;
    target.hp = before;
    damageTarget(state, { kind: 'building', building: target }, unitRule('ARTILLERY').weapon!);
    const artyHit = before - target.hp;
    expect(v3Hit).toBeGreaterThan(artyHit * 1.5);
  });

  it('fires a slow visible rocket that levels a building', () => {
    const state = arena();
    const v3 = spawnUnit(state, 'V3', 0, 30, 30);
    const target = constructBuilding(state, 'PILLBOX', 1, 36, 30); // in range (8.5)
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [v3.id], targetId: target.id }]);
    let fired = false;
    for (let i = 0; i < 400 && target.hp > 0; i++) {
      tick(state);
      if (state.projectiles.length > 0) fired = true;
    }
    expect(fired).toBe(true); // travels as a projectile, not hitscan
    expect(target.hp).toBeLessThanOrEqual(0);
  });
});
