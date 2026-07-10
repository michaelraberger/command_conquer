import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

/**
 * The shared Supabase client, or null when the env vars are missing — the game
 * then runs as a pure guest build and every cloud feature stays hidden.
 * Config comes from packages/client/.env.local (see supabase/README.md).
 */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
  const key = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;
  client = url && key ? createClient(url, key) : null;
  return client;
}

/** True when a Supabase project is configured (not necessarily logged in). */
export function cloudEnabled(): boolean {
  return getSupabase() !== null;
}
