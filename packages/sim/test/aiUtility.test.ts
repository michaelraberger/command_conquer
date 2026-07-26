import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
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

/** Flat arena with an AI opponent; both sides start with only their HQ. */
function arena(seed = 7): GameState {
  const state = createGame(seed, { ai: true, aiDifficulty: 'hard' });
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 5, 28);
  constructBuilding(state, 'CONYARD', 1, 52, 28);
  return state;
}

function count(state: GameState, owner: number, type: string): number {
  return state.units.filter((u) => u.owner === owner && u.type === type).length;
}

describe('ai utility decisions', () => {
  it('counters an enemy air fleet with rocketeers instead of riflemen', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 1, 48, 24);
    constructBuilding(state, 'BARRACKS', 1, 48, 30);
    state.players[1]!.credits = 5000;
    for (let i = 0; i < 6; i++) spawnUnit(state, 'HELI', 0, 10 + i, 24);

    runTicks(state, 900);
    expect(count(state, 1, 'ROCKETEER')).toBeGreaterThanOrEqual(2);
    expect(count(state, 1, 'RIFLEMAN')).toBe(0);
  });

  it('injects flak towers into the build order under air threat', () => {
    const prep = (withAir: boolean): string | null => {
      const state = arena();
      constructBuilding(state, 'POWER', 1, 48, 24);
      constructBuilding(state, 'POWER', 1, 48, 20);
      constructBuilding(state, 'REFINERY', 1, 44, 24);
      constructBuilding(state, 'BARRACKS', 1, 48, 30);
      constructBuilding(state, 'FACTORY', 1, 44, 30);
      state.players[1]!.credits = 3000;
      state.players[1]!.researched.push('flak');
      if (withAir) for (let i = 0; i < 6; i++) spawnUnit(state, 'HELI', 0, 10 + i, 24);
      tick(state); // first AI pass queues the next build goal
      return state.players[1]!.queues.building.item;
    };
    expect(prep(true)).toBe('FLAKTOWER');
    expect(prep(false)).not.toBe('FLAKTOWER');
  });

  it('raids the undefended refinery, not the tesla-ringed one', () => {
    const state = arena();
    // Two equally distant refineries — one naked, one behind four teslas.
    constructBuilding(state, 'REFINERY', 0, 12, 10);
    constructBuilding(state, 'REFINERY', 0, 12, 46);
    for (const [cx, cy] of [[10, 44], [16, 44], [10, 49], [16, 49]] as const) {
      constructBuilding(state, 'TESLA', 0, cx, cy);
    }
    // A human standing army keeps the AI out of finisher mode (raid path).
    for (let i = 0; i < 3; i++) spawnUnit(state, 'TANK', 0, 5 + i, 36);
    for (let i = 0; i < 8; i++) spawnUnit(state, 'TANK', 1, 46 + (i % 4), 34 + ((i / 4) | 0));
    state.tick = 9000; // grace period over

    for (let t = 0; t < 40 && state.players[1]!.aiLastAttackTick < 9000; t++) tick(state);
    expect(state.players[1]!.aiLastAttackTick).toBeGreaterThanOrEqual(9000);
    const wave = state.units.filter(
      (u) => u.owner === 1 && u.type === 'TANK' && u.order?.kind === 'ATTACK_MOVE',
    );
    expect(wave.length).toBeGreaterThan(0);
    for (const u of wave) {
      expect(u.order!.kind).toBe('ATTACK_MOVE');
      // Wave rolls toward the naked refinery in the north, not the tesla nest.
      expect((u.order as { cy: number }).cy).toBeLessThan(25);
    }
  });

  it('retreat threshold follows retreatPermille from AiTuning', () => {
    // A MOVE command produces a path, not a standing order — check movement.
    const hurtTankMoves = (retreatPermille?: number): boolean => {
      const state = arena();
      if (retreatPermille !== undefined) {
        state.players[1]!.aiTuning = { retreatPermille };
      }
      const tank = spawnUnit(state, 'TANK', 1, 40, 40);
      tank.hp = (unitRule('TANK').maxHp / 2) | 0; // 50 %
      tick(state);
      return tank.path !== null;
    };
    // 600 ‰ pulls a half-health tank home; the default 300 ‰ leaves it alone.
    expect(hurtTankMoves(600)).toBe(true);
    expect(hurtTankMoves()).toBe(false);
  });

  it('AI_ATTACK_NOW marker forces a wave even when the score says no', () => {
    const run = (forced: boolean): number => {
      const state = arena();
      state.players[1]!.aiTuning = { firstAttackTick: 0, attackStrength: 2 };
      if (forced) state.players[1]!.aiLastAttackTick = -1000000;
      spawnUnit(state, 'RIFLEMAN', 1, 48, 28);
      spawnUnit(state, 'RIFLEMAN', 1, 49, 28);
      // Overwhelming enemy army far away: the utility score is deeply negative.
      for (let i = 0; i < 10; i++) spawnUnit(state, 'TANK', 0, 8 + (i % 5), 8 + ((i / 5) | 0));
      state.tick = 1000; // past the attack cooldown either way
      runTicks(state, 15);
      return state.players[1]!.aiLastAttackTick;
    };
    expect(run(true)).toBeGreaterThanOrEqual(1000);
    expect(run(false)).toBe(0);
  });

  it('a hard-AI game stays bit-identical across runs (utility layer incl.)', () => {
    const play = (): string => {
      const state = createGame(4242, { ai: true, aiDifficulty: 'hard' });
      runTicks(state, 1500);
      return hashState(state);
    };
    expect(play()).toBe(play());
  }, 30000);
});
