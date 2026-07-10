import { validateCustomMap, type CustomMapData } from '@cac/sim';
import { getSupabase } from './supabase.js';

/** Gallery row — `data` is only present when fetched via getMap(). */
export interface MapRow {
  id: string;
  owner: string;
  name: string;
  is_public: boolean;
  width: number;
  height: number;
  max_players: number;
  updated_at: string;
  /** Author username (embedded from profiles). */
  author: string;
  data?: CustomMapData;
}

const LIST_COLUMNS = 'id,owner,name,is_public,width,height,max_players,updated_at,profiles(username)';

interface RawRow {
  id: string;
  owner: string;
  name: string;
  is_public: boolean;
  width: number;
  height: number;
  max_players: number;
  updated_at: string;
  profiles: { username: string } | null;
  data?: CustomMapData;
}

const toRow = (raw: RawRow): MapRow => ({
  ...raw,
  author: raw.profiles?.username ?? 'Unbekannt',
});

function requireSupabase(): NonNullable<ReturnType<typeof getSupabase>> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud nicht konfiguriert.');
  return supabase;
}

/** Inserts (or, with `id`, updates) a map. Returns the row id. */
export async function saveMap(map: CustomMapData, id?: string): Promise<string> {
  const supabase = requireSupabase();
  const check = validateCustomMap(map);
  if (!check.ok) throw new Error(check.errors.join(' '));
  const { data: session } = await supabase.auth.getSession();
  const owner = session.session?.user.id;
  if (!owner) throw new Error('Anmeldung erforderlich.');

  const row = {
    owner,
    name: map.name,
    data: map,
    width: map.width,
    height: map.height,
    max_players: map.spawns.length,
    updated_at: new Date().toISOString(),
  };
  const query = id
    ? supabase.from('maps').update(row).eq('id', id).select('id').single()
    : supabase.from('maps').insert(row).select('id').single();
  const { data, error } = await query;
  if (error) throw new Error(`Speichern fehlgeschlagen: ${error.message}`);
  return (data as { id: string }).id;
}

export async function myMaps(): Promise<MapRow[]> {
  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const owner = session.session?.user.id;
  if (!owner) return [];
  const { data, error } = await supabase
    .from('maps')
    .select(LIST_COLUMNS)
    .eq('owner', owner)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Karten laden fehlgeschlagen: ${error.message}`);
  return (data as unknown as RawRow[]).map(toRow);
}

export async function publicMaps(limit = 50): Promise<MapRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('maps')
    .select(LIST_COLUMNS)
    .eq('is_public', true)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Karten laden fehlgeschlagen: ${error.message}`);
  return (data as unknown as RawRow[]).map(toRow);
}

/** Full map incl. layer data (for playing, editing and previews). */
export async function getMap(id: string): Promise<CustomMapData> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('maps').select('data').eq('id', id).single();
  if (error) throw new Error(`Karte laden fehlgeschlagen: ${error.message}`);
  return (data as { data: CustomMapData }).data;
}

export async function setPublic(id: string, isPublic: boolean): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('maps').update({ is_public: isPublic }).eq('id', id);
  if (error) throw new Error(`Änderung fehlgeschlagen: ${error.message}`);
}

export async function deleteMap(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('maps').delete().eq('id', id);
  if (error) throw new Error(`Löschen fehlgeschlagen: ${error.message}`);
}
