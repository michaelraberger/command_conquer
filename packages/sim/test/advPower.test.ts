import { describe, expect, it } from 'vitest';
import {
  buildingRule,
  satisfiesRequirement,
  startProduction,
  constructBuilding,
  createGame,
  hashState,
  powerBalance,
  tick,
  type Command,
} from '../src/index.js';

const upgrade = (id: number): Command => ({ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: id });

describe('Fortschr. Kraftwerk (Advanced Power Plant)', () => {
  const ADV_TIME = buildingRule('ADVPOWER').buildTime;

  it('upgrades in place — timed — and then doubles the base plant output', () => {
    const state = createGame(7);
    const plant = constructBuilding(state, 'POWER', 0, 20, 20);
    state.players[0]!.credits = 1000;
    const producedBefore = powerBalance(state, 0).produced;
    const cx = plant.cx, cy = plant.cy;

    tick(state, [upgrade(plant.id)]);
    // Paid upfront; the conversion takes buildTime ticks. Until then it's still
    // a plain Kraftwerk and produces the base +150.
    expect(state.players[0]!.credits).toBe(1000 - (buildingRule('POWER').upgradeCost ?? 0));
    expect(state.buildings.find((b) => b.id === plant.id)!.type).toBe('POWER');
    expect(powerBalance(state, 0).produced).toBe(producedBefore);

    for (let t = 0; t < ADV_TIME; t++) tick(state, []);
    const now = state.buildings.find((b) => b.id === plant.id)!;
    expect(now.type).toBe('ADVPOWER');
    expect(now.cx).toBe(cx); // same 2x2 footprint / position
    expect(now.cy).toBe(cy);
    expect(now.hp).toBe(buildingRule('ADVPOWER').maxHp);

    // Output doubled: the advanced plant adds base_power more than before.
    const gain = powerBalance(state, 0).produced - producedBefore;
    expect(gain).toBe(buildingRule('POWER').power); // +150 → +300 total
    expect(buildingRule('ADVPOWER').power).toBe(2 * buildingRule('POWER').power);
  });

  it('is upgrade-only (not in the build menu) and shares the plant footprint', () => {
    const adv = buildingRule('ADVPOWER');
    const base = buildingRule('POWER');
    expect(adv.buildable).toBe(false);
    expect(base.upgradeTo).toBe('ADVPOWER');
    expect(adv.width).toBe(base.width);
    expect(adv.height).toBe(base.height);
  });

  it('stays deterministic and serialize-stable across the timed upgrade', () => {
    const run = () => {
      const state = createGame(3);
      const plant = constructBuilding(state, 'POWER', 0, 20, 20);
      state.players[0]!.credits = 1000;
      tick(state, [upgrade(plant.id)]);
      for (let t = 0; t < ADV_TIME + 40; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
it('still counts as a Kraftwerk for prerequisites after the upgrade', () => {
    const state = createGame(11);
    const plant = constructBuilding(state, 'POWER', 0, 20, 20);
    state.players[0]!.credits = 5000;
    tick(state, [upgrade(plant.id)]);
    for (let t = 0; t < ADV_TIME + 1; t++) tick(state, []);
    expect(state.buildings.some((b) => b.owner === 0 && b.type === 'POWER')).toBe(false);
    expect(satisfiesRequirement('ADVPOWER', 'POWER')).toBe(true);
    expect(satisfiesRequirement('POWER', 'ADVPOWER')).toBe(false); // nur aufwaerts
    expect(satisfiesRequirement('AGT', 'GUARDTOWER')).toBe(true);

    // Ohne den Fix waere die Raffinerie hier gesperrt (requires: ['POWER']).
    startProduction(state, 0, 'REFINERY');
    expect(state.players[0]!.queues.building.item).toBe('REFINERY');
  });
});
