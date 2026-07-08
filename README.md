# CAC – Browser-RTS im Stil von C&C: Red Alert

Echtzeitstrategie im Browser: Basisbau, Erz-Wirtschaft, Alliierte vs. Sowjets,
Tesla-Spulen, Mammutpanzer, aufrüstbare Mauern, Nebel des Krieges, KI-Gegner
in drei Schwierigkeitsgraden und Superwaffen (Atomrakete/Wettersturm).
Einzelspieler gegen **1–5 KI-Gegner** (im Startbildschirm wählbar); die Gegner
bilden ein Team und konzentrieren sich gemeinsam auf dich. Jede Seite hat eine
eigene Farbe (du in deiner Fraktionsfarbe, die KIs in klar unterscheidbaren
Tönen). Eigene prozedurale Grafiken (keine Original-Assets).

**Karten:** Beim Start wählbar – **Ödland** (klassisch, viel Land),
**Flusstal** (ein Fluss mit einer einzigen Landbrücke als Engpass) und
**Inselgruppe** (Heimatinseln im Ozean, ohne Bodenverbindung – hier zählen
Luft- und Marineeinheiten). Die Inselküsten sind von **Klippen** gesäumt; nur an
wenigen freien **Strandbuchten** kann ein Transportschiff anlanden – Landungen
gehen also nicht überall, sondern nur an den Buchten. Karten sind deterministisch
aus Seed + Kartentyp erzeugt. Die **Kartengröße** ist im Startbildschirm wählbar
(**Klein 48²**, **Normal 64²**, **Groß 96²**); Startpositionen, Ressourcen und
Inseln skalieren mit. Der Startbildschirm zeigt die gewählte Karte als
großflächig **geblurrten Hintergrund** (inkl. der farbigen Basen je nach
Gegnerzahl und der gewählten Größe) – so sieht man vorab, was einen erwartet. **Jede** KI-Stufe baut Luftwaffe (Flugplatz +
Helis/Jets) und auf Inselkarten eine Werft mit Kampfschiffen und einem
Transportschiff – sie landet über die Buchten an und greift so auch über Wasser
an. Auf Inseln rücken Flugplatz und Werft im Bauplan nach vorne (gleich nach der
Fabrik), damit die KI früh übersetzen kann. Die leichte KI hält kleinere Armeen
und weniger Luft/Marine als normal/schwer – so bleibt es auf jeder Karte ein
Kampf auf Augenhöhe, aber die Stufe macht weiterhin einen Unterschied.

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

Beim ersten Spielstart läuft automatisch eine **Kurzeinführung** (überspringbar,
jederzeit über „?" → „Kurzeinführung starten" erneut aufrufbar). Alle
Tastenkürzel stehen im **Shortcut-Menü**: „?"-Button oben links oder **F1**
öffnet es (Esc/Klick daneben schließt).

- Teamfarben nach Fraktion: **Alliierte blau, Sowjets rot**. Einheiten **und
  Gebäude** haben einen **neutralen, detaillierten Körper**; die Fraktion zeigt
  sich nur als **farbiger Akzent** (Turmluke/Streifen bzw. Helm bei Einheiten,
  Dach-Diamant bei Gebäuden) – so sind Typen an der Form und Fraktionen an der
  Farbe klar unterscheidbar. Die Minimap bleibt vollflächig teamgefärbt
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
  Werkstatt – auswählen, dann Rechtsklick auf ein beschädigtes eigenes
  **Gebäude oder eine eigene Einheit** (Fahrzeuge, Infanterie …); es fährt hin
  und repariert gegen Credits. Die Werkstatt (Gebäude) repariert weiterhin
  Fahrzeuge in ihrem Umkreis
- Einheiten (eigenständige, selbst entworfene Designs, keine Original-Assets):
  - Boden: gemeinsam Raketensoldat (Anti-Panzer-Infanterie, trifft auch
    **Luftziele** – mobile Flugabwehr im C&C-Stil); Alliierte Späher
    (schnelle Aufklärung) + Leichter Panzer; Sowjets Flammenwerfer + Kampfhund
    (nur gegen Infanterie) + Tesla-Panzer. Waffeneffekte Flamme und Rakete.
  - Luft: Flugplatz baut Kampfhubschrauber (beide), Kampfjet (Sowjets) und
    **Transporthubschrauber** (Alliierte, unbewaffnet): lädt bis zu 5
    Bodeneinheiten (Rechtsklick mit ausgewählten Einheiten auf den Transporter)
    und fliegt sie über **jedes** Gelände – auch über Wasser oder hinter die
    feindlichen Linien. Taste **E** setzt die Fracht an Land ab (überall auf
    Land, nicht nur an Küsten), ideal um eine Insel oder Basis direkt zu
    stürmen. Flugeinheiten fliegen geradlinig (mit Schatten, über dem Boden
    gerendert). Nur Anti-Luft trifft sie: Flak-Panzer (mobil) und Flak-Turm
    (Basisverteidigung) – der unbewaffnete Transporter braucht also eine freie
    Anflugschneise oder Begleitschutz. Bodenwaffen können Flugzeuge nicht
    treffen.
  - See ist der geplante nächste Meilenstein.
