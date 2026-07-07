import { aiSystem } from './ai/controller.js';
import { applyCommands, type Command } from './commands.js';
import type { GameState } from './state.js';
import { combatSystem } from './systems/combat.js';
import { deathSystem } from './systems/death.js';
import { defenseSystem } from './systems/defense.js';
import { fogSystem } from './systems/fog.js';
import { harvestSystem } from './systems/harvest.js';
import { movementSystem } from './systems/movement.js';
import { productionSystem } from './systems/production.js';
import { projectileSystem } from './systems/projectiles.js';
import { repairSystem } from './systems/repair.js';
import { repairVehicleSystem } from './systems/repairVehicle.js';
import { resourceGrowthSystem } from './systems/resources.js';
import { superweaponSystem } from './systems/superweapon.js';
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
  superweaponSystem(state);
  resourceGrowthSystem(state);
  harvestSystem(state);
  repairVehicleSystem(state);
  combatSystem(state);
  defenseSystem(state);
  movementSystem(state);
  projectileSystem(state);
  repairSystem(state);
  deathSystem(state);
  victorySystem(state);
  fogSystem(state);
  state.tick++;
}
