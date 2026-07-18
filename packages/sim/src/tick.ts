import { aiSystem } from './ai/controller.js';
import { applyCommands, type Command } from './commands.js';
import type { GameState } from './state.js';
import { airbaseSystem } from './systems/airbase.js';
import { combatSystem } from './systems/combat.js';
import { deathSystem } from './systems/death.js';
import { defenseReactionSystem } from './systems/defenseReaction.js';
import { defenseSystem } from './systems/defense.js';
import { captureSystem } from './systems/capture.js';
import { fogSystem } from './systems/fog.js';
import { harvestSystem } from './systems/harvest.js';
import { incomeSystem } from './systems/income.js';
import { movementSystem } from './systems/movement.js';
import { paradropSystem } from './systems/paradrop.js';
import { buildingUpgradeSystem, productionSystem, researchSystem } from './systems/production.js';
import { projectileSystem } from './systems/projectiles.js';
import { repairSystem } from './systems/repair.js';
import { repairVehicleSystem } from './systems/repairVehicle.js';
import { resourceGrowthSystem } from './systems/resources.js';
import { spySystem } from './systems/spy.js';
import { superweaponSystem } from './systems/superweapon.js';
import { transportSystem } from './systems/transport.js';
import { victorySystem } from './systems/victory.js';

export const TICKS_PER_SECOND = 15;
export const TICK_MS = 1000 / TICKS_PER_SECOND;

/**
 * Advances the sim by exactly one tick. System call order is FIXED and part
 * of the determinism contract — new systems get appended in their slot.
 */
export function tick(state: GameState, commands: Command[] = []): void {
  state.events = [];
  if (state.winner !== -1) {
    state.tick++;
    return; // game over — freeze the world
  }
  applyCommands(state, commands);
  aiSystem(state);
  productionSystem(state);
  buildingUpgradeSystem(state);
  researchSystem(state);
  superweaponSystem(state);
  resourceGrowthSystem(state);
  harvestSystem(state);
  incomeSystem(state);
  repairVehicleSystem(state);
  transportSystem(state);
  spySystem(state);
  captureSystem(state);
  combatSystem(state);
  defenseSystem(state);
  movementSystem(state);
  // Right after movement: flyAir nulls a paradrop plane's path exactly on
  // arrival, which is paradropSystem's drop/despawn signal.
  paradropSystem(state);
  // Combat aircraft that just went idle turn for home / rearm at the pad.
  airbaseSystem(state);
  projectileSystem(state);
  // After every damage source (combat, towers, projectiles): rally idle
  // defenders toward whoever just hit friendly units or buildings.
  defenseReactionSystem(state);
  repairSystem(state);
  deathSystem(state);
  victorySystem(state);
  fogSystem(state);
  state.tick++;
}
