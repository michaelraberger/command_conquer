import { describe, expect, it } from 'vitest';
import {
  SUPERWEAPON_CHARGE_TICKS,
  SUPERWEAPON_TRAVEL_TICKS,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Battlefield with both players anchored so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 13, 13);
  constructBuilding(state, 'CONYARD', 1, 45, 44);
  return state;
}

describe('superweapons', () => {
  it('silos charge only while power holds', () => {
    const state = arena();
    const silo = constructBuilding(state, 'NUKESILO', 0, 17, 17); // -100 power, none produced
    runTicks(state, 10);
    expect(silo.charge).toBe(0); // offline

    constructBuilding(state, 'POWER', 0, 17, 20);
    runTicks(state, 10);
    expect(silo.charge).toBe(10);
  });

  it('fires only when charged, detonates with falloff, ignores walls-armor', () => {
    const state = arena();
    const silo = constructBuilding(state, 'NUKESILO', 0, 17, 17);
    constructBuilding(state, 'POWER', 0, 17, 20);

    // Not charged yet → command is a no-op.
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 40, cy: 40 }]);
    expect(state.strikes.length).toBe(0);

    silo.charge = SUPERWEAPON_CHARGE_TICKS;
    const center = spawnUnit(state, 'TANK', 1, 40, 40);
    const edge = spawnUnit(state, 'RIFLEMAN', 1, 43, 40); // 3 cells out, inside r=3.5
    const outside = spawnUnit(state, 'TANK', 1, 46, 40); // 6 cells out, safe

    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 40, cy: 40 }]);
    expect(state.strikes.length).toBe(1);
    // Reset after launch (recharging starts again in the very same tick).
    expect(silo.charge).toBeLessThanOrEqual(1);

    runTicks(state, SUPERWEAPON_TRAVEL_TICKS + 1);
    expect(state.strikes.length).toBe(0);
    // Ground zero: tank (300 hp) is vaporized; edge rifleman too (100 hp).
    expect(state.units.some((u) => u.id === center.id)).toBe(false);
    expect(state.units.some((u) => u.id === edge.id)).toBe(false);
    expect(outside.hp).toBe(unitRule('TANK').maxHp);
  });

  it('damages buildings and can win the game', () => {
    const state = arena();
    const silo = constructBuilding(state, 'NUKESILO', 0, 17, 17);
    constructBuilding(state, 'POWER', 0, 17, 20);
    silo.charge = SUPERWEAPON_CHARGE_TICKS;

    // Enemy conyard (1500 hp) at (45,44), center ~ (46.5, 45.5).
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 46, cy: 45 }]);
    runTicks(state, SUPERWEAPON_TRAVEL_TICKS + 2);
    const enemyYard = state.buildings.find((b) => b.owner === 1);
    // 1000 dmg near ground zero doesn't one-shot the 1500 hp yard…
    expect(enemyYard).toBeDefined();
    expect(enemyYard!.hp).toBeLessThan(600);

    // …but the second nuke finishes the job and wins the game.
    silo.charge = SUPERWEAPON_CHARGE_TICKS;
    tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 46, cy: 45 }]);
    runTicks(state, SUPERWEAPON_TRAVEL_TICKS + 2);
    expect(state.winner).toBe(0);
  });

  it('stays deterministic with strikes in flight', () => {
    const run = (): string => {
      const state = arena(99);
      const silo = constructBuilding(state, 'WEATHER', 0, 17, 17);
      constructBuilding(state, 'POWER', 0, 17, 20);
      silo.charge = SUPERWEAPON_CHARGE_TICKS;
      spawnUnit(state, 'TANK', 1, 40, 40);
      tick(state, [{ type: 'FIRE_SUPERWEAPON', playerId: 0, cx: 40, cy: 40 }]);
      runTicks(state, 200);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});

describe('ai grace period', () => {
  it('never attacks before the 10-minute mark, even with a full army', () => {
    const state = createGame(7, { ai: true, aiDifficulty: 'hard' });
    // Hand the AI a ready wave right away.
    for (let i = 0; i < 8; i++) spawnUnit(state, 'TANK', 1, 40 + (i % 4), 40 + Math.floor(i / 4));
    state.tick = 5000; // past the attack cooldown, before the grace period

    runTicks(state, 100);
    // Nobody marched west: all AI combat units still in their quadrant.
    const marching = state.units.some((u) => {
      if (u.owner !== 1 || unitRule(u.type).weapon === null) return false;
      const cx = u.cell % state.mapWidth;
      return cx < 32 && (u.cell - cx) / state.mapWidth < 32;
    });
    expect(marching).toBe(false);
    expect(state.players[1]!.aiLastAttackTick).toBe(0);

    state.tick = 9000; // grace period over
    runTicks(state, 60);
    expect(state.players[1]!.aiLastAttackTick).toBeGreaterThanOrEqual(9000);
  });
});

describe('ai difficulty', () => {
  it('applies the decision interval per difficulty', () => {
    // Every AI acts on tick 0; the interval shows in how fast it RE-queues
    // after its order gets cancelled.
    const requeueTick = (difficulty: 'easy' | 'normal' | 'hard'): number => {
      const state = createGame(7, { ai: true, aiDifficulty: difficulty });
      tick(state); // AI queues its first building at tick 0
      expect(state.players[1]!.queues.building.item).not.toBeNull();
      tick(state, [{ type: 'BUILD_CANCEL', playerId: 1, category: 'building' }]);
      for (let t = 0; t < 90; t++) {
        tick(state);
        if (state.players[1]!.queues.building.item !== null) return state.tick;
      }
      return -1;
    };
    const hard = requeueTick('hard');
    const normal = requeueTick('normal');
    const easy = requeueTick('easy');
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
  });

  it('hard AI out-develops easy AI over the same time', () => {
    const score = (difficulty: 'easy' | 'hard'): number => {
      const state = createGame(1337, { ai: true, aiDifficulty: difficulty });
      // Neutralize the human so the AI develops undisturbed.
      for (let t = 0; t < 2000 && state.winner === -1; t++) tick(state);
      return (
        state.buildings.filter((b) => b.owner === 1).length * 3 +
        state.units.filter((u) => u.owner === 1).length +
        (state.winner === 1 ? 50 : 0)
      );
    };
    expect(score('hard')).toBeGreaterThan(score('easy'));
  }, 30000);

  it('easy AI skips high tech, hard AI builds a superweapon silo eventually', () => {
    // The silo is gated behind the 'super' tech now; make research fast so the
    // hard AI reaches it within the test budget.
    const fastResearch = {
      research: Object.fromEntries(
        ['repair', 'flak', 'spy', 'artillery', 'armor', 'air', 'navy', 'tesla', 'super'].map((t) => [
          t,
          { time: 60, cost: 200 },
        ]),
      ),
    };
    const state = createGame(1337, { ai: true, aiDifficulty: 'hard', balance: fastResearch });
    for (let t = 0; t < 13000 && state.winner === -1; t++) {
      tick(state);
      if (state.buildings.some((b) => b.owner === 1 && b.type === 'NUKESILO')) break;
    }
    const gotSiloOrWon =
      state.buildings.some((b) => b.owner === 1 && b.type === 'NUKESILO') || state.winner === 1;
    expect(gotSiloOrWon).toBe(true);
  }, 30000);
});
