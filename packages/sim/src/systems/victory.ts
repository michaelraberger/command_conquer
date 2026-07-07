import type { GameState } from '../state.js';

/**
 * Classic C&C rule: a player without buildings is defeated. The winner field
 * freezes the sim (see tick.ts).
 */
export function victorySystem(state: GameState): void {
  if (state.winner !== -1) return;
  // Walls don't keep you in the game (classic C&C rule).
  const hasBuildings = state.players.map((p) =>
    state.buildings.some((b) => b.owner === p.id && b.type !== 'WALL'),
  );
  if (hasBuildings[0] && !hasBuildings[1]) state.winner = 0;
  else if (!hasBuildings[0] && hasBuildings[1]) state.winner = 1;
}
