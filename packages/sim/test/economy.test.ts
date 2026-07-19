import { describe, expect, it } from 'vitest';
import {
  buildingRule,
  canPlaceBuilding,
  cellIndex,
  constructBuilding,
  createGame,
  tick,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

function p0(state: GameState) {
  return state.players[0]!;
}

describe('production', () => {
  it('builds a power plant: gradual credit drain, ready, place', () => {
    const state = createGame(7);
    const startCredits = p0(state).credits;
    const rule = buildingRule('POWER');

    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'POWER' }]);
    runTicks(state, rule.buildTime);
    expect(p0(state).queues.building.ready).toBe(true);
    expect(p0(state).credits).toBe(startCredits - rule.cost);

    tick(state, [{ type: 'PLACE_BUILDING', playerId: 0, cx: 17, cy: 17 }]);
    expect(state.buildings.some((b) => b.type === 'POWER' && b.owner === 0)).toBe(true);
    expect(p0(state).queues.building.item).toBeNull();
    // Footprint stamped into the structures grid.
    expect(state.structures[cellIndex(state, 17, 17)]).toBeGreaterThan(0);
  });

  it('rejects items whose prerequisites are missing', () => {
    const state = createGame(7);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'FACTORY' }]); // needs REFINERY
    expect(p0(state).queues.building.item).toBeNull();
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'TANK' }]); // needs FACTORY
    expect(p0(state).queues.vehicle.item).toBeNull();
  });

  it('stalls when broke and refunds the paid share on cancel', () => {
    const state = createGame(7);
    p0(state).credits = 100; // POWER costs 300
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'POWER' }]);
    runTicks(state, 200);
    expect(p0(state).queues.building.ready).toBe(false);
    expect(p0(state).credits).toBeGreaterThanOrEqual(0);

    tick(state, [{ type: 'BUILD_CANCEL', playerId: 0, category: 'building' }]);
    expect(p0(state).credits).toBe(100); // everything paid came back
    expect(p0(state).queues.building.item).toBeNull();
  });

  it('a power deficit halves production speed', () => {
    const ticksToTrain = (withPower: boolean): number => {
      const state = createGame(7);
      if (withPower) constructBuilding(state, 'POWER', 0, 17, 17);
      constructBuilding(state, 'BARRACKS', 0, 19, 19);
      const before = state.units.length;
      tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' }]);
      for (let t = 1; t < 200; t++) {
        tick(state);
        if (state.units.length > before) return t;
      }
      throw new Error('never trained');
    };
    const fast = ticksToTrain(true);
    const slow = ticksToTrain(false);
    expect(slow).toBeGreaterThanOrEqual(fast * 2 - 2);
  });

  it('trained units spawn adjacent to their producer', () => {
    const state = createGame(7);
    constructBuilding(state, 'POWER', 0, 17, 17);
    const barracks = constructBuilding(state, 'BARRACKS', 0, 19, 19);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' }]);
    runTicks(state, 60);
    const recruit = state.units[state.units.length - 1]!;
    expect(recruit.type).toBe('RIFLEMAN');
    const cx = recruit.cell % state.mapWidth;
    const cy = (recruit.cell - cx) / state.mapWidth;
    const dist = Math.max(
      Math.abs(cx - barracks.cx - 1),
      Math.abs(cy - barracks.cy - 1),
    );
    expect(dist).toBeLessThanOrEqual(3);
  });

  it('honors rally points for produced units', () => {
    const state = createGame(7);
    constructBuilding(state, 'POWER', 0, 17, 17);
    const barracks = constructBuilding(state, 'BARRACKS', 0, 19, 19);
    tick(state, [
      { type: 'SET_RALLY', playerId: 0, buildingId: barracks.id, cx: 16, cy: 20 },
      { type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' },
    ]);
    // The base layout forces a scenic route around parked units — give the
    // recruit time to arrive.
    runTicks(state, 400);
    const recruit = state.units[state.units.length - 1]!;
    const cx = recruit.cell % state.mapWidth;
    const cy = (recruit.cell - cx) / state.mapWidth;
    expect(Math.max(Math.abs(cx - 16), Math.abs(cy - 20))).toBeLessThanOrEqual(2);
  });

  it('spawns from the barracks whose rally point was set (primary building)', () => {
    const state = createGame(7);
    constructBuilding(state, 'POWER', 0, 17, 17);
    constructBuilding(state, 'BARRACKS', 0, 19, 19); // first producer
    const second = constructBuilding(state, 'BARRACKS', 0, 24, 19);
    tick(state, [
      { type: 'SET_RALLY', playerId: 0, buildingId: second.id, cx: 27, cy: 21 },
      { type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' },
    ]);
    runTicks(state, 400);
    const recruit = state.units[state.units.length - 1]!;
    const cx = recruit.cell % state.mapWidth;
    const cy = (recruit.cell - cx) / state.mapWidth;
    expect(Math.max(Math.abs(cx - 27), Math.abs(cy - 21))).toBeLessThanOrEqual(2);
  });
});

describe('placement rules', () => {
  it('validates ground, structures, units, ore and build radius', () => {
    const state = createGame(7);
    expect(canPlaceBuilding(state, 0, 'POWER', 17, 17)).toBe(true);
    expect(canPlaceBuilding(state, 0, 'POWER', 14, 14)).toBe(false); // on conyard
    expect(canPlaceBuilding(state, 0, 'POWER', 17, 13)).toBe(false); // on tanks
    expect(canPlaceBuilding(state, 0, 'POWER', 30, 30)).toBe(false); // too far from base
    expect(canPlaceBuilding(state, 0, 'POWER', 22, 16)).toBe(false); // on ore
  });
});

describe('harvesting', () => {
  it('full cycle: dig ore, dock at the refinery, earn credits, repeat', () => {
    const state = createGame(7);
    constructBuilding(state, 'REFINERY', 0, 17, 19);
    p0(state).credits = 0; // make room below the storage cap so earnings show
    const startCredits = p0(state).credits;
    const oreBefore = state.ore.reduce((a, b) => a + b, 0);

    runTicks(state, 600); // starting harvester auto-dispatches itself

    expect(p0(state).credits).toBeGreaterThan(startCredits);
    expect(state.ore.reduce((a, b) => a + b, 0)).toBeLessThan(oreBefore);
    // Earnings arrive in full loads.
    expect((p0(state).credits - startCredits) % 500).toBe(0);
  });

  it('a full harvester without a refinery waits instead of looping', () => {
    const state = createGame(7);
    const harvester = state.units.find((u) => u.type === 'HARVESTER')!;
    runTicks(state, 400);
    expect(harvester.cargo).toBe(500); // filled up, nowhere to unload
    expect(p0(state).credits).toBe(5000);
  });
});
