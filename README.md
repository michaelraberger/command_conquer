# CAC – Browser-RTS im Stil von C&C: Red Alert

Echtzeitstrategie im Browser: Basisbau, Erz-Wirtschaft, Alliierte vs. Sowjets,
Tesla-Spulen, Mammutpanzer, aufrüstbare Mauern, Nebel des Krieges, KI-Gegner
in drei Schwierigkeitsgraden, Superwaffen (Atomrakete/Wettersturm), Replays
und 1-gegen-1-Multiplayer. Eigene prozedurale Grafiken (keine Original-Assets).

**Karten:** Beim Start wählbar – **Ödland** (klassisch, viel Land),
**Flusstal** (ein Fluss mit einer einzigen Landbrücke als Engpass) und
**Inselgruppe** (Heimatinseln im Ozean, ohne Bodenverbindung – hier zählen
Luft- und Marineeinheiten). Karten sind deterministisch aus Seed +
Kartentyp erzeugt; im Multiplayer bestimmt der Host die Karte, Replays
speichern sie mit.

**Marine:** Die **Werft** wird auf offenem Wasser im Bauradius der Basis
platziert und baut Schiffe (Tab „See"): **Kanonenboot** (beide Fraktionen),
**Zerstörer** (Alliierte, Deckgeschütz + Wasserbomben gegen U-Boote),
**U-Boot** (Sowjets, getaucht – nur von U-Boot-Jägern verwundbar, Torpedos
nur gegen Schiffe) und **Transportschiff** (bis zu 5 Bodeneinheiten:
Rechtsklick mit ausgewählten Einheiten auf das Schiff lädt, Taste **E**
entlädt an der Küste – so erobert man fremde Inseln).

## Starten

```bash
npm install
npm run dev        # Client unter http://localhost:5173
npm test           # Determinismus- und Sim-Tests
npm run test -w @cac/server   # Lockstep-Integrationstest
npm run typecheck
```

**Mehrspieler:** `npm run dev -w @cac/server` startet den Lockstep-Server
(ws://localhost:8787). Spieler 1 klickt „Mehrspieler-Partie eröffnen" und gibt
den Code weiter, Spieler 2 tritt mit dem Code bei.

## Balance anpassen

[packages/client/public/balance.json](packages/client/public/balance.json)
enthält alle Stellschrauben und wird beim Spielstart geladen — Zahlen ändern,
Seite neu laden, fertig (kein Rebuild nötig):

- `economy`: Startgeld, Abbaurate/-kapazität, Edelstein-Wert, Nachwachsen
- `units`: pro Einheit `cost`, `buildTime`, `maxHp`, `speed` (Subzellen/Tick,
  256 = 1 Zelle), `sight` sowie `damage`/`rangeCells`/`cooldown` der Waffe
- `buildings`: dasselbe plus `power` (+ erzeugt, − verbraucht)

Unbekannte Schlüssel und kaputte Werte werden ignoriert (Standard greift);
alle Werte werden auf Ganzzahlen gestutzt (Determinismus). Die Konfig ist
Teil der Spieloptionen: Replays speichern sie mit, im Multiplayer gilt die
Konfig des Hosts für beide Spieler. Fehlt die Datei, gelten die Standardwerte.

## Cheats (nur Solo)

**C** öffnet die Cheat-Konsole (Enter bestätigt, Esc schließt):

- `money` — +10.000 Credits
- `visible` — deckt die ganze Karte dauerhaft auf
- `power` — +300 Strom

Cheats laufen als normale Befehle durch die Sim: Replays spielen sie
originalgetreu ab. Im Multiplayer ist die Konsole deaktiviert.

## Steuerung

- Teamfarben nach Fraktion: **Alliierte blau, Sowjets rot** (Einheiten,
  Gebäude und Minimap)
- Linksklick/Ziehen: Auswählen (Einheiten oder eigenes Gebäude); ein
  ausgewähltes Gebäude zeigt seinen eigenen Bauradius (heller roter Kreis)
  UND den gesamten möglichen Baubereich aller eigenen Gebäude (blasser Kreis).
  Jedes eigene Gebäude (auch Mauern!) erweitert den Bauradius um 3 Zellen —
  nach außen bauen, um zu expandieren
- Rechtsklick: Bewegen / Angriff / Ernten / Sammelpunkt setzen
- Strg+Rechtsklick: Angriffsbewegung · Esc: Platzierung abbrechen
- WASD/Pfeile + Bildschirmrand: Kamera · `^`/Backquote: Debug-Overlay
- **P**: Pause (nur Einzelspieler/Replay; im Multiplayer deaktiviert)
- **U**: ausgewähltes Gebäude ausbauen (aktuell Mauern → nächste Stufe)
- **R**: gesamten Baubereich ein-/ausblenden (ohne Gebäude anklicken zu müssen)
- **H**: Kamera auf die eigene Basis zentrieren
- Angriffs-Warnung: Werden eigene Einheiten oder Gebäude beschädigt, erscheint
  ein Banner („Basis/Einheiten werden angegriffen") und ein roter Ping auf der
  Minimap zeigt, wo
- Mauern: Sidebar → „Mauer" (Sofortbau, mehrfach platzierbar); Mauer anklicken
  → „Ausbauen"-Button **oder U** für Stufe 2/3 (mehr HP, volle Reparatur)
- Verkaufen: Gebäude anklicken → „Verkaufen" erstattet 50 % der Investition
  (bei Mauern inklusive bezahlter Ausbaustufen)
- Werkstatt repariert eigene Fahrzeuge in der Nähe gegen Credits
- Reparaturfahrzeug (Waffenfabrik, beide Fraktionen): mobiles Gegenstück zur
  Werkstatt – auswählen, Rechtsklick auf ein beschädigtes eigenes Gebäude,
  es fährt hin und repariert es gegen Credits (Werkstatt = Fahrzeuge,
  Reparaturfahrzeug = Gebäude)
- Einheiten (eigenständige, selbst entworfene Designs, keine Original-Assets):
  - Boden: gemeinsam Raketensoldat (Anti-Panzer-Infanterie); Alliierte Späher
    (schnelle Aufklärung) + Leichter Panzer; Sowjets Flammenwerfer + Kampfhund
    (nur gegen Infanterie) + Tesla-Panzer. Waffeneffekte Flamme und Rakete.
  - Luft: Flugplatz baut Kampfhubschrauber (beide) und Kampfjet (Sowjets).
    Flugeinheiten fliegen geradlinig über jedes Gelände (mit Schatten, über
    dem Boden gerendert) und greifen Boden an. Nur Anti-Luft trifft sie:
    Flak-Panzer (mobil) und Flak-Turm (Basisverteidigung). Bodenwaffen können
    Flugzeuge nicht treffen.
  - See ist der geplante nächste Meilenstein.
- Mauern erweitern den Baubereich gar nicht – sie sind nur innerhalb des von
  echten Gebäuden geöffneten Bauradius platzierbar (kein „Sandsack-Marsch")
- Strom: Bei Defizit (`Verbrauch > Erzeugung`) fällt die Verteidigung aus,
  die Produktion halbiert sich und Superwaffen laden nicht mehr. Das wird
  jetzt deutlich angezeigt: Warnbanner „⚠ ZU WENIG STROM", pulsierender roter
  Strombalken und die betroffenen eigenen Verbraucher-Gebäude verdunkeln
  sichtbar. Abhilfe: Kraftwerk bauen
- Die KI greift frühestens nach 10 Minuten an (Schonfrist zum Aufbauen);
  verteidigt wird ihre Basis aber von Anfang an
- Ressourcen wachsen nach: Erz- und Edelsteinfelder bleiben dauerhaft
  „fruchtbar" und regenerieren sehr langsam (ein Schub pro Minute, ~2 h bis
  ein leergebaggertes Feld voll ist; überbaute Zellen wachsen nicht). Beim
  aktiven Abbau laufen Felder also weiter leer, erholen sich nur über sehr
  lange Partien. Edelsteine (violett, zwei Felder abseits der Startpositionen)
  sind pro Ladung doppelt so viel wert
- Superwaffe: Raketensilo (Sowjets) / Wetterkontrolle (Alliierte) bauen →
  lädt 2 Minuten (braucht Strom) → „Ziel wählen" → Klick auf die Karte.
  Flächenschaden mit Falloff, ignoriert Panzerung
- Replays: „Replay speichern" (Sidebar oder Endbildschirm) lädt die Partie
  als JSON herunter; „Replay ansehen …" im Startbildschirm spielt sie
  bit-identisch ab (Seed + Command-Log, dank deterministischer Sim)

## Struktur

- `packages/sim` – deterministischer Spielkern (null Dependencies, kein DOM).
  Die Determinismus-Regeln stehen in `packages/sim/README.md` – **vor jeder
  Änderung am Sim-Code lesen**. Auch die KI lebt hier (reiner Command-
  Generator → multiplayer-sicher).
- `packages/client` – PixiJS-Rendering, Input, UI, Netcode.
- `packages/server` – WebSocket-Lockstep-Relay (Lobby, Command-Broadcast,
  Desync-Erkennung per Hash-Vergleich).

## Meilensteine

- [x] M0 – Gerüst + Determinismus-Harness
- [x] M1 – Karte, Kamera, Auswahl, Bewegung
- [x] M2 – Kampf
- [x] M3 – Wirtschaft + Basisbau
- [x] M4 – Fraktionen, Fog of War, Tesla-Spule & Mammutpanzer, Mauern, Werkstatt
- [x] M5 – KI-Gegner, Sieg/Niederlage, Startbildschirm
- [x] M6 – Multiplayer (Lockstep-Relay)

## Ideen für später

- Luft-/Marineeinheiten, Garnisonen
- Richtige Sprite-Sheets hinter der `SpriteDef`-Schicht (CC0-Packs oder eigene)
- Karten-Editor, mehr Karten, größere Formate
- Golden-Replay-Regressionstests (gespeicherte Replays als Test-Fixtures)
