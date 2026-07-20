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
