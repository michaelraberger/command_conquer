import { describe, expect, it } from 'vitest';
import {
  HARVEST_RATE,
  SUBCELL,
  buildingRule,
  createGame,
  hashState,
  powerBalance,
  tick,
  unitRule,
} from '../src/index.js';
import * as sim from '../src/index.js';

describe('balance config', () => {
  it('overrides economy, prices, power and speeds per game', () => {
    createGame(1, {
      balance: {
        economy: { startCredits: 1234, harvestRate: 99 },
        units: { TANK: { cost: 100, speed: 60, damage: 7, rangeCells: 8 } },
        buildings: { POWER: { power: 500, cost: 50 } },
      },
    });
    expect(sim.HARVEST_RATE).toBe(99);
    expect(sim.STARTING_CREDITS).toBe(1234);
    expect(unitRule('TANK').cost).toBe(100);
    expect(unitRule('TANK').speed).toBe(60);
    expect(unitRule('TANK').weapon!.damage).toBe(7);
    expect(unitRule('TANK').weapon!.range).toBe(Math.round(8 * SUBCELL));
    expect(unitRule('TANK').weapon!.rangeSq).toBe(Math.round(8 * SUBCELL) ** 2);
    expect(buildingRule('POWER').power).toBe(500);
    expect(buildingRule('POWER').cost).toBe(50);
  });

  it('start credits and power balance take effect in the created game', () => {
    const state = createGame(2, {
      balance: {
        economy: { startCredits: 777 },
        buildings: { POWER: { power: 500 } },
        units: { HARVESTER: { speed: 1 } },
      },
    });
    expect(state.players[0]!.credits).toBe(777);
    // The starting conyard produces no power; build one plant via cheat-spawn.
    sim.constructBuilding(state, 'POWER', 0, 8, 8);
    expect(powerBalance(state, 0).produced).toBe(500);
  });

  it('resets to shipped defaults for the next game (configs never stack)', () => {
    createGame(3, {
      balance: { economy: { harvestRate: 99 }, units: { TANK: { cost: 1 } } },
    });
    const state = createGame(4); // no config
    expect(sim.HARVEST_RATE).toBe(4);
    expect(unitRule('TANK').cost).toBe(900);
    expect(state.players[0]!.credits).toBe(5000);
  });

  it('ignores unknown keys and unusable numbers', () => {
    createGame(5, {
      balance: {
        economy: { harvestRate: Number.NaN },
        units: {
          TANK: { cost: Number.POSITIVE_INFINITY, speed: -5 },
          // @ts-expect-error unknown unit types are tolerated at runtime
          NOT_A_UNIT: { cost: 1 },
        },
      },
    });
    expect(sim.HARVEST_RATE).toBe(4); // NaN → default
    expect(unitRule('TANK').cost).toBe(900); // Infinity → default
    expect(unitRule('TANK').speed).toBe(1); // clamped to minimum
  });

  it('values are truncated to integers (determinism contract)', () => {
    createGame(6, { balance: { units: { TANK: { speed: 41.9, cost: 500.7 } } } });
    expect(unitRule('TANK').speed).toBe(41);
    expect(unitRule('TANK').cost).toBe(500);
  });

  it('same seed + same config stays deterministic', () => {
    const balance = {
      economy: { harvestRate: 12 },
      units: { TANK: { speed: 50 } },
    };
    const run = (): string => {
      const state = createGame(42, { balance });
      const ids = state.units.filter((u) => u.owner === 0).map((u) => u.id);
      tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: ids, cx: 40, cy: 40 }]);
      for (let i = 0; i < 150; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });

  it('live import binding sees the current value', () => {
    createGame(7, { balance: { economy: { harvestRate: 33 } } });
    expect(HARVEST_RATE).toBe(33); // named import, not the namespace
    createGame(8);
    expect(HARVEST_RATE).toBe(4);
  });
});
