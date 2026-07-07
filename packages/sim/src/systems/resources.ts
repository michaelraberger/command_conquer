import { RESOURCE_NONE } from '../map.js';
import { REGROWTH_AMOUNT, REGROWTH_CAP, REGROWTH_INTERVAL } from '../rules.js';
import type { GameState } from '../state.js';

/**
 * Resource regrowth: fields stay permanently fertile (resourceKind), so ore
 * and gems slowly grow back after harvesting — up to REGROWTH_CAP, never
 * under buildings. Keeps long games economically alive.
 */
export function resourceGrowthSystem(state: GameState): void {
  if (state.tick === 0 || state.tick % REGROWTH_INTERVAL !== 0) return;
  for (let i = 0; i < state.ore.length; i++) {
    if (state.resourceKind[i] === RESOURCE_NONE) continue;
    if (state.structures[i] !== 0) continue; // paved over — nothing grows
    const amount = state.ore[i]!;
    if (amount >= REGROWTH_CAP) continue;
    const grown = amount + REGROWTH_AMOUNT;
    state.ore[i] = grown > REGROWTH_CAP ? REGROWTH_CAP : grown;
  }
}
