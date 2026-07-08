import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  createGame,
  hashState,
  spawnUnit,
  tick,
  type GameState,
} from '../src/index.js';

/** Open battlefield, no starting clutter around the deploy spot. */
function arena(seed = 1): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  return state;
}

describe('MCV (Baufahrzeug)', () => {
  it('deploys into a construction yard and is consumed', () => {
    const state = arena();
    const mcv = spawnUnit(state, 'MCV', 0, 30, 30);
    tick(state, [{ type: 'DEPLOY', playerId: 0, unitIds: [mcv.id] }]);
    expect(state.units.some((u) => u.id === mcv.id)).toBe(false); // consumed
    const hq = state.buildings.find((b) => b.owner === 0 && b.type === 'CONYARD');
    expect(hq).toBeTruthy();
    // Footprint centred on the MCV's cell.
    expect(hq!.cx).toBe(29);
    expect(hq!.cy).toBe(29);
  });

  it('will not deploy onto a blocked footprint', () => {
    const state = arena(2);
    const mcv = spawnUnit(state, 'MCV', 0, 30, 30);
    const blocker = spawnUnit(state, 'RIFLEMAN', 0, 31, 31); // inside the 3×3 footprint
    tick(state, [{ type: 'DEPLOY', playerId: 0, unitIds: [mcv.id] }]);
    expect(state.units.some((u) => u.id === mcv.id)).toBe(true); // still a vehicle
    expect(state.buildings.some((b) => b.owner === 0 && b.type === 'CONYARD')).toBe(false);
    expect(blocker.hp).toBeGreaterThan(0);
  });

  it('an undeployed MCV keeps a baseless player in the game', () => {
    const state = createGame(3, { ai: true, opponents: 1 });
    // Wipe the human's buildings but leave them an MCV to rebuild with.
    state.buildings = state.buildings.filter((b) => b.owner !== 0);
    spawnUnit(state, 'MCV', 0, 20, 20);
    tick(state);
    expect(state.winner).toBe(-1); // not defeated — the MCV counts as alive
  });

  it('deploy at the map edge neither crashes nor deploys', () => {
    const state = arena(4);
    const mcv = spawnUnit(state, 'MCV', 0, 0, 0); // 3×3 footprint leaves the map
    tick(state, [{ type: 'DEPLOY', playerId: 0, unitIds: [mcv.id] }]);
    expect(state.units.some((u) => u.id === mcv.id)).toBe(true);
    expect(state.buildings.length).toBe(0);
  });

  it('an MCV riding a transport also keeps the player alive', () => {
    const state = createGame(11, { ai: true, opponents: 1, mapType: 'ISLANDS' });
    const [hx, hy] = state.spawns[0]!;
    const mcv = spawnUnit(state, 'MCV', 0, hx + 3, hy + 3);
    const transport = spawnUnit(state, 'TRANSPORT', 0, 22, 10);
    // Put the MCV aboard (the classic ferry-to-a-new-island move).
    if (state.occupancy[mcv.cell] === mcv.id) state.occupancy[mcv.cell] = 0;
    transport.passengers.push(mcv);
    state.units = state.units.filter((u) => u.id !== mcv.id);
    state.buildings = state.buildings.filter((b) => b.owner !== 0); // base wiped
    tick(state);
    expect(state.winner).toBe(-1); // still in the game
  });

  it('the AI redeploys its reserve MCV after losing the construction yard', () => {
    const state = createGame(7, { ai: true, opponents: 1 });
    const mcv = spawnUnit(state, 'MCV', 1, 40, 40);
    state.buildings = state.buildings.filter((b) => !(b.owner === 1 && b.type === 'CONYARD'));
    for (let t = 0; t < 60 && !state.buildings.some((b) => b.owner === 1 && b.type === 'CONYARD'); t++) {
      tick(state);
    }
    expect(state.buildings.some((b) => b.owner === 1 && b.type === 'CONYARD')).toBe(true);
    expect(state.units.some((u) => u.id === mcv.id)).toBe(false); // consumed by redeploy
  });

  it('stays deterministic through a deploy', () => {
    const run = (): string => {
      const state = arena(9);
      const mcv = spawnUnit(state, 'MCV', 0, 28, 28);
      tick(state, [{ type: 'DEPLOY', playerId: 0, unitIds: [mcv.id] }]);
      for (let i = 0; i < 30; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
