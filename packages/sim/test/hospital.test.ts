import { describe, expect, it } from 'vitest';
import {
  HOSPITAL_HP_PER_TICK,
  NEUTRAL_OWNER,
  TERRAIN_DIRT,
  buildingRule,
  constructBuilding,
  createGame,
  emptyCustomMap,
  spawnUnit,
  tick,
  unitRule,
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

describe('Lazarett', () => {
  it('is a neutral, capturable tech building', () => {
    const rule = buildingRule('HOSPITAL');
    expect(rule.buildable).toBe(false);
    expect(rule.heal).toBe(HOSPITAL_HP_PER_TICK);
    expect(rule.civilian).not.toBe(true);
  });

  it('an engineer captures it without a bonus payout', () => {
    const state = arena();
    const hospital = constructBuilding(state, 'HOSPITAL', NEUTRAL_OWNER, 20, 20);
    const engineer = spawnUnit(state, 'ENGINEER', 0, 19, 20);
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [engineer.id], targetId: hospital.id }]);
    runTicks(state, 40);
    expect(hospital.owner).toBe(0);
    expect(state.units.some((u) => u.id === engineer.id)).toBe(false); // consumed
    expect(state.players[0]!.credits).toBe(credits); // no captureBonus
  });

  it('regenerates only the owner infantry, never vehicles or enemies', () => {
    const state = arena();
    constructBuilding(state, 'HOSPITAL', 0, 20, 20);
    const own = spawnUnit(state, 'RIFLEMAN', 0, 30, 30);
    const tank = spawnUnit(state, 'TANK', 0, 32, 30);
    const enemy = spawnUnit(state, 'RIFLEMAN', 1, 40, 40);
    own.hp = 20;
    tank.hp = 20;
    enemy.hp = 20;
    runTicks(state, 10);
    expect(own.hp).toBe(20 + 10 * HOSPITAL_HP_PER_TICK);
    expect(tank.hp).toBe(20);
    expect(enemy.hp).toBe(20);
    // Caps at max.
    own.hp = unitRule('RIFLEMAN').maxHp - 1;
    runTicks(state, 5);
    expect(own.hp).toBe(unitRule('RIFLEMAN').maxHp);
  });

  it('two hospitals heal no faster than one', () => {
    const rate = (hospitals: number): number => {
      const state = arena();
      for (let i = 0; i < hospitals; i++) constructBuilding(state, 'HOSPITAL', 0, 20 + i * 4, 20);
      const inf = spawnUnit(state, 'RIFLEMAN', 0, 30, 30);
      inf.hp = 10;
      runTicks(state, 10);
      return inf.hp;
    };
    expect(rate(2)).toBe(rate(1));
  });
});

describe('zivile Häuser', () => {
  it('reject capture orders (the engineer drops the stale order)', () => {
    const state = arena();
    const haus = constructBuilding(state, 'HAUS1', NEUTRAL_OWNER, 20, 20);
    const engineer = spawnUnit(state, 'ENGINEER', 0, 19, 20);
    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [engineer.id], targetId: haus.id }]);
    runTicks(state, 30);
    expect(haus.owner).toBe(NEUTRAL_OWNER);
    expect(state.units.some((u) => u.id === engineer.id)).toBe(true); // never consumed
    expect(engineer.order).toBeNull();
  });

  it('are destroyable scenery', () => {
    expect(buildingRule('HAUS1').civilian).toBe(true);
    expect(buildingRule('HAUS2').civilian).toBe(true);
    expect(buildingRule('HAUS1').buildable).toBe(false);
  });
});

describe('KI erobert das Lazarett', () => {
  it('trains an engineer and takes the neutral hospital', () => {
    const map = emptyCustomMap(48, 48, 'KI-Lazarett');
    const state = createGame(7, { ai: true, aiDifficulty: 'normal', customMap: map });
    const hospital = constructBuilding(state, 'HOSPITAL', NEUTRAL_OWNER, 30, 32);
    const ai = state.players[1]!;
    ai.credits = 4000;
    constructBuilding(state, 'BARRACKS', 1, 34, 36);
    constructBuilding(state, 'POWER', 1, 34, 40);

    let captured = false;
    for (let t = 0; t < 3000 && !captured; t++) {
      tick(state);
      captured = hospital.owner === 1;
    }
    expect(captured).toBe(true);
  }, 30000);
});
