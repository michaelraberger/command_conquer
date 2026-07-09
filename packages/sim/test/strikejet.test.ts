import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function arena(seed = 1): GameState {
  const s = createGame(seed);
  s.units = [];
  s.occupancy.fill(0);
  s.terrain.fill(TERRAIN_DIRT);
  return s;
}

describe('Sturmjet (Allied strike jet)', () => {
  it('strafes enemy structures (ground attack)', () => {
    const s = arena();
    const jet = spawnUnit(s, 'STRIKEJET', 0, 20, 20);
    const power = constructBuilding(s, 'POWER', 1, 24, 20);
    const hp0 = power.hp;
    tick(s, [{ type: 'ATTACK', playerId: 0, unitIds: [jet.id], targetId: power.id }]);
    for (let i = 0; i < 60; i++) tick(s);
    expect(power.hp).toBeLessThan(hp0);
  });

  it('is immune to ground weapons but vulnerable to anti-air', () => {
    // A tank's cannon (ground) can't touch the jet.
    const s1 = arena(3);
    const jet1 = spawnUnit(s1, 'STRIKEJET', 0, 20, 20);
    const tank = spawnUnit(s1, 'TANK', 1, 22, 20);
    tick(s1, [{ type: 'ATTACK', playerId: 1, unitIds: [tank.id], targetId: jet1.id }]);
    for (let i = 0; i < 80; i++) tick(s1);
    expect(jet1.hp).toBe(unitRule('STRIKEJET').maxHp);

    // Flak (anti-air) shreds it.
    const s2 = arena(4);
    const jet2 = spawnUnit(s2, 'STRIKEJET', 0, 20, 20);
    const flak = spawnUnit(s2, 'FLAK', 1, 20, 23);
    tick(s2, [{ type: 'ATTACK', playerId: 1, unitIds: [flak.id], targetId: jet2.id }]);
    for (let i = 0; i < 80; i++) tick(s2);
    expect(jet2.hp).toBeLessThan(unitRule('STRIKEJET').maxHp);
  });

  it('needs a Flugplatz and is Allied-only', () => {
    const s = createGame(1, { factions: ['ALLIES', 'SOVIETS'] });
    s.players[0]!.credits = 5000;
    // No helipad yet → not buildable.
    tick(s, [{ type: 'BUILD_START', playerId: 0, item: 'STRIKEJET' }]);
    expect(s.players[0]!.queues.air.item).toBeNull();
    constructBuilding(s, 'HELIPAD', 0, 18, 18);
    tick(s, [{ type: 'BUILD_START', playerId: 0, item: 'STRIKEJET' }]);
    expect(s.players[0]!.queues.air.item).toBe('STRIKEJET');
    // Soviets can't build it even with a helipad (faction gate).
    s.players[1]!.credits = 5000;
    constructBuilding(s, 'HELIPAD', 1, 50, 50);
    tick(s, [{ type: 'BUILD_START', playerId: 1, item: 'STRIKEJET' }]);
    expect(s.players[1]!.queues.air.item).toBeNull();
  });
});
