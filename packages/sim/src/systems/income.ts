import { buildingRule } from '../rules.js';
import type { GameState } from '../state.js';

/** 15 ticks = 1 second (kept local — tick.ts imports the systems, not vice
 *  versa, so importing TICKS_PER_SECOND from there would be circular). */
const INCOME_INTERVAL_TICKS = 15;

/**
 * Passive building income (Erz-Bohrturm): every second, each building with an
 * `income` rule pays its owner. Deliberately NOT capped by storage — like the
 * starting credits, the drip keeps flowing even when silos are full. Neutral
 * (owner -1) towers pay nobody.
 */
export function incomeSystem(state: GameState): void {
  if (state.tick === 0 || state.tick % INCOME_INTERVAL_TICKS !== 0) return;
  for (const building of state.buildings) {
    const income = buildingRule(building.type).income ?? 0;
    if (income <= 0 || building.owner < 0) continue;
    const player = state.players[building.owner];
    if (player) {
      player.credits += income;
      player.stats.creditsHarvested += income;
    }
  }
}
