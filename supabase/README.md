# Supabase-Setup (Login, Karten, Spielstände)

Die Cloud-Features (Login, eigene Karten, Spielstände) laufen über ein
Supabase-Projekt. Ohne Konfiguration startet das Spiel normal — nur die
Cloud-Funktionen sind dann ausgeblendet ("Gefecht gegen KI" braucht kein Login).

## Einrichtung

1. **Projekt anlegen**: [supabase.com](https://supabase.com) → New project
   (Region z. B. `eu-central-1`, Datenbank-Passwort merken).

2. **Schema einspielen**: Dashboard → *SQL Editor* → Inhalt von
   [`migrations/0001_init.sql`](migrations/0001_init.sql) einfügen und ausführen.
   (Alternativ mit der Supabase-CLI: `supabase db push`.)
   **Bestehende Projekte:** zusätzlich
   [`migrations/0002_map_sizes.sql`](migrations/0002_map_sizes.sql) ausführen —
   sonst schlägt das Cloud-Speichern von Karten größer als 96×96 fehl.

3. **E-Mail-Login konfigurieren**: Dashboard → *Authentication → Sign In / Up →
   Email*. Für die einfachste Variante **"Confirm email" deaktivieren**
   (Registrierung funktioniert dann sofort, ohne Bestätigungsmail).
   Bleibt sie aktiv, müssen sich neue Nutzer erst per Mail bestätigen.

4. **Keys eintragen**: Dashboard → *Project Settings → API* → `Project URL` und
   `anon public`-Key kopieren. Dann im Repo:

   ```bash
   cp packages/client/.env.example packages/client/.env.local
   ```

   und in `packages/client/.env.local` eintragen:

   ```
   VITE_SUPABASE_URL=https://<projekt-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key>
   ```

5. Dev-Server (neu) starten: `npm run dev` — auf dem Startbildschirm erscheint
   „Anmelden".

## Datenmodell

| Tabelle    | Inhalt                                                        | Zugriff (RLS)                              |
| ---------- | ------------------------------------------------------------- | ------------------------------------------ |
| `profiles` | Anzeigename je Nutzer (auto-angelegt beim Signup)             | lesen: alle · ändern: eigener              |
| `maps`     | Editor-Karten als `CustomMapData`-JSON                        | lesen: öffentlich oder eigener · schreiben: eigener |
| `saves`    | Spielstände (gzip+base64-`GameState` + Balance-Snapshot)      | nur eigener                                 |

Der `anon`-Key ist bewusst öffentlich — die Zugriffskontrolle übernehmen die
Row-Level-Security-Policies aus der Migration.

## Multiplayer-Härtung (Stand des Security-Reviews)

Der Client validiert seit dem Review jede eingehende Realtime-Nachricht
strukturell (`packages/client/src/net/validate.ts`): Schema, Wertebereiche,
Turn-Fenster, Längen-Limits, Resend-/Chat-Drosseln. Damit sind Remote-Freeze
und Speicher-DoS durch präparierte Payloads abgedeckt.

**Bewusst offen** bleibt die Absender-Authentizität: Broadcast-Payloads tragen
ihre Sitz-/Host-Angabe selbst, und ohne private Kanäle kann jeder Teilnehmer
des Kanals fremde Sitze behaupten (Frames unterdrücken, Drop/Abort senden).
Der Weg dahin, wenn öffentliche Partien geplant sind:

1. Im Supabase-Dashboard Realtime „private channels" aktivieren.
2. Policy auf `realtime.messages`, die Topics `cac:lobby:%` / `cac:game:%`
   nur für `authenticated` freigibt (später: nur für die registrierten
   Teilnehmer einer Partie, dazu braucht es eine `matches`-Tabelle).
3. Im Client `config: { private: true }` bei `supabase.channel(...)` setzen
   (lobby.ts, lockstep.ts) und die Sitz-Bindung über die dann verifizierbare
   Absender-Identität ziehen.

Bis dahin gilt: Der 6-stellige Join-Code (kryptographisch zufällig, ~1e9
Kombinationen) ist die Zugangskontrolle — für private Partien unter Bekannten
angemessen, für offene Lobbys nicht.
