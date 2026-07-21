import { describe, expect, it } from 'vitest';
import {
  HOSPITAL_HP_PER_TICK,
  TERRAIN_DIRT,
  constructBuilding,
  createGame,
  deserialize,
  emptyStats,
  hashState,
  serialize,
  spawnUnit,
  storageCapacity,
  tick,
  unitRule,
  type CrateKind,
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

function dropCrate(state: GameState, cx: number, cy: number, kind: CrateKind): void {
  state.crates.push({ id: state.nextEntityId++, cx, cy, kind, born: state.tick });
}

describe('Partie-Statistik (Player.stats)', () => {
  it('a fresh game starts with empty stats — starting forces are not "produced"', () => {
    const state = createGame(7);
    for (const p of state.players) {
      expect(p.stats).toEqual(emptyStats());
    }
    expect(state.units.length).toBeGreaterThan(0); // starting forces exist
  });

  it('real production counts units and buildings per type', () => {
    const state = arena();
    const player = state.players[0]!;
    player.credits = 100000;
    constructBuilding(state, 'POWER', 0, 9, 5);
    constructBuilding(state, 'BARRACKS', 0, 12, 5);

    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' }]);
    runTicks(state, unitRule('RIFLEMAN').buildTime + 50);
    expect(player.stats.unitsProduced.RIFLEMAN).toBe(1);

    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'POWER' }]);
    runTicks(state, 2000);
    tick(state, [{ type: 'PLACE_BUILDING', playerId: 0, cx: 9, cy: 9 }]);
    expect(player.stats.buildingsBuilt.POWER).toBe(1);

    tick(state, [{ type: 'PLACE_WALL', playerId: 0, cx: 8, cy: 8 }]);
    expect(player.stats.buildingsBuilt.WALL).toBe(1);
  });

  it('a unit kill books unitsKilled for the shooter and unitsLost for the victim', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 20, 18);
    victim.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: victim.id }]);
    runTicks(state, 10);
    expect(state.players[0]!.stats.unitsKilled.RIFLEMAN).toBe(1);
    expect(state.players[1]!.stats.unitsLost.RIFLEMAN).toBe(1);
    expect(state.players[0]!.stats.unitsLost.RIFLEMAN).toBeUndefined();
  });

  it('a defense tower kill is attributed to the tower owner', () => {
    const state = arena();
    constructBuilding(state, 'GUARDTOWER', 0, 30, 30);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 32, 30);
    victim.hp = 1;
    runTicks(state, 15);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
    expect(state.players[0]!.stats.unitsKilled.RIFLEMAN).toBe(1);
  });

  it('a projectile kill still credits the owner after the shooter died mid-flight', () => {
    const state = arena();
    const arty = spawnUnit(state, 'ARTILLERY', 0, 18, 18);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 24, 18);
    victim.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [arty.id], targetId: victim.id }]);
    // Wait for the shell to leave the barrel, then kill the shooter.
    for (let i = 0; i < 60 && state.projectiles.length === 0; i++) tick(state);
    expect(state.projectiles.length).toBeGreaterThan(0);
    arty.hp = 0;
    runTicks(state, 60);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
    expect(state.players[0]!.stats.unitsKilled.RIFLEMAN).toBe(1);
  });

  it('a destroyed building books buildingsKilled and buildingsLost', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const power = constructBuilding(state, 'POWER', 1, 20, 18);
    power.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: power.id }]);
    runTicks(state, 20);
    expect(state.buildings.some((b) => b.id === power.id)).toBe(false);
    expect(state.players[0]!.stats.buildingsKilled.POWER).toBe(1);
    expect(state.players[1]!.stats.buildingsLost.POWER).toBe(1);
  });

  it('a consumed engineer (capture) does not count as a loss', () => {
    const state = arena();
    const enemyPower = constructBuilding(state, 'POWER', 1, 30, 30);
    const eng = spawnUnit(state, 'ENGINEER', 0, 28, 30);
    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [eng.id], targetId: enemyPower.id }]);
    for (let i = 0; i < 150 && state.units.some((u) => u.id === eng.id); i++) tick(state);
    expect(state.units.some((u) => u.id === eng.id)).toBe(false); // consumed
    expect(enemyPower.owner).toBe(0);
    expect(state.players[0]!.stats.unitsLost.ENGINEER).toBeUndefined();
    // The capture is no "kill" either — the building lives on.
    expect(state.players[0]!.stats.buildingsKilled.POWER).toBeUndefined();
    expect(state.players[1]!.stats.buildingsLost.POWER).toBeUndefined();
  });

  it('hospital healing books the exact hp delta to the unit owner', () => {
    const state = arena();
    constructBuilding(state, 'HOSPITAL', 0, 20, 20);
    const inf = spawnUnit(state, 'RIFLEMAN', 0, 30, 30);
    const maxHp = unitRule('RIFLEMAN').maxHp;
    inf.hp = maxHp - 40;
    runTicks(state, Math.ceil(40 / HOSPITAL_HP_PER_TICK) + 10);
    expect(inf.hp).toBe(maxHp);
    expect(state.players[0]!.stats.healingDone).toBe(40);
  });

  it('a HEAL crate books the exact delta to full hp, and the pickup counts', () => {
    const state = arena();
    const inf = spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    const maxHp = unitRule('RIFLEMAN').maxHp;
    inf.hp = maxHp - 30;
    dropCrate(state, 20, 20, 'HEAL');
    tick(state);
    expect(inf.hp).toBe(maxHp);
    expect(state.players[0]!.stats.healingDone).toBe(30);
    expect(state.players[0]!.stats.cratesCollected).toBe(1);
  });

  it('creditsHarvested counts only what was actually credited (storage cap)', () => {
    const state = createGame(7); // starting harvester + ore
    constructBuilding(state, 'REFINERY', 0, 17, 19);
    const cap = storageCapacity(state, 0);
    state.players[0]!.credits = cap - 100; // 100 of room left
    runTicks(state, 900);
    expect(state.players[0]!.credits).toBe(cap);
    // Exactly the 100 credited ones — the wasted overflow never counts.
    expect(state.players[0]!.stats.creditsHarvested).toBe(100);
  });

  it('Erz-Bohrturm income counts as creditsHarvested', () => {
    const state = arena();
    constructBuilding(state, 'ERZ_BOHRTURM', 0, 20, 20);
    const before = state.players[0]!.credits;
    runTicks(state, 46); // ticks 1..46 cross three whole seconds (15/30/45)
    const earned = state.players[0]!.credits - before;
    expect(earned).toBeGreaterThan(0);
    expect(state.players[0]!.stats.creditsHarvested).toBe(earned);
  });

  it('stats survive a serialize round trip hash-identically', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 18, 18);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 20, 18);
    victim.hp = 1;
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: victim.id }]);
    runTicks(state, 10);
    expect(state.players[0]!.stats.unitsKilled.RIFLEMAN).toBe(1);
    const copy = deserialize(serialize(state));
    expect(copy.players[0]!.stats).toEqual(state.players[0]!.stats);
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('old saves without stats load with empty counters', () => {
    const state = arena();
    const raw = JSON.parse(serialize(state)) as { players: Array<Record<string, unknown>> };
    for (const p of raw.players) delete p.stats;
    const copy = deserialize(JSON.stringify(raw));
    for (const p of copy.players) expect(p.stats).toEqual(emptyStats());
    tick(copy); // and the game keeps running
  });

  it('two identical combat runs produce identical stats and hashes', () => {
    const run = (): string => {
      const state = arena(99);
      const a = spawnUnit(state, 'TANK', 0, 18, 18);
      spawnUnit(state, 'RIFLEMAN', 1, 20, 18);
      spawnUnit(state, 'RIFLEMAN', 1, 21, 18);
      tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [a.id], cx: 22, cy: 18 }]);
      runTicks(state, 200);
      return `${hashState(state)}:${JSON.stringify(state.players.map((p) => p.stats))}`;
    };
    expect(run()).toBe(run());
  });
});
