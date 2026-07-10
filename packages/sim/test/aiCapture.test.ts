import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_OWNER,
  constructBuilding,
  createGame,
  emptyCustomMap,
  tick,
} from '../src/index.js';

describe('KI erobert Erz-Bohrtürme', () => {
  it('trains an engineer and captures the neutral tower', () => {
    // Custom map: neutral Bohrturm between the bases, closer to the AI spawn
    // (39,39). The AI gets a barracks and cash so training can start at once.
    const map = emptyCustomMap(48, 48, 'KI-Bohrturm');
    map.neutralBuildings = [{ type: 'ERZ_BOHRTURM', cx: 30, cy: 32 }];
    const state = createGame(7, { ai: true, aiDifficulty: 'normal', customMap: map });
    const ai = state.players[1]!;
    ai.credits = 4000;
    constructBuilding(state, 'BARRACKS', 1, 34, 36);
    constructBuilding(state, 'POWER', 1, 34, 40);

    const spike = state.buildings.find((b) => b.type === 'ERZ_BOHRTURM')!;
    expect(spike.owner).toBe(NEUTRAL_OWNER);

    let captured = false;
    for (let t = 0; t < 3000 && !captured; t++) {
      tick(state);
      captured = spike.owner === 1;
    }
    expect(captured).toBe(true);

    // The engineer was consumed on entry (the drip itself is covered
    // deterministically in capture.test.ts — here the AI keeps spending).
    expect(state.units.some((u) => u.owner === 1 && u.type === 'ENGINEER')).toBe(false);
  });
});
