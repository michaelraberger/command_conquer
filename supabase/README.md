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

## Multiplayer-Härtung

Zwei Schichten, beide aktiv:

1. **Struktur-Validierung im Client** (`packages/client/src/net/validate.ts`):
   Schema, Wertebereiche, Turn-Fenster, Längen-Limits, Resend-/Chat-Drosseln
   für jede eingehende Realtime-Nachricht.
2. **Private Realtime-Kanäle + Partien-Registry** (Migration
   `0006_private_channels.sql`, ab Client-Version dieser Migration Pflicht):
   - Lobby-Kanäle (`cac:lobby:<CODE>`) verlangen einen angemeldeten Nutzer;
     der geheime Code regelt weiterhin, wer die Lobby findet.
   - Der Host reserviert den Code bei Lobby-Erstellung in `public.matches`
     (RLS erzwingt `host = auth.uid()` — das Host-Feld ist authentisch).
   - Beim Start friert der Host die Teilnehmerliste ein; die Policy auf
     `realtime.messages` lässt NUR diese Nutzer in den Spielkanal
     (`cac:game:<CODE>`). Außenstehende sind damit komplett draußen, auch
     wenn sie den Code kennen.
   - Joiner verifizieren den Start-Broadcast gegen die `matches`-Zeile
     statt dem Payload zu glauben.

**Wichtig:** Ohne eingespielte Migration 0006 verweigert Realtime die
privaten Kanäle — Multiplayer zeigt dann eine entsprechende Fehlermeldung.

**Restrisiko (bewusst akzeptiert):** Innerhalb einer laufenden Partie können
sich registrierte Teilnehmer gegenseitig weiterhin nicht kryptographisch
zuordnen (Broadcast trägt keine verifizierte Absender-Identität) — ein
böswilliger *Mitspieler* könnte fremde Sitze stören. Das fängt der
Desync-Hash ab; echte Abhilfe bräuchte signierte Nachrichten oder einen
Relay-Server. `matches`-Zeilen sind wenige Bytes; alte Zeilen räumt der
Host beim Verlassen einer ungestarteten Lobby ab, gestartete bleiben als
Historie stehen.
