import { describe, expect, it } from 'vitest';
import {
  FOG_HIDDEN,
  FOG_VISIBLE,
  WALL_LEVELS,
  buildingMaxHp,
  cellIndex,
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

/** Battlefield without any pre-placed entities (keeps a p0 conyard optional). */
function emptyBattlefield(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  return state;
}

describe('walls', () => {
  it('places walls instantly for credits and blocks pathing', () => {
    const state = createGame(7);
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'PLACE_WALL', playerId: 0, cx: 17, cy: 17 }]);
    const wall = state.buildings.find((b) => b.type === 'WALL');
    expect(wall).toBeDefined();
    expect(state.players[0]!.credits).toBe(credits - 50);
    expect(state.structures[cellIndex(state, 17, 17)]).toBe(wall!.id);
  });

  it('upgrades through the tiers, raising max hp and charging credits', () => {
    const state = createGame(7);
    tick(state, [{ type: 'PLACE_WALL', playerId: 0, cx: 17, cy: 17 }]);
    const wall = state.buildings.find((b) => b.type === 'WALL')!;
    wall.hp = 50; // battered sandbags

    const before = state.players[0]!.credits;
    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: wall.id }]);
    expect(wall.level).toBe(2);
    expect(wall.hp).toBe(WALL_LEVELS[1]!.maxHp); // upgrade repairs
    expect(state.players[0]!.credits).toBe(before - WALL_LEVELS[1]!.upgradeCost);

    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: wall.id }]);
    expect(wall.level).toBe(3);
    expect(buildingMaxHp(wall)).toBe(WALL_LEVELS[2]!.maxHp);

    // No tier 4.
    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: wall.id }]);
    expect(wall.level).toBe(3);
  });
});

describe('buildings in combat', () => {
  it('tanks ordered to attack a building destroy it and free its cells', () => {
    const state = emptyBattlefield();
    constructBuilding(state, 'CONYARD', 0, 13, 13);
    const target = constructBuilding(state, 'POWER', 1, 18, 17);
    const tank = spawnUnit(state, 'TANK', 0, 13, 18);

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: target.id }]);
    for (let i = 0; i < 600 && state.buildings.some((b) => b.id === target.id); i++) tick(state);

    expect(state.buildings.some((b) => b.id === target.id)).toBe(false);
    expect(state.structures[cellIndex(state, 18, 17)]).toBe(0);
    expect(state.events.length >= 0).toBe(true);
  });

  it('losing all buildings loses the game', () => {
    const state = emptyBattlefield();
    constructBuilding(state, 'CONYARD', 0, 13, 13);
    const enemyYard = constructBuilding(state, 'POWER', 1, 18, 17);
    spawnUnit(state, 'TANK', 0, 13, 18);
    expect(state.winner).toBe(-1);
    enemyYard.hp = 0;
    runTicks(state, 2);
    expect(state.winner).toBe(0);
    // Sim is frozen but ticks keep counting.
    const t = state.tick;
    runTicks(state, 5);
    expect(state.tick).toBe(t + 5);
  });
});

describe('base defenses', () => {
  it('tesla coil zaps intruders, but only while power holds', () => {
    const state = emptyBattlefield();
    constructBuilding(state, 'CONYARD', 0, 25, 25); // keep p0 in the game
    constructBuilding(state, 'CONYARD', 1, 13, 13);
    constructBuilding(state, 'TESLA', 1, 17, 17); // -75 power, no plant → offline
    const victim = spawnUnit(state, 'RIFLEMAN', 0, 19, 17);

    runTicks(state, 10);
    expect(victim.hp).toBe(unitRule('RIFLEMAN').maxHp); // offline, no zap

    constructBuilding(state, 'POWER', 1, 13, 17); // +150 power → online
    runTicks(state, 3);
    expect(victim.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
    expect(state.units.length === 0 || victim.hp < 100).toBe(true);
  });
});

describe('werkstatt', () => {
  it('repairs nearby damaged vehicles for credits', () => {
    const state = emptyBattlefield();
    constructBuilding(state, 'CONYARD', 1, 40, 40); // keep p1 in the game
    constructBuilding(state, 'WERKSTATT', 0, 15, 15);
    const tank = spawnUnit(state, 'TANK', 0, 15, 18); // right below the shop
    const far = spawnUnit(state, 'TANK', 0, 25, 25);
    tank.hp = 100;
    far.hp = 100;
    const credits = state.players[0]!.credits;

    runTicks(state, 20);
    expect(tank.hp).toBeGreaterThan(100);
    expect(far.hp).toBe(100); // out of range
    expect(state.players[0]!.credits).toBeLessThan(credits);

    runTicks(state, 200);
    expect(tank.hp).toBe(unitRule('TANK').maxHp); // stops at full
  });
});

describe('factions', () => {
  it('gates units and buildings by faction', () => {
    const state = createGame(7, { factions: ['ALLIES', 'SOVIETS'] });
    // Allies cannot queue soviet tech.
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'TESLA' }]);
    expect(state.players[0]!.queues.building.item).toBeNull();
    // Soviets can (prereqs + tech aside — give them both).
    constructBuilding(state, 'REFINERY', 1, 42, 42);
    state.players[1]!.researched = ['tesla'];
    tick(state, [{ type: 'BUILD_START', playerId: 1, item: 'TESLA' }]);
    expect(state.players[1]!.queues.building.item).toBe('TESLA');
  });
});

describe('fog of war', () => {
  it('marks cells near own units visible and far cells hidden', () => {
    const state = createGame(7);
    runTicks(state, 4); // let the fog system stamp
    const fog = state.fogs[0]!;
    // Own spawn area is visible.
    expect(fog[cellIndex(state, 16, 16)]).toBe(FOG_VISIBLE);
    // Enemy corner is unexplored.
    expect(fog[cellIndex(state, 46, 46)]).toBe(FOG_HIDDEN);
    // Enemy sees their own base.
    expect(state.fogs[1]![cellIndex(state, 46, 46)]).toBe(FOG_VISIBLE);
  });
});

describe('ai opponent', () => {
  it('builds a base, trains an army and eventually attacks', () => {
    const state = createGame(1337, { ai: true });
    // Skip most of the 10-minute grace period — the AI develops during it
    // but must not attack before tick 9000.
    state.tick = 8000;
    let maxAiArmy = 0;
    // The TD-style map has real chokepoints (stream fords, ridges) — give the
    // AI a bit more room than on the old open layouts.
    for (let t = 0; t < 8500 && state.winner === -1; t++) {
      tick(state);
      const combat = state.units.filter(
        (u) => u.owner === 1 && unitRule(u.type).weapon !== null,
      ).length;
      if (combat > maxAiArmy) maxAiArmy = combat;
    }
    const aiBuildings = state.buildings.filter((b) => b.owner === 1).map((b) => b.type);
    expect(aiBuildings).toContain('POWER');
    expect(aiBuildings).toContain('REFINERY');
    expect(aiBuildings).toContain('FACTORY');
    expect(aiBuildings.length).toBeGreaterThanOrEqual(5);
    // The AI fielded a real army and beat the idle human within the budget.
    expect(maxAiArmy).toBeGreaterThanOrEqual(7);
    expect(state.winner).toBe(1);
  }, 30000);
});
