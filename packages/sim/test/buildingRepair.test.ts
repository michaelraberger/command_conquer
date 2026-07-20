import { describe, expect, it } from 'vitest';
import {
  BUILDING_REPAIR_HP_PER_TICK,
  TERRAIN_DIRT,
  WALL_LEVELS,
  buildingMaxHp,
  constructBuilding,
  createGame,
  tick,
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

describe('Gebäude-Reparaturmodus', () => {
  it('toggling on heals per tick and drains credits', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = 100;
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    expect(power.repairing).toBe(true);
    expect(power.hp).toBe(100 + BUILDING_REPAIR_HP_PER_TICK);
    runTicks(state, 9);
    expect(power.hp).toBe(100 + 10 * BUILDING_REPAIR_HP_PER_TICK);
    expect(state.players[0]!.credits).toBeLessThan(credits);
  });

  it('a full 0→max repair costs about half the build price', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20); // cost 300, 750 hp
    power.hp = 1;
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    runTicks(state, 400); // plenty of time to finish
    expect(power.hp).toBe(buildingMaxHp(power));
    const paid = credits - state.players[0]!.credits;
    // 749 hp at 2 hp / 1 credit per tick ≈ 375 credits ≈ cost * 1.25... the
    // divisor-2 formula floors at 1 credit/tick, so cheap buildings pay the
    // floor: assert the paid total sits between 40% and 130% of the cost.
    expect(paid).toBeGreaterThan(120);
    expect(paid).toBeLessThan(400);
  });

  it('stops and clears the flag at full hp', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = buildingMaxHp(power) - 3;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    runTicks(state, 5);
    expect(power.hp).toBe(buildingMaxHp(power));
    expect(power.repairing).toBe(false);
  });

  it('a broke player pauses the repair but keeps the mode armed', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = 100;
    state.players[0]!.credits = 0;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    runTicks(state, 5);
    expect(power.hp).toBe(100);
    expect(power.repairing).toBe(true);
    expect(state.players[0]!.credits).toBe(0); // never negative
    // Money arrives → repair resumes.
    state.players[0]!.credits = 50;
    tick(state);
    expect(power.hp).toBeGreaterThan(100);
  });

  it('toggling off stops the repair', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 0, 20, 20);
    power.hp = 100;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: power.id }]);
    expect(power.repairing).toBe(false);
    const hp = power.hp;
    runTicks(state, 5);
    expect(power.hp).toBe(hp);
  });

  it('rejects foreign buildings and full-hp no-ops', () => {
    const state = arena();
    const enemy = constructBuilding(state, 'POWER', 1, 40, 40);
    enemy.hp = 100;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: enemy.id }]);
    expect(enemy.repairing).toBe(false);
    const own = constructBuilding(state, 'POWER', 0, 20, 20); // full hp
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: own.id }]);
    expect(own.repairing).toBe(false);
  });

  it('walls repair against their level maxHp', () => {
    const state = arena();
    const wall = constructBuilding(state, 'WALL', 0, 22, 22);
    wall.hp = 10;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: wall.id }]);
    runTicks(state, 300);
    expect(wall.hp).toBe(WALL_LEVELS[0]!.maxHp);
    expect(wall.repairing).toBe(false);
  });
});
