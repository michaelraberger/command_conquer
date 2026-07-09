import { describe, expect, it } from 'vitest';
import {
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Bare battlefield with both HQs so nobody auto-loses. */
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

describe('auto-target priority (threats before bystanders)', () => {
  it('attack-move shoots the armed enemy, not the closer harvester', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    const harvester = spawnUnit(state, 'HARVESTER', 1, 22, 20); // closer
    const rifleman = spawnUnit(state, 'RIFLEMAN', 1, 23, 20); // farther but armed
    tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [tank.id], cx: 26, cy: 20 }]);
    runTicks(state, 3);
    expect(rifleman.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
    expect(harvester.hp).toBe(unitRule('HARVESTER').maxHp);
  });

  it('attack-move shoots the defense tower, not the closer passive building', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    const silo = constructBuilding(state, 'SILO', 1, 22, 20); // closer, passive
    const pillbox = constructBuilding(state, 'PILLBOX', 1, 24, 20); // farther, armed
    const siloHp = silo.hp;
    const pillboxHp = pillbox.hp;
    tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [tank.id], cx: 26, cy: 20 }]);
    runTicks(state, 12); // shell needs a few ticks of flight time
    expect(pillbox.hp).toBeLessThan(pillboxHp); // the tower soaks the fire
    expect(silo.hp).toBe(siloHp); // untouched while the tower stands
  });

  it('idle guards engage the armed enemy over the closer harvester', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 0, 20, 20); // idle, guard stance
    const harvester = spawnUnit(state, 'HARVESTER', 1, 22, 20);
    const rifleman = spawnUnit(state, 'RIFLEMAN', 1, 23, 20);
    runTicks(state, 4);
    expect(rifleman.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
    expect(harvester.hp).toBe(unitRule('HARVESTER').maxHp);
  });

  it('defense towers zap the armed attacker, not the closer harvester', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 0, 8, 5); // keep the tower online
    constructBuilding(state, 'TESLA', 0, 20, 20);
    const harvester = spawnUnit(state, 'HARVESTER', 1, 22, 20); // closer
    const rifleman = spawnUnit(state, 'RIFLEMAN', 1, 24, 20); // farther, armed
    runTicks(state, 3);
    expect(rifleman.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
    expect(harvester.hp).toBe(unitRule('HARVESTER').maxHp);
  });

  it('unarmed bystanders are still shot once no threat remains', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    const harvester = spawnUnit(state, 'HARVESTER', 1, 22, 20);
    tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [tank.id], cx: 22, cy: 20 }]);
    runTicks(state, 4);
    expect(harvester.hp).toBeLessThan(unitRule('HARVESTER').maxHp); // fallback target
  });
});
