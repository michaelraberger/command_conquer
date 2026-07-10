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
  type Command,
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

describe('Fortschr. Wachturm (AGT-Upgrade)', () => {
  const upgrade = (id: number): Command => ({ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: id });

  it('Wachturm can be upgraded to the AGT in place, paying the difference', () => {
    const { state, tower } = withTower();
    const rule = buildingRule('GUARDTOWER');
    expect(rule.upgradeTo).toBe('AGT');
    state.players[0]!.credits = 1000;
    const cx = tower.cx, cy = tower.cy;

    tick(state, [upgrade(tower.id)]);
    const now = state.buildings.find((b) => b.id === tower.id)!;
    expect(now.type).toBe('AGT');
    expect(now.cx).toBe(cx); // same footprint / position
    expect(now.cy).toBe(cy);
    expect(now.hp).toBe(buildingRule('AGT').maxHp);
    expect(state.players[0]!.credits).toBe(1000 - (rule.upgradeCost ?? 0));
  });

  it('is not directly buildable (upgrade-only) and hits air + ground', () => {
    const rule = buildingRule('AGT');
    expect(rule.buildable).toBe(false);
    expect(rule.weapon!.targets).toBe('both');
    expect(rule.manned).not.toBe(true); // deactivates on low power
  });

  it('has a dead zone: it cannot hit an adjacent unit but hits one further out', () => {
    const mk = () => {
      const state = createGame(7);
      // The AGT is unmanned — it needs power to fire, so give the base a plant.
      constructBuilding(state, 'POWER', 0, 26, 26);
      const t = constructBuilding(state, 'GUARDTOWER', 0, 30, 30);
      state.players[0]!.credits = 1000;
      tick(state, [upgrade(t.id)]);
      return state;
    };
    // Adjacent enemy (1 cell away) — inside the minRange dead zone.
    const closeState = mk();
    const adjacent = spawnUnit(closeState, 'RIFLEMAN', 1, 31, 30);
    adjacent.order = null;
    const adjHp = adjacent.hp;
    for (let t = 0; t < 15; t++) tick(closeState, []);
    expect(adjacent.hp).toBe(adjHp); // never fired at the point-blank target

    // Enemy at ~5 cells — outside the dead zone, inside range.
    const farState = mk();
    const outside = spawnUnit(farState, 'RIFLEMAN', 1, 35, 30);
    outside.order = null;
    const outHp = outside.hp;
    for (let t = 0; t < 15; t++) tick(farState, []);
    expect(outside.hp).toBeLessThan(outHp);
  });

  it('AGT upgrade round-trips through serialize and stays deterministic', () => {
    const run = () => {
      const { state, tower } = withTower();
      state.players[0]!.credits = 1000;
      tick(state, [upgrade(tower.id)]);
      spawnUnit(state, 'RIFLEMAN', 1, 35, 30);
      for (let t = 0; t < 60; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
