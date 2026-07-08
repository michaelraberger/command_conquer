import { describe, expect, it } from 'vitest';
import {
  VEHICLE_REPAIR_COST_PER_TICK,
  buildingRule,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Battlefield with both players anchored so nobody auto-loses. */
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

describe('repair vehicle', () => {
  it('drives to a damaged own building and heals it for credits', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = 100;
    const repair = spawnUnit(state, 'REPAIR', 0, 14, 16);
    const credits = state.players[0]!.credits;

    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: power.id }]);
    for (let i = 0; i < 400 && power.hp < buildingRule('POWER').maxHp; i++) tick(state);

    expect(power.hp).toBe(buildingRule('POWER').maxHp); // fully repaired
    expect(state.players[0]!.credits).toBeLessThan(credits); // paid for it
    tick(state); // the tick that notices "done" clears the order
    expect(repair.order).toBeNull();
  });

  it('emits repair sparkle events while working', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 16, 16);
    power.hp = 200;
    const repair = spawnUnit(state, 'REPAIR', 0, 14, 16); // adjacent already

    let sawSparkle = false;
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: power.id }]);
    for (let i = 0; i < 60 && !sawSparkle; i++) {
      tick(state);
      if (state.events.some((e) => e.type === 'REPAIR')) sawSparkle = true;
    }
    expect(sawSparkle).toBe(true);
  });

  it('drives to a damaged own vehicle and heals it for credits', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    tank.hp = 100;
    const repair = spawnUnit(state, 'REPAIR', 0, 14, 16);
    const credits = state.players[0]!.credits;

    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: tank.id }]);
    for (let i = 0; i < 400 && tank.hp < unitRule('TANK').maxHp; i++) tick(state);

    expect(tank.hp).toBe(unitRule('TANK').maxHp); // fully repaired
    expect(state.players[0]!.credits).toBeLessThan(credits); // paid for it
    tick(state);
    expect(repair.order).toBeNull();
  });

  it('also heals own infantry, but never itself or enemy units', () => {
    const state = arena();
    const rifle = spawnUnit(state, 'RIFLEMAN', 0, 16, 16);
    rifle.hp = 30;
    const repair = spawnUnit(state, 'REPAIR', 0, 14, 16); // one cell away
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: rifle.id }]);
    for (let i = 0; i < 80 && rifle.hp < unitRule('RIFLEMAN').maxHp; i++) tick(state);
    expect(rifle.hp).toBe(unitRule('RIFLEMAN').maxHp);

    // Cannot target itself.
    repair.hp = 50;
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: repair.id }]);
    expect(repair.order).toBeNull();

    // Cannot repair an enemy unit (spawned far from the repair vehicle).
    const enemy = spawnUnit(state, 'TANK', 1, 40, 40);
    enemy.hp = 100;
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: enemy.id }]);
    expect(repair.order).toBeNull();
    runTicks(state, 20);
    expect(enemy.hp).toBe(100);
  });

  it('only repair vehicles accept the order; tanks ignore it', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = 100;
    const tank = spawnUnit(state, 'TANK', 0, 14, 16);

    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [tank.id], targetId: power.id }]);
    expect(tank.order).toBeNull();
  });

  it('cannot repair enemy buildings, stops when out of credits', () => {
    const state = arena();
    const enemyPower = constructBuilding(state, 'POWER', 1, 20, 20);
    enemyPower.hp = 100;
    const repair = spawnUnit(state, 'REPAIR', 0, 14, 16);
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: enemyPower.id }]);
    expect(repair.order).toBeNull();

    // Out of credits: an own damaged building doesn't heal.
    const own = constructBuilding(state, 'POWER', 0, 24, 24);
    own.hp = 100;
    state.players[0]!.credits = VEHICLE_REPAIR_COST_PER_TICK - 1;
    tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: own.id }]);
    runTicks(state, 60);
    expect(own.hp).toBe(100);
  });

  it('stays deterministic', () => {
    const run = (): string => {
      const state = arena(42);
      const power = constructBuilding(state, 'POWER', 0, 20, 18);
      power.hp = 150;
      const repair = spawnUnit(state, 'REPAIR', 0, 14, 16);
      tick(state, [{ type: 'REPAIR', playerId: 0, unitIds: [repair.id], targetId: power.id }]);
      runTicks(state, 200);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
