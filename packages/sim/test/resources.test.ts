import { describe, expect, it } from 'vitest';
import {
  GEM_VALUE,
  HARVEST_CAPACITY,
  REGROWTH_AMOUNT,
  REGROWTH_CAP,
  REGROWTH_INTERVAL,
  RESOURCE_GEMS,
  RESOURCE_NONE,
  cellIndex,
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  type GameState,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Advances just past the next regrowth pulse (tick 0 never pulses). */
function runToNextGrowth(state: GameState): void {
  runTicks(state, REGROWTH_INTERVAL - (state.tick % REGROWTH_INTERVAL) + 1);
}

describe('resource regrowth', () => {
  it('depleted fertile cells grow back, capped, never on barren ground', () => {
    const state = createGame(7);
    state.units = []; // no harvesters interfering
    const fertile = cellIndex(state, 23, 17); // ore patch cell
    const barren = cellIndex(state, 5, 60);
    expect(state.resourceKind[fertile]).not.toBe(RESOURCE_NONE);
    state.ore[fertile] = 0;
    state.ore[barren] = 0;

    runToNextGrowth(state);
    expect(state.ore[fertile]).toBe(REGROWTH_AMOUNT);
    expect(state.ore[barren]).toBe(0);

    // Grows in pulses and stops exactly at the cap.
    state.ore[fertile] = REGROWTH_CAP - 3;
    runToNextGrowth(state);
    expect(state.ore[fertile]).toBe(REGROWTH_CAP);
    runToNextGrowth(state);
    expect(state.ore[fertile]).toBe(REGROWTH_CAP);
  });

  it('nothing grows under buildings', () => {
    const state = createGame(7);
    state.units = [];
    // Pave a fertile gem cell (walls are 1x1 — construct directly).
    const gemCell = cellIndex(state, 20, 44);
    expect(state.resourceKind[gemCell]).toBe(RESOURCE_GEMS);
    state.ore[gemCell] = 0;
    constructBuilding(state, 'WALL', 0, 20, 44);

    runToNextGrowth(state);
    expect(state.ore[gemCell]).toBe(0);
  });
});

describe('gems', () => {
  it('fill the harvester at double value and cash out accordingly', () => {
    const state = createGame(7);
    state.units = [];
    state.occupancy.fill(0);
    const harvester = spawnUnit(state, 'HARVESTER', 0, 21, 44); // on the gem field
    const gemCell = cellIndex(state, 20, 44);
    const before = state.ore[gemCell]!;

    tick(state, [{ type: 'HARVEST', playerId: 0, unitIds: [harvester.id], cx: 20, cy: 44 }]);
    for (let i = 0; i < 120 && harvester.cargo < HARVEST_CAPACITY; i++) tick(state);

    expect(harvester.cargo).toBe(HARVEST_CAPACITY);
    // Only 250 units extracted for a 500-credit load (double value)…
    expect(before - state.ore[gemCell]!).toBe(HARVEST_CAPACITY / GEM_VALUE);

    // …and the refinery pays out the full 500.
    constructBuilding(state, 'REFINERY', 0, 17, 19);
    const credits = state.players[0]!.credits;
    for (let i = 0; i < 600 && harvester.cargo > 0; i++) tick(state);
    expect(state.players[0]!.credits).toBe(credits + HARVEST_CAPACITY);
  });
});
