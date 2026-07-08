# CAC – Browser-RTS im Stil von C&C: Red Alert

Echtzeitstrategie im Browser: Basisbau, Erz-Wirtschaft, Alliierte vs. Sowjets,
Tesla-Spulen, Mammutpanzer, aufrüstbare Mauern, Nebel des Krieges, KI-Gegner
in drei Schwierigkeitsgraden und Superwaffen (Atomrakete/Wettersturm).
Einzelspieler gegen die KI. Eigene prozedurale Grafiken (keine Original-Assets).

**Karten:** Beim Start wählbar – **Ödland** (klassisch, viel Land),
**Flusstal** (ein Fluss mit einer einzigen Landbrücke als Engpass) und
**Inselgruppe** (Heimatinseln im Ozean, ohne Bodenverbindung – hier zählen
Luft- und Marineeinheiten). Die Inselküsten sind von **Klippen** gesäumt; nur an
wenigen freien **Strandbuchten** kann ein Transportschiff anlanden – Landungen
gehen also nicht überall, sondern nur an den Buchten. Karten sind deterministisch
aus Seed + Kartentyp erzeugt. Die KI (normal/schwer) baut Luftwaffe (Flugplatz + Helis/Jets)
und auf Inselkarten eine Werft mit Kampfschiffen und einem Transportschiff –
sie landet über die Buchten an und greift so auch über Wasser an; die leichte
KI bleibt bodengebunden.

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
npm run typecheck
```

## Balance anpassen

[packages/client/public/balance.json](packages/client/public/balance.json)
enthält alle Stellschrauben und wird beim Spielstart geladen — Zahlen ändern,
Seite neu laden, fertig (kein Rebuild nötig):

- `economy`: Startgeld, Abbaurate/-kapazität, Edelstein-Wert, Nachwachsen
- `units`: pro Einheit `cost`, `buildTime`, `maxHp`, `speed` (Subzellen/Tick,
  256 = 1 Zelle), `sight` sowie `damage`/`rangeCells`/`cooldown` der Waffe
- `buildings`: dasselbe plus `power` (+ erzeugt, − verbraucht)
- `cheats`: eigene Codewörter für die Cheats (siehe unten)

Unbekannte Schlüssel und kaputte Werte werden ignoriert (Standard greift);
alle Werte werden auf Ganzzahlen gestutzt (Determinismus). Fehlt die Datei,
gelten die Standardwerte.

## Cheats (nur Solo)

**C** öffnet eine Konsole (Enter bestätigt, Esc schließt). Dort tippt man das
Codewort und drückt Enter. Die Codes sind **geheim** — nichts im Spiel verrät
sie — und werden in `balance.json` unter `cheats` frei benannt:

```json
"cheats": {
  "money":   "MONEY",   // +10.000 Credits
  "visible": "REVEAL",  // deckt die ganze Karte dauerhaft auf
  "power":   "POWER"    // +300 Strom
}
```

Links steht das (frei wählbare) Codewort, rechts die feste Cheat-Art
(`MONEY`/`REVEAL`/`POWER`). So kann jeder seine eigenen Wörter vergeben; das
Standard-Set oben gilt, wenn die Sektion fehlt. Cheats laufen als normale
Befehle durch die Sim.

## Steuerung

Alle Tastenkürzel stehen im **Shortcut-Menü**: „?"-Button oben links oder
**F1** öffnet es (Esc/Klick daneben schließt).

- Teamfarben nach Fraktion: **Alliierte blau, Sowjets rot** (Einheiten,
  Gebäude und Minimap)
- Linksklick/Ziehen: Auswählen (Einheiten oder eigenes Gebäude); ein
  ausgewähltes Gebäude zeigt seinen eigenen Bauradius (heller roter Kreis)
  UND den gesamten möglichen Baubereich aller eigenen Gebäude (blasser Kreis).
  Jedes eigene Gebäude (auch Mauern!) erweitert den Bauradius um 3 Zellen —
  nach außen bauen, um zu expandieren
- Rechtsklick: Bewegen / Angriff / Ernten / Sammelpunkt setzen
- Strg+Rechtsklick: Angriffsbewegung · Esc: Platzierung abbrechen
- WASD/Pfeile + Bildschirmrand: Kamera · **Leertaste halten + Maus ziehen**:
  Karte greifen und verschieben (Hand-Tool) · `^`/Backquote: Debug-Overlay
- **P**: Pause
- **U**: ausgewähltes Gebäude ausbauen (aktuell Mauern → nächste Stufe)
- **R**: gesamten Baubereich ein-/ausblenden (ohne Gebäude anklicken zu müssen)
- **H**: Kamera auf die eigene Basis zentrieren
- **Strg+1…9**: aktuelle Auswahl als Kontrollgruppe speichern · **1…9**: Gruppe
  wieder auswählen (Doppeltipp zentriert die Kamera auf die Gruppe). Angelegte
  Gruppen erscheinen als **schwebende Chips links am Rand** – anklickbar, mit
  Mehrfachauswahl (mehrere Chips = Vereinigung). Markierte Gruppen zeigen ihre
  **Nummer über jeder zugehörigen Einheit**; eine Karten-Auswahl hebt die
  Markierung wieder auf
- Angriffs-Warnung: Werden eigene Einheiten oder Gebäude beschädigt, erscheint
  ein Banner („Basis/Einheiten werden angegriffen") und ein roter Ping auf der
  Minimap zeigt, wo
- Mauern: Sidebar → „Mauer" (Sofortbau, mehrfach platzierbar); Mauer anklicken
  → „Ausbauen"-Button **oder U** für Stufe 2/3 (mehr HP, volle Reparatur)
- Verkaufen: Gebäude anklicken → „Verkaufen" erstattet 50 % der Investition
  (bei Mauern inklusive bezahlter Ausbaustufen)
- Auto-Verteidigung: Untätige Einheiten greifen einen Gegner in der Nähe
  (bis ~8 Zellen) selbstständig an und rücken dafür ein Stück vor – so
  verteidigen sie die Umgebung automatisch, statt danebenzustehen
- Werkstatt repariert eigene Fahrzeuge in der Nähe gegen Credits
- Reparaturfahrzeug (Waffenfabrik, beide Fraktionen): mobiles Gegenstück zur
  Werkstatt – auswählen, Rechtsklick auf ein beschädigtes eigenes Gebäude,
  es fährt hin und repariert es gegen Credits (Werkstatt = Fahrzeuge,
  Reparaturfahrzeug = Gebäude)
- Einheiten (eigenständige, selbst entworfene Designs, keine Original-Assets):
  - Boden: gemeinsam Raketensoldat (Anti-Panzer-Infanterie, trifft auch
    **Luftziele** – mobile Flugabwehr im C&C-Stil); Alliierte Späher
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

## Struktur

- `packages/sim` – deterministischer Spielkern (null Dependencies, kein DOM).
  Die Determinismus-Regeln stehen in `packages/sim/README.md` – **vor jeder
  Änderung am Sim-Code lesen**. Auch die KI lebt hier (reiner Command-
  Generator).
- `packages/client` – PixiJS-Rendering, Input, UI.

## Meilensteine

- [x] M0 – Gerüst + Determinismus-Harness
- [x] M1 – Karte, Kamera, Auswahl, Bewegung
- [x] M2 – Kampf
- [x] M3 – Wirtschaft + Basisbau
- [x] M4 – Fraktionen, Fog of War, Tesla-Spule & Mammutpanzer, Mauern, Werkstatt
- [x] M5 – KI-Gegner, Sieg/Niederlage, Startbildschirm

## Ideen für später

- Garnisonen, mehr Einheiten
- Richtige Sprite-Sheets hinter der `SpriteDef`-Schicht (CC0-Packs oder eigene)
- Karten-Editor, mehr Karten, größere Formate
