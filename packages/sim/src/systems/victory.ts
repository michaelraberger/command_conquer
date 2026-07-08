import type { GameState } from '../state.js';

/**
 * A player stays in the game while they hold a real (non-wall) building OR an
 * undeployed MCV (Baufahrzeug) — so losing your base isn't an instant loss if
 * you kept a construction vehicle to rebuild. The last surviving TEAM wins; the
 * winner id is a member of that team (the human's id when the human team wins,
 * so the client shows SIEG only then). The winner field freezes the sim.
 */
export function victorySystem(state: GameState): void {
  if (state.winner !== -1) return;
  const alive = (id: number): boolean =>
    state.buildings.some((b) => b.owner === id && b.type !== 'WALL') ||
    // An MCV keeps you alive — including one riding inside a transport (the
    // classic island move: ferry your MCV to a new island as the base falls).
    state.units.some(
      (u) =>
        (u.owner === id && u.type === 'MCV') ||
        u.passengers.some((p) => p.owner === id && p.type === 'MCV'),
    );
  // Team -> representative (lowest) player id still alive.
  const aliveTeams = new Map<number, number>();
  for (const p of state.players) {
    if (!alive(p.id)) continue;
    const rep = aliveTeams.get(p.team);
    if (rep === undefined || p.id < rep) aliveTeams.set(p.team, p.id);
  }
  if (aliveTeams.size === 1) state.winner = [...aliveTeams.values()][0]!;
}
