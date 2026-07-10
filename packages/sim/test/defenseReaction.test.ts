import { describe, expect, it } from 'vitest';
import { createGame, hashState, spawnUnit, tick } from '../src/index.js';

/**
 * Base-under-attack response: a V3 shells the player's CONYARD from beyond
 * the 8-cell guard radius. Idle defenders near the base must rally toward
 * the attacker instead of standing around (the bug this system fixes).
 */
function siegeScenario() {
  const state = createGame(11);
  const conyard = state.buildings.find((b) => b.owner === 0 && b.type === 'CONYARD')!;
  // Attacker: V3 (range 9.5) parked 10 cells from the conyard's edge — far
  // outside every defender's guard radius.
  const v3 = spawnUnit(state, 'V3', 1, 23, 13);
  v3.order = { kind: 'ATTACK', targetId: conyard.id };
  // Defender: idle tank on the far side of the base (14 cells from the V3,
  // 4 from the conyard). Without the reaction it would never move.
  const tank = spawnUnit(state, 'TANK', 0, 9, 13);
  return { state, v3, tank };
}

describe('defense reaction (Basis unter Beschuss)', () => {
  it('idle defenders rally toward a long-range attacker and hunt it down', () => {
    const { state, v3, tank } = siegeScenario();
    expect(tank.order).toBeNull();

    let reacted = false;
    for (let t = 0; t < 400 && !reacted; t++) {
      tick(state, []);
      reacted = tank.order?.kind === 'ATTACK_MOVE' || tank.path !== null;
    }
    expect(reacted).toBe(true);

    // Given time, the rallied defenders reach and destroy the V3.
    for (let t = 0; t < 500 && state.units.includes(v3); t++) tick(state, []);
    expect(state.units.includes(v3)).toBe(false);
  });

  it('unarmed, unable and far-away units do not react', () => {
    const { state } = siegeScenario();
    const mcv = spawnUnit(state, 'MCV', 0, 9, 15); // unarmed, right at the base
    const dog = spawnUnit(state, 'DOG', 0, 9, 11); // anti-infantry: no answer to a V3
    const farTank = spawnUnit(state, 'TANK', 0, 40, 30); // 25+ cells away
    for (let t = 0; t < 120; t++) tick(state, []);
    expect(mcv.order).toBeNull();
    expect(dog.order).toBeNull();
    expect(farTank.order).toBeNull();
    expect(farTank.cell).toBe(30 * 64 + 40);
  });

  it('stays deterministic and serialize-stable', () => {
    const run = () => {
      const { state } = siegeScenario();
      for (let t = 0; t < 200; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
