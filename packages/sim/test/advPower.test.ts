import { describe, expect, it } from 'vitest';
import {
  buildingRule,
  constructBuilding,
  createGame,
  hashState,
  powerBalance,
  tick,
  type Command,
} from '../src/index.js';

const upgrade = (id: number): Command => ({ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: id });

describe('Fortschr. Kraftwerk (Advanced Power Plant)', () => {
  it('upgrades in place and doubles the base plant output', () => {
    const state = createGame(7);
    const plant = constructBuilding(state, 'POWER', 0, 20, 20);
    state.players[0]!.credits = 1000;
    const producedBefore = powerBalance(state, 0).produced;
    const cx = plant.cx, cy = plant.cy;

    tick(state, [upgrade(plant.id)]);
    const now = state.buildings.find((b) => b.id === plant.id)!;
    expect(now.type).toBe('ADVPOWER');
    expect(now.cx).toBe(cx); // same 2x2 footprint / position
    expect(now.cy).toBe(cy);
    expect(now.hp).toBe(buildingRule('ADVPOWER').maxHp);
    expect(state.players[0]!.credits).toBe(1000 - (buildingRule('POWER').upgradeCost ?? 0));

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

  it('stays deterministic and serialize-stable after the upgrade', () => {
    const run = () => {
      const state = createGame(3);
      const plant = constructBuilding(state, 'POWER', 0, 20, 20);
      state.players[0]!.credits = 1000;
      tick(state, [upgrade(plant.id)]);
      for (let t = 0; t < 40; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
