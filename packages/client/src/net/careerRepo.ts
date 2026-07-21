import type { GameState } from '@cac/sim';
import { statsToTotals, type CareerTotals } from '../ui/statsTable.js';
import { getSupabase } from './supabase.js';

/**
 * Career totals per account: one row in career_stats (see
 * supabase/migrations/0004_career_stats.sql) accumulating games, wins,
 * playtime and the summed match totals. Offline/logged-out: silent no-op —
 * the career block simply stays hidden.
 */

export interface CareerRow {
  games: number;
  wins: number;
  playtimeTicks: number;
  totals: CareerTotals;
}

const EMPTY_TOTALS: CareerTotals = {
  unitsKilled: 0,
  unitsLost: 0,
  unitsProduced: 0,
  buildingsKilled: 0,
  buildingsLost: 0,
  buildingsBuilt: 0,
  healingDone: 0,
  creditsHarvested: 0,
  cratesCollected: 0,
};

async function ownerId(): Promise<{ supabase: NonNullable<ReturnType<typeof getSupabase>>; owner: string } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const owner = data.session?.user.id;
  return owner ? { supabase, owner } : null;
}

export async function fetchCareer(): Promise<CareerRow | null> {
  const ctx = await ownerId();
  if (!ctx) return null;
  const { data, error } = await ctx.supabase
    .from('career_stats')
    .select('games, wins, playtime_ticks, totals')
    .eq('owner', ctx.owner)
    .maybeSingle();
  if (error) throw new Error(`Karriere laden fehlgeschlagen: ${error.message}`);
  if (!data) return null;
  const row = data as { games: number; wins: number; playtime_ticks: number; totals: Partial<CareerTotals> | null };
  return {
    games: row.games,
    wins: row.wins,
    playtimeTicks: row.playtime_ticks,
    totals: { ...EMPTY_TOTALS, ...(row.totals ?? {}) },
  };
}

/** Read-modify-write after a finished match. Errors stay on the console —
 *  a failed career update must never block the end screen. */
export async function recordGame(state: GameState, localPlayer: number, won: boolean): Promise<void> {
  try {
    const ctx = await ownerId();
    if (!ctx) return;
    const player = state.players[localPlayer];
    if (!player) return;
    const match = statsToTotals(player.stats);
    const prev = (await fetchCareer()) ?? { games: 0, wins: 0, playtimeTicks: 0, totals: EMPTY_TOTALS };
    const totals = { ...prev.totals };
    for (const key of Object.keys(match) as Array<keyof CareerTotals>) {
      totals[key] = (prev.totals[key] ?? 0) + match[key];
    }
    const { error } = await ctx.supabase.from('career_stats').upsert({
      owner: ctx.owner,
      games: prev.games + 1,
      wins: prev.wins + (won ? 1 : 0),
      playtime_ticks: prev.playtimeTicks + state.tick,
      totals,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.warn('Karriere-Update übersprungen:', err instanceof Error ? err.message : err);
  }
}
