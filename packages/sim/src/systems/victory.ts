import type { GameState } from '../state.js';

/**
 * Classic C&C rule: a player without (non-wall) buildings is defeated. With
 * multiple opponents the last surviving TEAM wins — the winner id is a member
 * of that team (the human's id when the human team wins, so the client shows
 * SIEG only then). The winner field freezes the sim (see tick.ts).
 */
export function victorySystem(state: GameState): void {
  if (state.winner !== -1) return;
  // Team -> representative (lowest) player id still holding a real building.
  const aliveTeams = new Map<number, number>();
  for (const p of state.players) {
    if (!state.buildings.some((b) => b.owner === p.id && b.type !== 'WALL')) continue;
    const rep = aliveTeams.get(p.team);
    if (rep === undefined || p.id < rep) aliveTeams.set(p.team, p.id);
  }
  if (aliveTeams.size === 1) state.winner = [...aliveTeams.values()][0]!;
}
