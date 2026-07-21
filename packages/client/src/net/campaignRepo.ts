import {
  getProgress,
  mergeProgress,
  replaceProgress,
  type ProgressData,
} from '../campaign/progress.js';
import { getSupabase } from './supabase.js';

/**
 * Cloud mirror of the campaign progress: one jsonb row per user
 * (campaign_progress, see supabase/migrations/0003_campaign.sql). The truth
 * is the per-mission UNION of local and cloud — a completion is never lost,
 * regardless of which device played it. Offline/logged-out: silent no-op.
 */

async function ownerId(): Promise<{ supabase: NonNullable<ReturnType<typeof getSupabase>>; owner: string } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const owner = data.session?.user.id;
  return owner ? { supabase, owner } : null;
}

async function fetchCloud(): Promise<ProgressData | null> {
  const ctx = await ownerId();
  if (!ctx) return null;
  const { data, error } = await ctx.supabase
    .from('campaign_progress')
    .select('data')
    .eq('owner', ctx.owner)
    .maybeSingle();
  if (error) throw new Error(`Kampagnenfortschritt laden fehlgeschlagen: ${error.message}`);
  return (data as { data: ProgressData } | null)?.data ?? null;
}

async function upsertCloud(data: ProgressData): Promise<void> {
  const ctx = await ownerId();
  if (!ctx) return;
  const { error } = await ctx.supabase
    .from('campaign_progress')
    .upsert({ owner: ctx.owner, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Kampagnenfortschritt speichern fehlgeschlagen: ${error.message}`);
}

/** Full sync: fetch → union-merge → write both sides. Errors stay silent for
 *  the caller (campaign UI works offline); they land on the console only. */
export async function syncProgress(): Promise<void> {
  try {
    const cloud = await fetchCloud();
    const merged = cloud ? mergeProgress(getProgress(), cloud) : getProgress();
    replaceProgress(merged);
    await upsertCloud(merged);
  } catch (err) {
    console.warn('Kampagnen-Sync übersprungen:', err instanceof Error ? err.message : err);
  }
}

/** Push-only mirror after a local completion (markCompleted calls this). */
export async function pushProgress(): Promise<void> {
  try {
    const cloud = await fetchCloud();
    const merged = cloud ? mergeProgress(getProgress(), cloud) : getProgress();
    await upsertCloud(merged);
  } catch (err) {
    console.warn('Kampagnen-Sync übersprungen:', err instanceof Error ? err.message : err);
  }
}
