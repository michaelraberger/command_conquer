import { describe, expect, it } from 'vitest';
import {
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type Building,
  type GameState,
  type Unit,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

const cellDist = (_state: GameState, u: Unit, b: Building): number =>
  Math.hypot(u.x - b.x, u.y - b.y) / 256;

/** Bare battlefield: both HQs plus a Flugplatz for player 0. */
function arena(seed = 7): { state: GameState; pad: Building } {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  constructBuilding(state, 'POWER', 0, 9, 5); // pad online is irrelevant, but tidy
  const pad = constructBuilding(state, 'HELIPAD', 0, 10, 10);
  return { state, pad };
}

describe('Kampfflugzeuge fliegen Einsätze vom Flugplatz', () => {
  it('a move order becomes an attack run: engage at the target, then fly home', () => {
    const { state, pad } = arena();
    const heli = spawnUnit(state, 'HELI', 0, 11, 11);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 28, 28);

    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [heli.id], cx: 28, cy: 28 }]);
    expect(heli.order).toEqual({ kind: 'ATTACK_MOVE', cx: 28, cy: 28 }); // kein Parken

    let died = false;
    for (let i = 0; i < 400 && !died; i++) {
      tick(state);
      died = !state.units.some((u) => u.id === victim.id);
    }
    expect(died).toBe(true); // attacked without an explicit attack order

    runTicks(state, 400);
    expect(cellDist(state, heli, pad)).toBeLessThan(3.5); // came home to the pad
  });

  it('an empty plane breaks off mid-attack and rearms at the pad', () => {
    const { state, pad } = arena(8);
    const heli = spawnUnit(state, 'HELI', 0, 11, 11);
    const bunker = constructBuilding(state, 'CONYARD', 1, 26, 26); // zu zäh für 8 Salven

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [heli.id], targetId: bunker.id }]);
    let empty = false;
    for (let i = 0; i < 600 && !empty; i++) {
      tick(state);
      empty = heli.ammo === 0;
    }
    expect(empty).toBe(true);
    expect(state.buildings.some((b) => b.id === bunker.id)).toBe(true); // steht noch

    // Breaks off, flies home and fills back up to full racks.
    let full = false;
    for (let i = 0; i < 600 && !full; i++) {
      tick(state);
      full = heli.ammo === unitRule('HELI').ammo;
    }
    expect(full).toBe(true);
    expect(cellDist(state, heli, pad)).toBeLessThan(3.5);
    expect(heli.order).toBeNull(); // der Angriffsbefehl wurde abgebrochen
  });

  it('without a Flugplatz the plane holds at the base and cannot rearm', () => {
    const { state, pad } = arena(9);
    const heli = spawnUnit(state, 'HELI', 0, 11, 11);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 28, 28);
    // Flugplatz fällt weg: kein Nachladen mehr möglich.
    state.buildings = state.buildings.filter((b) => b.id !== pad.id);
    for (let y = pad.cy; y < pad.cy + 2; y++) {
      for (let x = pad.cx; x < pad.cx + 2; x++) {
        state.structures[y * state.mapWidth + x] = 0;
      }
    }

    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [heli.id], cx: 28, cy: 28 }]);
    for (let i = 0; i < 400; i++) tick(state);
    const spent = heli.ammo;
    expect(spent).toBeLessThan(unitRule('HELI').ammo!); // hat geschossen
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);

    runTicks(state, 400);
    const nearest = Math.min(
      ...state.buildings.filter((b) => b.owner === 0).map((b) => cellDist(state, heli, b)),
    );
    expect(nearest).toBeLessThan(3.5); // kreist über der Basis (nächstes Gebäude)
    expect(heli.ammo).toBe(spent); // ohne Flugplatz kein Nachladen
  });

  it('the Transporthubschrauber still flies and parks freely', () => {
    const { state } = arena(10);
    const lift = spawnUnit(state, 'AIRLIFT', 0, 11, 11);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [lift.id], cx: 40, cy: 12 }]);
    for (let i = 0; i < 400 && lift.path; i++) tick(state);
    runTicks(state, 60); // bleibt stehen — kein Heimflug
    const cx = Math.trunc(lift.x / 256);
    const cy = Math.trunc(lift.y / 256);
    expect(Math.abs(cx - 40)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - 12)).toBeLessThanOrEqual(1);
  });
});
