import { describe, expect, it } from 'vitest';
import {
  BUILD_ADJACENCY,
  availableToFaction,
  buildAdjacency,
  buildingRule,
  constructBuilding,
  createGame,
  hashState,
  powerBalance,
  spawnUnit,
  tick,
} from '../src/index.js';

/** Fresh 2-player game with a guard tower for player 0 near the middle. */
function withTower() {
  const state = createGame(7);
  const tower = constructBuilding(state, 'GUARDTOWER', 0, 30, 30);
  return { state, tower };
}

describe('Wachturm (guard tower)', () => {
  it('is available to both factions and gated behind the Kaserne', () => {
    const rule = buildingRule('GUARDTOWER');
    expect(availableToFaction(rule.factions, 'ALLIES')).toBe(true);
    expect(availableToFaction(rule.factions, 'SOVIETS')).toBe(true);
    expect(rule.requires).toContain('BARRACKS');
    expect(rule.manned).toBe(true);
  });

  it('auto-fires at enemy infantry in range', () => {
    const { state } = withTower();
    const rifleman = spawnUnit(state, 'RIFLEMAN', 1, 32, 30);
    const before = rifleman.hp;
    for (let t = 0; t < 10; t++) tick(state, []);
    expect(rifleman.hp).toBeLessThan(before);
  });

  it('outranges the pillbox (6 cells) without extending the build radius', () => {
    const { state } = withTower();
    // 6 cells out: beyond the pillbox's 4.5, inside the tower's 6.5.
    const rifleman = spawnUnit(state, 'RIFLEMAN', 1, 36, 30);
    rifleman.order = null;
    const before = rifleman.hp;
    for (let t = 0; t < 10; t++) tick(state, []);
    expect(rifleman.hp).toBeLessThan(before);
    // Build radius stays the flat per-building adjacency, range-independent.
    expect(buildAdjacency('GUARDTOWER')).toBe(BUILD_ADJACENCY);
    expect(buildAdjacency('GUARDTOWER')).toBe(buildAdjacency('PILLBOX'));
  });

  it('keeps firing during a power deficit while the pillbox goes dark', () => {
    const { state } = withTower();
    const pillbox = constructBuilding(state, 'PILLBOX', 0, 36, 30);
    // The starting CONYARD produces no power — with two consumers the
    // player is in deficit from tick one.
    const { produced, used } = powerBalance(state, 0);
    expect(used).toBeGreaterThan(produced);

    const nearTower = spawnUnit(state, 'RIFLEMAN', 1, 28, 30);
    const nearPillbox = spawnUnit(state, 'RIFLEMAN', 1, 38, 30);
    // Pin both so they don't wander (guard stance would move them).
    nearTower.order = null;
    nearPillbox.order = null;
    const towerTargetHp = nearTower.hp;
    const pillboxTargetHp = nearPillbox.hp;
    for (let t = 0; t < 10; t++) tick(state, []);

    expect(nearTower.hp).toBeLessThan(towerTargetHp); // manned: fires anyway
    expect(nearPillbox.hp).toBe(pillboxTargetHp); // unmanned defense offline
    expect(pillbox.cooldown).toBe(0); // never fired
  });

  it('stays deterministic', () => {
    const run = () => {
      const { state } = withTower();
      spawnUnit(state, 'RIFLEMAN', 1, 32, 30);
      for (let t = 0; t < 60; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
