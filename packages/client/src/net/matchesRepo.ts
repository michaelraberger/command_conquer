import { getSupabase } from './supabase.js';

/**
 * Registrierung von Multiplayer-Partien in `public.matches` — die Wahrheit,
 * gegen die Realtime-Authorization und Clients prüfen:
 *
 * - Der Host legt die Zeile BEI LOBBY-ERSTELLUNG an (bevor der Code irgendwo
 *   geteilt wird) — niemand kann einen fremden Code vorab besetzen, und RLS
 *   erzwingt host = auth.uid(): das Host-Feld ist nicht fälschbar.
 * - Beim Start schreibt der Host die Teilnehmerliste; die Policy auf
 *   realtime.messages lässt NUR diese Nutzer in den Spielkanal.
 * - Joiner verifizieren den Start-Broadcast gegen die Zeile statt dem
 *   Payload zu glauben.
 */

export interface MatchRow {
  host: string;
  participants: string[];
}

/** Host: reserviert den Code. False bei Kollision/Konflikt (neuen Code ziehen). */
export async function registerLobbyCode(code: string, hostId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase
    .from('matches')
    .insert({ code, host: hostId, participants: [hostId] });
  return error === null;
}

/** Host: friert die Teilnehmer beim Start ein (Realtime-Policy liest sie). */
export async function setMatchParticipants(code: string, ids: string[]): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { error } = await supabase.from('matches').update({ participants: ids }).eq('code', code);
  return error === null;
}

/** Teilnehmer: liest die (authentische) Zeile zur Start-Verifikation. */
export async function getMatch(code: string): Promise<MatchRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('matches')
    .select('host, participants')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return null;
  return { host: data.host as string, participants: (data.participants as string[]) ?? [] };
}

/** Host: räumt eine nie gestartete Lobby wieder ab. Best-effort. */
export async function deleteMatch(code: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.from('matches').delete().eq('code', code);
}
