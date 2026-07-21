import { describe, expect, it } from 'vitest';
import {
  CRATE_LIFETIME_TICKS,
  NEUTRAL_OWNER,
  TERRAIN_DIRT,
  WALL_LEVELS,
  buildingRule,
  canPlaceBuilding,
  constructBuilding,
  createGame,
  sellRefund,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';
import { aggroKindOfType } from '../src/targeting.js';

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

describe('Logik-Fixes aus dem Review', () => {
  it('the sim refuses CHEAT commands in internet matches', () => {
    const mp = createGame(7, {
      multiplayer: {
        seats: [
          { faction: 'ALLIES', name: 'A' },
          { faction: 'SOVIETS', name: 'B' },
        ],
      },
    });
    expect(mp.multiplayer).toBe(true);
    const before = mp.players[0]!.credits;
    tick(mp, [{ type: 'CHEAT', playerId: 0, cheat: 'MONEY' }]);
    tick(mp, [{ type: 'CHEAT', playerId: 0, cheat: 'REVEAL' }]);
    expect(mp.players[0]!.credits).toBe(before);
    expect(mp.players[0]!.mapRevealed).toBe(false);

    // Solo games keep their cheats.
    const solo = arena();
    const soloBefore = solo.players[0]!.credits;
    tick(solo, [{ type: 'CHEAT', playerId: 0, cheat: 'MONEY' }]);
    expect(solo.players[0]!.credits).toBeGreaterThan(soloBefore);
  });

  it('buildings and walls cannot be placed over a crate', () => {
    const state = arena();
    state.crates.push({ id: state.nextEntityId++, cx: 8, cy: 8, kind: 'MONEY', born: 0 });
    // Inside the conyard's build radius, cell otherwise free.
    expect(canPlaceBuilding(state, 0, 'WALL', 8, 8)).toBe(false);
    expect(canPlaceBuilding(state, 0, 'POWER', 7, 7)).toBe(false); // footprint covers 8,8
    expect(canPlaceBuilding(state, 0, 'WALL', 9, 9)).toBe(true); // next to it is fine
  });

  it('unclaimed crates expire and free their slot', () => {
    const state = arena();
    state.crates.push({ id: state.nextEntityId++, cx: 30, cy: 30, kind: 'MONEY', born: state.tick });
    runTicks(state, CRATE_LIFETIME_TICKS + 2);
    expect(state.crates.some((c) => c.cx === 30 && c.cy === 30)).toBe(false);
  });

  it('a HEAL crate never revives units that died this same tick', () => {
    const state = arena();
    state.crates.push({ id: state.nextEntityId++, cx: 30, cy: 30, kind: 'HEAL', born: state.tick });
    const collector = spawnUnit(state, 'TANK', 0, 30, 30);
    const dead = spawnUnit(state, 'RIFLEMAN', 0, 31, 30);
    dead.hp = 0; // fell earlier this tick (combat runs before crates)
    tick(state);
    expect(collector.hp).toBe(unitRule('TANK').maxHp);
    expect(state.units.some((u) => u.id === dead.id)).toBe(false); // stays dead
  });

  it('selling during a running upgrade refunds half the upgrade cost too', () => {
    const state = arena();
    const tower = constructBuilding(state, 'GUARDTOWER', 0, 8, 8);
    const upgradeCost = buildingRule('GUARDTOWER').upgradeCost!;
    state.players[0]!.credits = upgradeCost;
    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: tower.id }]);
    expect(state.players[0]!.credits).toBe(0);
    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: tower.id }]);
    expect(state.players[0]!.credits).toBe(
      sellRefund('GUARDTOWER', 1) + Math.floor(upgradeCost / 2),
    );
  });

  it('capturing a building clears the old owner’s repair order', () => {
    const state = arena();
    const power = constructBuilding(state, 'POWER', 1, 20, 20);
    power.hp = 100;
    power.repairing = true;
    const engineer = spawnUnit(state, 'ENGINEER', 0, 19, 20);
    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [engineer.id], targetId: power.id }]);
    runTicks(state, 40);
    expect(power.owner).toBe(0);
    expect(power.repairing).toBe(false);
  });

  it('a full wall repair costs about half the wall price (no 1-credit-floor gouging)', () => {
    const state = arena();
    const wall = constructBuilding(state, 'WALL', 0, 22, 22);
    wall.hp = 1;
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'TOGGLE_REPAIR', playerId: 0, buildingId: wall.id }]);
    runTicks(state, 400);
    expect(wall.hp).toBe(WALL_LEVELS[0]!.maxHp);
    const paid = credits - state.players[0]!.credits;
    // Wall costs 50 → intended ≈ 25; the old floor charged ~125 for level 1.
    expect(paid).toBeLessThanOrEqual(30);
    expect(paid).toBeGreaterThan(0);
  });

  it('the gunboat hunts submarines (antiSub), submerged attackers rally only sub hunters', () => {
    expect(unitRule('GUNBOAT').weapon!.antiSub).toBe(true);
    expect(aggroKindOfType('SUB')).toBe('sub');
    expect(aggroKindOfType('MISSILESUB')).toBe('sub');
    expect(aggroKindOfType('DESTROYER')).toBe('naval');
  });

  it('effective speed 1 still crosses diagonal waypoints (no freeze)', () => {
    const state = createGame(7, { balance: { units: { RIFLEMAN: { speed: 1 } } } });
    state.units = [];
    state.buildings = [];
    state.occupancy.fill(0);
    state.structures.fill(0);
    state.terrain.fill(TERRAIN_DIRT);
    constructBuilding(state, 'CONYARD', 0, 5, 5);
    constructBuilding(state, 'CONYARD', 1, 55, 55);
    const walker = spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [walker.id], cx: 21, cy: 21 }]);
    for (let i = 0; i < 800 && walker.path; i++) tick(state);
    expect(walker.path).toBeNull();
    expect(walker.cell % state.mapWidth).toBe(21);
  });

  it('a successful capture emits no DEATH event (no false lost-unit alarm)', () => {
    const state = arena();
    const hospital = constructBuilding(state, 'HOSPITAL', NEUTRAL_OWNER, 20, 20);
    const engineer = spawnUnit(state, 'ENGINEER', 0, 19, 20);
    tick(state, [{ type: 'CAPTURE', playerId: 0, unitIds: [engineer.id], targetId: hospital.id }]);
    let sawDeath = false;
    for (let i = 0; i < 40 && hospital.owner !== 0; i++) {
      tick(state);
      if (state.events.some((e) => e.type === 'DEATH')) sawDeath = true;
    }
    expect(hospital.owner).toBe(0);
    expect(sawDeath).toBe(false);
  });
});
