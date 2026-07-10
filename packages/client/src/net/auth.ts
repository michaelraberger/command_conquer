import type { User } from '@supabase/supabase-js';
import { getSupabase } from './supabase.js';

/** Translates Supabase auth errors into user-facing German messages. */
export function translateAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid login credentials/i.test(msg)) return 'E-Mail oder Passwort falsch.';
  if (/already registered|already been registered/i.test(msg)) return 'Diese E-Mail ist bereits registriert.';
  if (/password should be at least/i.test(msg)) return 'Passwort zu kurz (mind. 6 Zeichen).';
  if (/valid email/i.test(msg)) return 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (/email not confirmed/i.test(msg)) return 'E-Mail noch nicht bestätigt — bitte Posteingang prüfen.';
  if (/rate limit|too many/i.test(msg)) return 'Zu viele Versuche — bitte kurz warten.';
  if (/fetch|network/i.test(msg)) return 'Netzwerkfehler — bitte erneut versuchen.';
  return `Anmeldung fehlgeschlagen: ${msg}`;
}

/**
 * Registers a new account. The username travels as signup metadata and is
 * turned into a `profiles` row by the DB trigger (see 0001_init.sql).
 * With "Confirm email" enabled in Supabase the session may be null until
 * the user clicks the confirmation link.
 */
export async function signUp(email: string, password: string, username: string): Promise<User> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud nicht konfiguriert.');
  const name = username.trim();
  if (name.length < 3 || name.length > 24) throw new Error('Benutzername muss 3–24 Zeichen haben.');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username: name } },
  });
  if (error) throw new Error(translateAuthError(error));
  if (!data.user) throw new Error('Registrierung fehlgeschlagen.');
  return data.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud nicht konfiguriert.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error));
  return data.user;
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

/** The logged-in user, or null (also null when the cloud is unconfigured). */
export async function currentUser(): Promise<User | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Display name: profile username, falling back to the signup metadata. */
export function displayName(user: User): string {
  const meta = user.user_metadata as Record<string, unknown>;
  return typeof meta['username'] === 'string' && meta['username'].length > 0
    ? meta['username']
    : (user.email ?? 'Spieler');
}

/** Fires immediately with the current user, then on every login/logout. */
export function onAuthChange(cb: (user: User | null) => void): void {
  const supabase = getSupabase();
  if (!supabase) {
    cb(null);
    return;
  }
  void currentUser().then(cb);
  supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}
