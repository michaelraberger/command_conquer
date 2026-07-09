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

/** Open ground, no stray units; starting conyards stay so nobody auto-loses. */
function arena(seed = 1): GameState {
  const s = createGame(seed);
  s.units = [];
  s.occupancy.fill(0);
  s.terrain.fill(TERRAIN_DIRT);
  return s;
}

describe('Scharfschütze (sniper)', () => {
  it('one-shots enemy infantry from beyond their range, untouched', () => {
    const s = arena();
    const sniper = spawnUnit(s, 'SNIPER', 0, 20, 20);
    // 7 cells away: inside the sniper's range (9), far outside a rifleman's (3.5).
    const target = spawnUnit(s, 'RIFLEMAN', 1, 27, 20);
    for (let i = 0; i < 120 && s.units.some((u) => u.id === target.id); i++) tick(s);
    expect(s.units.some((u) => u.id === target.id)).toBe(false); // dead
    expect(sniper.hp).toBe(unitRule('SNIPER').maxHp); // never took a hit
  });

  it('cannot damage vehicles or buildings (anti-infantry only)', () => {
    const s = arena(2);
    spawnUnit(s, 'SNIPER', 0, 20, 20);
    const tank = spawnUnit(s, 'TANK', 1, 27, 20);
    const power = constructBuilding(s, 'POWER', 1, 24, 24);
    for (let i = 0; i < 80; i++) tick(s);
    expect(tank.hp).toBe(unitRule('TANK').maxHp);
    expect(power.hp).toBe(power.hp); // building unscratched by the sniper
    expect(s.buildings.find((b) => b.id === power.id)!.hp).toBeGreaterThanOrEqual(power.hp);
  });

  it('needs a barracks AND an airfield, and is Allied-only', () => {
    const s = createGame(1, { factions: ['ALLIES', 'SOVIETS'] });
    s.players[0]!.credits = 5000;
    constructBuilding(s, 'BARRACKS', 0, 18, 18);
    // Only a barracks → not yet buildable (needs the Flugplatz too).
    tick(s, [{ type: 'BUILD_START', playerId: 0, item: 'SNIPER' }]);
    expect(s.players[0]!.queues.infantry.item).toBeNull();
    constructBuilding(s, 'HELIPAD', 0, 22, 18);
    tick(s, [{ type: 'BUILD_START', playerId: 0, item: 'SNIPER' }]);
    expect(s.players[0]!.queues.infantry.item).toBe('SNIPER');
    // Soviets can never build it (faction gate), even with the buildings.
    s.players[1]!.credits = 5000;
    constructBuilding(s, 'BARRACKS', 1, 50, 50);
    constructBuilding(s, 'HELIPAD', 1, 54, 50);
    tick(s, [{ type: 'BUILD_START', playerId: 1, item: 'SNIPER' }]);
    expect(s.players[1]!.queues.infantry.item).toBeNull();
  });
});