- Mauern erweitern den Baubereich gar nicht – sie sind nur innerhalb des von
  echten Gebäuden geöffneten Bauradius platzierbar (kein „Sandsack-Marsch")
- Strom: Bei Defizit (`Verbrauch > Erzeugung`) fällt die Verteidigung aus,
  die Produktion halbiert sich und Superwaffen laden nicht mehr. Das wird
  jetzt deutlich angezeigt: Warnbanner „⚠ ZU WENIG STROM", pulsierender roter
  Strombalken und die betroffenen eigenen Verbraucher-Gebäude verdunkeln
  sichtbar. Abhilfe: Kraftwerk bauen
- Die KI greift frühestens nach 10 Minuten an (Schonfrist zum Aufbauen);
  verteidigt wird ihre Basis aber von Anfang an. Danach baut sie auf jeder
  Karte eine schlagkräftige Armee inkl. Luftwaffe – auf Inseln zusätzlich
  Marine + Transporter – und greift auch über Wasser an (alle Stufen)
- **Längere Partien**: Die KI **raidet** statt sofort zu vernichten – sie
  schickt nur einen Teil ihrer Armee gegen deine **Wirtschaft/Produktion**
  (Sammler, Raffinerie, Fabrik), hält eine Basisreserve, zieht beschädigte
  Einheiten zurück und geht erst auf den **letzten Bauhof** los, wenn sie klar
  überlegen oder das Spiel sehr spät ist. Erz wächst langsam nach (mit dem
  Lager-Cap bremst das Horten), sodass Kartenkontrolle zählt
- **Forschung (Techzentrum)**: Fortgeschrittene Einheiten/Gebäude (Mammut,
  Artillerie, Luftwaffe/Flugplatz, Marine/Werft, Flak, Werkstatt/Reparatur,
  Tesla, Superwaffen, Spion) sind **erst nach Forschung** baubar. Bau ein
  **Techzentrum**, wähl dort eine Forschung (immer nur eine gleichzeitig; die
  Kosten laufen über die Forschungszeit ab). Gesperrte Bau-Kacheln zeigen
  „erforschen: …". **Forschungszeit steigt mit dem Fortschritt** (~6 Min bis
  ~15 Min) und ist pro Tech in `balance.json` unter `research` einstellbar
- **Baufahrzeug (MCV)**: mobiles Baufahrzeug (Waffenfabrik). Auswählen und
  **Entfalten (Taste D** oder Button im Info-Panel**)** baut daraus einen neuen
  Bauhof, wenn die 3×3-Fläche frei ist. Solange du ein MCV besitzt, bist du
  **nicht sofort raus**, wenn deine Basis fällt – du kannst dich zurückkämpfen
- Erz-Lager ist **begrenzt**: Die Gesamtkapazität ist die Summe der Lager
  der eigenen Gebäude – **Bauhof 2000**, **Raffinerie 2000**, **Erzsilo 1200**
  (alle über `balance.json` einstellbar). Über dem Limit geerntetes Erz
  **verpufft** – für mehr Vorrat Silos bauen. Die Credits-Anzeige zeigt
  `Konto / Kapazität`. Wird ein Lager-Gebäude **zerstört** (oder von einem
  Spion **infiltriert**), geht der dort gelagerte Anteil verloren
- **Spion** (Infanterie, nur Alliierte, Kaserne): schleicht sich in eine
  **gegnerische Raffinerie oder ein Silo** (Rechtsklick darauf), stiehlt das
  dort gelagerte Erz auf das eigene Konto (bis zur eigenen Kapazität) und wird
  dabei verbraucht – das Gebäude bleibt stehen. Unbewaffnet, braucht also
  Deckung, um hineinzukommen
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
