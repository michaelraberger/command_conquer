import { serialize, type BalanceConfig, type GameState } from '@cac/sim';
import { gzipToBase64 } from './gzip.js';
import { getSupabase } from './supabase.js';

export interface SaveRow {
  id: string;
  name: string;
  tick: number;
  map_label: string | null;
  balance: BalanceConfig | null;
  created_at: string;
}

function requireSupabase(): NonNullable<ReturnType<typeof getSupabase>> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud nicht konfiguriert.');
  return supabase;
}

/** Serializes, compresses and uploads the running game. */
export async function saveGame(
  name: string,
  state: GameState,
  balance: BalanceConfig | undefined,
  mapLabel: string | undefined,
): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const owner = session.session?.user.id;
  if (!owner) throw new Error('Anmeldung erforderlich.');

  const data = await gzipToBase64(serialize(state));
  const { error } = await supabase.from('saves').insert({
    owner,
    name: name.trim() || 'Spielstand',
    tick: state.tick,
    map_label: mapLabel ?? null,
    balance: balance ?? null,
    data,
  });
  if (error) {
    if (/octet_length|check constraint/i.test(error.message)) throw new Error('Spielstand zu groß.');
    throw new Error(`Speichern fehlgeschlagen: ${error.message}`);
  }
}

/** Overwrites an existing save in place (same id, fresh snapshot + timestamp). */
export async function overwriteSave(
  id: string,
  name: string,
  state: GameState,
  balance: BalanceConfig | undefined,
  mapLabel: string | undefined,
): Promise<void> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) throw new Error('Anmeldung erforderlich.');

  const data = await gzipToBase64(serialize(state));
  const { error } = await supabase
    .from('saves')
    .update({
      name: name.trim() || 'Spielstand',
      tick: state.tick,
      map_label: mapLabel ?? null,
      balance: balance ?? null,
      data,
      // Refresh the timestamp so the list keeps sorting by "last saved".
      created_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    if (/octet_length|check constraint/i.test(error.message)) throw new Error('Spielstand zu groß.');
    throw new Error(`Überschreiben fehlgeschlagen: ${error.message}`);
  }
}

export async function listSaves(): Promise<SaveRow[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return [];
  const { data, error } = await supabase
    .from('saves')
    .select('id,name,tick,map_label,balance,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Spielstände laden fehlgeschlagen: ${error.message}`);
  return data as SaveRow[];
}

/** The compressed state blob of one save (still gzip+base64-encoded). */
export async function loadSaveData(id: string): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('saves').select('data').eq('id', id).single();
  if (error) throw new Error(`Spielstand laden fehlgeschlagen: ${error.message}`);
  return (data as { data: string }).data;
}

export async function deleteSave(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('saves').delete().eq('id', id);
  if (error) throw new Error(`Löschen fehlgeschlagen: ${error.message}`);
}
