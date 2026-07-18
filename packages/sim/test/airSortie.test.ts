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

/** Produce one jet at the (single) queued air slot and return it. */
function produceJet(state: GameState, playerId: number, item: 'JET' | 'STRIKEJET'): Unit {
  const before = new Set(state.units.map((u) => u.id));
  tick(state, [{ type: 'BUILD_START', playerId, item }]);
  for (let i = 0; i < 300 && state.units.every((u) => before.has(u.id)); i++) tick(state);
  const jet = state.units.find((u) => !before.has(u.id));
  expect(jet?.type).toBe(item);
  return jet!;
}

describe('Flugfeld: ein Jet pro Feld, feste Bindung', () => {
  /** Soviet player 0 with HQ, power, a helipad and one Flugfeld. */
  function jetArena(seed = 11): { state: GameState; field: Building; pad: Building } {
    const state = createGame(seed, { factions: ['SOVIETS', 'SOVIETS'] });
    state.units = [];
    state.buildings = [];
    state.occupancy.fill(0);
    state.structures.fill(0);
    constructBuilding(state, 'CONYARD', 0, 5, 5);
    constructBuilding(state, 'CONYARD', 1, 55, 55);
    constructBuilding(state, 'POWER', 0, 9, 5);
    const pad = constructBuilding(state, 'HELIPAD', 0, 10, 10);
    const field = constructBuilding(state, 'FLUGFELD', 0, 20, 10);
    state.players[0]!.credits = 50_000;
    return { state, field, pad };
  }

  it('a produced jet is bound to its Flugfeld and rearms only there', () => {
    const { state, field, pad } = jetArena();
    const jet = produceJet(state, 0, 'JET');
    expect(jet.homeId).toBe(field.id);

    // Empty the racks far away, near the HELIPAD side of the map.
    const bunker = constructBuilding(state, 'CONYARD', 1, 8, 20);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [jet.id], targetId: bunker.id }]);
    let empty = false;
    for (let i = 0; i < 600 && !empty; i++) {
      tick(state);
      empty = jet.ammo === 0;
    }
    expect(empty).toBe(true);

    // It flies home to ITS airfield (not the nearer helipad) and refills.
    let full = false;
    for (let i = 0; i < 900 && !full; i++) {
      tick(state);
      full = jet.ammo === unitRule('JET').ammo;
    }
    expect(full).toBe(true);
    expect(cellDist(state, jet, field)).toBeLessThan(3.5);
    expect(cellDist(state, jet, pad)).toBeGreaterThan(3.5);
  });

  it('one jet per Flugfeld: a second is refused until the first dies', () => {
    const { state } = jetArena(12);
    const jet = produceJet(state, 0, 'JET');

    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'JET' }]);
    expect(state.players[0]!.queues.air.item).toBeNull(); // field occupied

    jet.hp = 0;
    tick(state); // death sweep frees the field
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'JET' }]);
    expect(state.players[0]!.queues.air.item).toBe('JET');
  });

  it('a second Flugfeld hosts a second jet, each bound to its own field', () => {
    const { state, field } = jetArena(13);
    const field2 = constructBuilding(state, 'FLUGFELD', 0, 26, 10);
    const jet1 = produceJet(state, 0, 'JET');
    const jet2 = produceJet(state, 0, 'JET');
    expect(jet1.homeId).toBe(field.id);
    expect(jet2.homeId).toBe(field2.id);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'JET' }]);
    expect(state.players[0]!.queues.air.item).toBeNull(); // both fields taken
  });

  it('destroying the Flugfeld crashes its bound jet the same tick', () => {
    const { state, field } = jetArena(14);
    const jet = produceJet(state, 0, 'JET');
    field.hp = 0;
    tick(state);
    expect(state.units.some((u) => u.id === jet.id)).toBe(false);
    expect(state.buildings.some((b) => b.id === field.id)).toBe(false);
  });

  it('selling the Flugfeld also loses the jet (refund still paid)', () => {
    const { state, field } = jetArena(15);
    const jet = produceJet(state, 0, 'JET');
    const credits = state.players[0]!.credits;
    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: field.id }]);
    expect(state.players[0]!.credits).toBeGreaterThan(credits); // refund
    expect(state.units.some((u) => u.id === jet.id)).toBe(false);
  });

  it('a captured Flugfeld orphans the old jet and is free for the new owner', () => {
    const { state, field } = jetArena(16);
    const jet = produceJet(state, 0, 'JET');
    field.owner = 1; // as if an engineer captured it
    tick(state);
    // Old jet survives as an orphan; the field counts free for player 1.
    expect(state.units.some((u) => u.id === jet.id)).toBe(true);
    state.players[1]!.credits = 50_000;
    tick(state, [{ type: 'BUILD_START', playerId: 1, item: 'JET' }]);
    expect(state.players[1]!.queues.air.item).toBe('JET');
    // Player 0 lost his only field: no new jet for him.
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'JET' }]);
    expect(state.players[0]!.queues.air.item).toBeNull();
  });

  it('motherload does not bypass the physical one-jet-per-field cap', () => {
    const state = createGame(17, { factions: ['SOVIETS', 'SOVIETS'] });
    state.units = [];
    state.buildings = [];
    state.occupancy.fill(0);
    state.structures.fill(0);
    constructBuilding(state, 'CONYARD', 0, 5, 5);
    constructBuilding(state, 'CONYARD', 1, 55, 55);
    tick(state, [{ type: 'CHEAT', playerId: 0, cheat: 'MOTHERLOAD' }]);
    tick(state, [{ type: 'BUILD_START', playerId: 0, item: 'JET' }]);
    expect(state.players[0]!.queues.air.item).toBeNull(); // no Flugfeld, no jet
  });
});
