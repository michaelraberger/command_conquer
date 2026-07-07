# @cac/sim – deterministischer Spielkern

Dieses Paket ist die gemeinsame Wahrheit für Singleplayer, Replays und
späteren Lockstep-Multiplayer. **Jede** Abweichung von diesen Regeln ist ein
potenzieller Desync und damit ein Bug:

1. **Null Dependencies.** Kein DOM, kein PixiJS, kein `window`, `document`,
   `performance`, `Date`, `setTimeout`. Der Kern muss headless in Node laufen.
2. **Fester Tick.** Die Sim läuft mit 15 Ticks/Sekunde (`tick()`), das
   Rendering interpoliert client-seitig. Sim-Code kennt keine Echtzeit.
3. **Commands statt Mutation.** Der einzige Weg, den Spielzustand von außen zu
   ändern, sind `Command`-Objekte über `tick(state, commands)`. Niemals direkt
   an `GameState` schreiben (außer in Systemen innerhalb des Ticks).
4. **Nur Integer-Arithmetik.** Positionen/Geschwindigkeiten sind Festkomma-
   Integer (256 Sub-Cells pro Zelle, siehe `fixed.ts`). Kein `Math.sin/cos/
   sqrt/atan2/random` – stattdessen `isqrt`, quadrierte Distanzen und die
   16-Richtungs-Lookup-Tabelle `FACING_VECTORS`.
5. **Geseedeter Zufall.** Ausschließlich `rng.ts` (mulberry32) mit Zustand in
   `GameState.rngState`. Client-Effekte benutzen einen eigenen RNG.
6. **Deterministische Iteration.** Entities liegen in Arrays, sortiert nach
   aufsteigender ID; Systeme laufen in fester Reihenfolge (siehe `tick.ts`).
   Nie über Objekt-Keys oder Sets/Maps iterieren, deren Ordnung zählt.
7. **GameState ist reine Daten.** POJOs + TypedArrays, keine Klassen, keine
   Funktionen im State. `serialize`/`deserialize`/`hashState` müssen immer
   funktionieren.

Der Test `test/purity.test.ts` erzwingt Regel 1/4/5 mechanisch, `test/
determinism.test.ts` prüft Hash-Gleichheit zweier identisch gefütterter Sims.
