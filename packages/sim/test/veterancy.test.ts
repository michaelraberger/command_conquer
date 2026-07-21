import { describe, expect, it } from 'vitest';
import {
  ELITE_KILLS,
  TERRAIN_DIRT,
  VETERAN_KILLS,
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  spawnUnit,
  tick,
  unitRule,
  veterancyRank,
  type GameState,
} from '../src/index.js';

/** Empty dirt battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

describe('Veteranenstatus', () => {
  it('rank thresholds: recruit → veteran (3 kills) → elite (6 kills)', () => {
    expect(veterancyRank(0)).toBe(0);
    expect(veterancyRank(VETERAN_KILLS - 1)).toBe(0);
    expect(veterancyRank(VETERAN_KILLS)).toBe(1);
    expect(veterancyRank(ELITE_KILLS - 1)).toBe(1);
    expect(veterancyRank(ELITE_KILLS)).toBe(2);
  });

  it('a direct-fire kill credits the shooter', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 20, 18);
    victim.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: victim.id }]);
    runTicks(state, 10);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
    expect(tank.kills).toBe(1);
  });

  it('a projectile kill credits the shooter on impact', () => {
    const state = arena();
    const arty = spawnUnit(state, 'ARTILLERY', 0, 18, 18);
    expect(unitRule('ARTILLERY').weapon!.projectileSpeed).toBeGreaterThan(0);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 22, 18);
    victim.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [arty.id], targetId: victim.id }]);
    runTicks(state, 40);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
    expect(arty.kills).toBe(1);
  });

  it('veterans deal 25 % more damage, elites 50 %', () => {
    // Instant-hit weapon (no projectile flight), so the very first tick lands
    // exactly one shot and the hp delta IS the per-shot damage.
    expect(unitRule('RIFLEMAN').weapon!.projectileSpeed).toBe(0);
    const damageDealt = (kills: number): number => {
      const state = arena();
      const shooter = spawnUnit(state, 'RIFLEMAN', 0, 18, 18);
      shooter.kills = kills;
      const target = spawnUnit(state, 'RIFLEMAN', 1, 20, 18);
      const before = target.hp;
      tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [shooter.id], targetId: target.id }]);
      return before - target.hp; // exactly the first shot
    };
    const base = damageDealt(0);
    expect(base).toBeGreaterThan(0);
    expect(damageDealt(VETERAN_KILLS)).toBe(Math.trunc((base * 125) / 100));
    expect(damageDealt(ELITE_KILLS)).toBe(Math.trunc((base * 150) / 100));
  });

  it('no credit for neutral scenery (force-firing a bridge)', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const haus = constructBuilding(state, 'HAUS1', -1, 20, 18);
    haus.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: haus.id }]);
    runTicks(state, 10);
    expect(state.buildings.some((b) => b.id === haus.id)).toBe(false);
    expect(tank.kills).toBe(0);
  });

  it('elite units slowly self-heal in the field', () => {
    const state = arena();
    const elite = spawnUnit(state, 'TANK', 0, 18, 18);
    elite.kills = ELITE_KILLS;
    elite.hp = 50;
    const veteran = spawnUnit(state, 'TANK', 0, 22, 18);
    veteran.kills = VETERAN_KILLS;
    veteran.hp = 50;
    runTicks(state, 40);
    expect(elite.hp).toBeGreaterThan(50);
    expect(veteran.hp).toBe(50); // rank 1 does not self-heal
    // Caps at max.
    elite.hp = unitRule('TANK').maxHp - 1;
    runTicks(state, 20);
    expect(elite.hp).toBe(unitRule('TANK').maxHp);
  });

  it('kills survive a serialize round trip', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    tank.kills = 4;
    const copy = deserialize(serialize(state));
    expect(copy.units.find((u) => u.id === tank.id)!.kills).toBe(4);
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('old saves without the kills field load as recruits', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 0, 18, 18);
    const raw = JSON.parse(serialize(state)) as { units: Array<Record<string, unknown>> };
    for (const u of raw.units) delete u.kills;
    const copy = deserialize(JSON.stringify(raw));
    expect(copy.units.every((u) => u.kills === 0)).toBe(true);
    tick(copy);
  });
});
