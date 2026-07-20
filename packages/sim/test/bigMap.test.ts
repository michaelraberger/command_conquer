import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_OWNER,
  buildingRule,
  createGame,
  deserialize,
  hashState,
  serialize,
  tick,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

describe('große Karten (192²)', () => {
  it('creates a 192² game with everything in bounds', () => {
    const state = createGame(1234, {
      mapWidth: 192,
      mapHeight: 192,
      opponents: 5,
      ai: true,
      aiDifficulty: 'hard',
    });
    expect(state.mapWidth).toBe(192);
    expect(state.terrain.length).toBe(192 * 192);
    expect(state.players.length).toBe(6);
    for (const [sx, sy] of state.spawns) {
      expect(sx).toBeGreaterThan(0);
      expect(sy).toBeGreaterThan(0);
      expect(sx).toBeLessThan(192);
      expect(sy).toBeLessThan(192);
    }
    // Every base got its conyard and starting force.
    expect(state.buildings.filter((b) => b.type === 'CONYARD').length).toBe(6);
  });

  it('places neutral tech buildings clear of every base', () => {
    const state = createGame(99, { mapWidth: 192, mapHeight: 192, opponents: 3 });
    const neutral = state.buildings.filter((b) => b.owner === NEUTRAL_OWNER && b.type !== 'BRIDGE');
    // Plenty of open ground on 192² — the hospital and at least one village
    // house must have found a spot.
    expect(neutral.some((b) => b.type === 'HOSPITAL')).toBe(true);
    expect(neutral.some((b) => b.type === 'HAUS1' || b.type === 'HAUS2')).toBe(true);
    for (const b of neutral) {
      const rule = buildingRule(b.type);
      const mx = b.cx + rule.width / 2;
      const my = b.cy + rule.height / 2;
      for (const [sx, sy] of state.spawns) {
        expect((mx - sx) * (mx - sx) + (my - sy) * (my - sy)).toBeGreaterThanOrEqual(12 * 12);
      }
    }
  });

  it('stays deterministic over 500 ticks with hard AIs', () => {
    const run = (): string => {
      const state = createGame(4321, {
        mapWidth: 192,
        mapHeight: 192,
        opponents: 3,
        ai: true,
        aiDifficulty: 'hard',
      });
      runTicks(state, 500);
      return hashState(state);
    };
    expect(run()).toBe(run());
  }, 30000);

  it('survives a serialize → deserialize round trip at 192²', () => {
    const state = createGame(777, { mapWidth: 192, mapHeight: 192, opponents: 2 });
    runTicks(state, 100);
    const copy = deserialize(serialize(state));
    expect(hashState(copy)).toBe(hashState(state));
    // The copy keeps ticking identically.
    tick(state);
    tick(copy);
    expect(hashState(copy)).toBe(hashState(state));
  }, 30000);
});
