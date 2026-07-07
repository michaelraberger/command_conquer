import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  canPlaceBuilding,
  constructBuilding,
  createGame,
  damageTarget,
  hashState,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
  type Target,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Empty battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 13, 13);
  constructBuilding(state, 'CONYARD', 1, 45, 44);
  return state;
}

/** Damage a fresh target once and report the hp lost. */
function oneHit(state: GameState, target: Target, attackerType: 'ROCKETEER' | 'RIFLEMAN' | 'FLAMER'): number {
  const weapon = unitRule(attackerType).weapon!;
  const hpBefore = target.kind === 'unit' ? target.unit.hp : target.building.hp;
  damageTarget(state, target, weapon);
  const hpAfter = target.kind === 'unit' ? target.unit.hp : target.building.hp;
  return hpBefore - hpAfter;
}

describe('new unit weapons', () => {
  it('rocketeer out-damages the rifleman against heavy armor', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 1, 40, 40); // heavy armor
    const rocket = oneHit(state, { kind: 'unit', unit: tank }, 'ROCKETEER');
    tank.hp = unitRule('TANK').maxHp;
    const rifle = oneHit(state, { kind: 'unit', unit: tank }, 'RIFLEMAN');
    expect(rocket).toBeGreaterThan(rifle);
  });

  it('flamer hurts infantry far more than heavy armor', () => {
    const state = arena();
    const grunt = spawnUnit(state, 'RIFLEMAN', 1, 40, 40); // none armor
    const tank = spawnUnit(state, 'TANK', 1, 41, 40); // heavy armor
    const vsInfantry = oneHit(state, { kind: 'unit', unit: grunt }, 'FLAMER');
    const vsHeavy = oneHit(state, { kind: 'unit', unit: tank }, 'FLAMER');
    expect(vsInfantry).toBeGreaterThan(vsHeavy);
  });

  it('attack dog only bites infantry, never vehicles or buildings', () => {
    const state = arena();
    const dog = spawnUnit(state, 'DOG', 0, 20, 20);
    const enemyTank = spawnUnit(state, 'TANK', 1, 22, 20);

    // Ordered onto a tank → refuses, order clears, tank untouched.
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [dog.id], targetId: enemyTank.id }]);
    runTicks(state, 20);
    expect(dog.order).toBeNull();
    expect(enemyTank.hp).toBe(unitRule('TANK').maxHp);

    // Ordered onto adjacent infantry → engages and damages it.
    const enemyGrunt = spawnUnit(state, 'RIFLEMAN', 1, 21, 20);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [dog.id], targetId: enemyGrunt.id }]);
    runTicks(state, 10);
    expect(enemyGrunt.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });

  it('tesla tank zaps a target (hitscan)', () => {
    const state = arena();
    const tesla = spawnUnit(state, 'TESLATANK', 0, 18, 18);
    const victim = spawnUnit(state, 'TANK', 1, 21, 18); // within range 5
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tesla.id], targetId: victim.id }]);
    runTicks(state, 40);
    expect(victim.hp).toBeLessThan(unitRule('TANK').maxHp);
  });

  it('stays deterministic with flame + rocket units fighting', () => {
    const run = (): string => {
      const state = arena(99);
      spawnUnit(state, 'FLAMER', 0, 18, 18);
      spawnUnit(state, 'ROCKETEER', 0, 18, 20);
      spawnUnit(state, 'DOG', 0, 19, 19);
      const ids = state.units.filter((u) => u.owner === 0).map((u) => u.id);
      spawnUnit(state, 'RIFLEMAN', 1, 24, 18);
      spawnUnit(state, 'TANK', 1, 24, 20);
      tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: ids, cx: 24, cy: 19 }]);
      runTicks(state, 200);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});

describe('wall build radius', () => {
  function clearField(state: GameState): void {
    state.units = [];
    state.buildings = [];
    state.terrain.fill(TERRAIN_DIRT);
    state.ore.fill(0);
    state.occupancy.fill(0);
    state.structures.fill(0);
  }

  it('a wall opens no buildable area at all', () => {
    const state = createGame(7);
    clearField(state);
    constructBuilding(state, 'WALL', 0, 20, 20);
    // A wall alone lets nothing be built next to it — not even a touching wall.
    expect(canPlaceBuilding(state, 0, 'POWER', 21, 20)).toBe(false);
    expect(canPlaceBuilding(state, 0, 'WALL', 21, 20)).toBe(false);
  });

  it('normal buildings extend it by 3 cells, and walls fit inside that zone', () => {
    const state = createGame(7);
    clearField(state);
    constructBuilding(state, 'POWER', 0, 20, 20); // 2x2, non-wall
    expect(canPlaceBuilding(state, 0, 'POWER', 24, 20)).toBe(true); // gap 3 → ok
    expect(canPlaceBuilding(state, 0, 'POWER', 26, 20)).toBe(false); // gap 5 → too far
    // A wall is placeable within the real building's radius…
    expect(canPlaceBuilding(state, 0, 'WALL', 24, 21)).toBe(true);
    // …but not beyond it (the wall itself extends nothing).
    expect(canPlaceBuilding(state, 0, 'WALL', 26, 21)).toBe(false);
  });
});
