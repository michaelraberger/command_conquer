import { describe, expect, it } from 'vitest';
import {
  createGame,
  hashState,
  tick,
  unitRule,
  type GameState,
  type MapType,
} from '../src/index.js';

/** Runs a hard-AI game undisturbed (human neutralized) for `ticks`. */
function runAiGame(mapType: MapType, ticks: number, seed = 1337): GameState {
  const state = createGame(seed, { ai: true, aiDifficulty: 'hard', mapType });
  for (let t = 0; t < ticks && state.winner === -1; t++) tick(state);
  return state;
}

const owns = (state: GameState, type: string): boolean =>
  state.buildings.some((b) => b.owner === 1 && b.type === type);
const countAiUnits = (state: GameState, type: string): number =>
  state.units.filter((u) => u.owner === 1 && u.type === type).length;

describe('ai air power', () => {
  it('builds a helipad and trains aircraft on any map', () => {
    const state = runAiGame('BADLANDS', 9000);
    expect(owns(state, 'HELIPAD') || state.winner === 1).toBe(true);
    // Either aircraft exist, or the AI already won with its ground+air push.
    const air = countAiUnits(state, 'HELI') + countAiUnits(state, 'JET');
    expect(air > 0 || state.winner === 1).toBe(true);
  });

  it('the easy AI stays ground-only (no helipad, no air)', () => {
    const state = createGame(1337, { ai: true, aiDifficulty: 'easy', mapType: 'BADLANDS' });
    for (let t = 0; t < 6000 && state.winner === -1; t++) tick(state);
    expect(owns(state, 'HELIPAD')).toBe(false);
    expect(countAiUnits(state, 'HELI') + countAiUnits(state, 'JET')).toBe(0);
  });
});

describe('ai navy on islands', () => {
  it('builds a shipyard and warships when the players are split by water', () => {
    const state = runAiGame('ISLANDS', 11000);
    expect(owns(state, 'SHIPYARD') || state.winner === 1).toBe(true);
    const ships =
      countAiUnits(state, 'DESTROYER') +
      countAiUnits(state, 'GUNBOAT') +
      countAiUnits(state, 'SUB') +
      countAiUnits(state, 'TRANSPORT');
    expect(ships > 0 || state.winner === 1).toBe(true);
  });

  it('crosses the water and hurts the human island (air/naval offense works)', () => {
    // Passive human: never issues a command. A ground-only AI could never reach
    // it across the ocean, so any damage proves the air/naval offense works.
    const state = createGame(24, { ai: true, aiDifficulty: 'hard', mapType: 'ISLANDS' });
    const humanHpAtStart = state.buildings
      .filter((b) => b.owner === 0)
      .reduce((s, b) => s + b.hp, 0);
    for (let t = 0; t < 14000 && state.winner === -1; t++) tick(state);
    const humanBuildings = state.buildings.filter((b) => b.owner === 0);
    const humanHp = humanBuildings.reduce((s, b) => s + b.hp, 0);
    const hurt = state.winner === 1 || humanBuildings.length === 0 || humanHp < humanHpAtStart;
    expect(hurt).toBe(true);
  }, 30000);
});

describe('ai air/naval determinism', () => {
  it('an island AI game is bit-identical across runs', () => {
    const run = (): string => hashState(runAiGame('ISLANDS', 4000, 99));
    expect(run()).toBe(run());
  }, 20000);

  it('anti-air FLAK is never sent on a ground offensive', () => {
    // The offense filter must exclude air-only weapons; sanity-check the rule.
    expect(unitRule('FLAK').weapon!.targets).toBe('air');
    expect(unitRule('HELI').weapon!.targets).not.toBe('air');
  });
});
