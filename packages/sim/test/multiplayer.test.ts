import { describe, expect, it } from 'vitest';
import {
  areEnemies,
  createGame,
  hashState,
  tick,
  type GameState,
  type MapType,
} from '../src/index.js';

const MAPS: MapType[] = ['BADLANDS', 'RIVER', 'ISLANDS'];

const conyards = (state: GameState, owner: number): number =>
  state.buildings.filter((b) => b.owner === owner && b.type === 'CONYARD').length;

describe('multiple opponents', () => {
  for (const opponents of [1, 2, 3, 4, 5]) {
    const players = opponents + 1;
    for (const map of MAPS) {
      it(`sets up ${players} players with own bases on ${map}`, () => {
        const state = createGame(2024, { ai: true, opponents, mapType: map });
        expect(state.players.length).toBe(players);
        expect(state.fogs.length).toBe(players);
        expect(state.spawns.length).toBe(players);
        // Every player gets exactly one construction yard on buildable ground.
        for (let id = 0; id < players; id++) expect(conyards(state, id)).toBe(1);
        // Distinct player colours so no two sides look alike.
        expect(new Set(state.players.map((p) => p.color)).size).toBe(players);
      });
    }
  }

  it('the human (team 0) fights every AI, and the AIs are allied', () => {
    const state = createGame(7, { ai: true, opponents: 3 });
    expect(state.players[0]!.team).toBe(0);
    for (let id = 1; id <= 3; id++) expect(state.players[id]!.team).toBe(1);
    // Human is hostile to all AIs...
    for (let id = 1; id <= 3; id++) expect(areEnemies(state, 0, id)).toBe(true);
    // ...but the AIs never target each other (they gang up on the human).
    expect(areEnemies(state, 1, 2)).toBe(false);
    expect(areEnemies(state, 2, 3)).toBe(false);
  });

  it('runs a 5-opponent island game deterministically without crashing', () => {
    const run = (): string => {
      const state = createGame(99, { ai: true, opponents: 5, mapType: 'ISLANDS' });
      for (let t = 0; t < 400 && state.winner === -1; t++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  }, 20000);

  for (const sz of [48, 96]) {
    for (const map of MAPS) {
      it(`scales a ${sz}² ${map} map with bases in bounds`, () => {
        const state = createGame(2024, {
          ai: true,
          opponents: 3,
          mapType: map,
          mapWidth: sz,
          mapHeight: sz,
        });
        expect(state.mapWidth).toBe(sz);
        expect(state.terrain.length).toBe(sz * sz);
        for (let id = 0; id < 4; id++) expect(conyards(state, id)).toBe(1);
        // Every spawn centre sits inside the (smaller/larger) map.
        for (const [x, y] of state.spawns) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(sz);
          expect(y).toBeLessThan(sz);
        }
      });
    }
  }

  it('a big-map game runs deterministically', () => {
    const run = (): string => {
      const s = createGame(5, { ai: true, opponents: 2, mapWidth: 96, mapHeight: 96 });
      for (let t = 0; t < 300 && s.winner === -1; t++) tick(s);
      return hashState(s);
    };
    expect(run()).toBe(run());
  }, 20000);

  it('the AI team wins when the human is wiped out', () => {
    const state = createGame(3, { ai: true, opponents: 2 });
    // Delete all of the human player's buildings — the AI team should win.
    state.buildings = state.buildings.filter((b) => b.owner !== 0);
    tick(state);
    expect(state.winner).toBeGreaterThan(0); // an AI id, not the human (0)
    expect(state.players[state.winner]!.team).toBe(1);
  });
});
