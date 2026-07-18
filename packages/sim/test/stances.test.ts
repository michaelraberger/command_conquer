import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  constructBuilding,
  createGame,
  hashState,
  spawnUnit,
  tick,
  type GameState,
  type Unit,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

const cellOf = (state: GameState, u: Unit): { cx: number; cy: number } => ({
  cx: u.cell % state.mapWidth,
  cy: Math.floor(u.cell / state.mapWidth),
});

/** Bare battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

describe('Patrouille (PATROL)', () => {
  it('shuttles between the two points and keeps going', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    tick(state, [{ type: 'PATROL', playerId: 0, unitIds: [tank.id], cx: 30, cy: 20 }]);
    expect(tank.order?.kind).toBe('PATROL');

    let sawB = false;
    let backAtA = false;
    let sawBAgain = false;
    for (let i = 0; i < 1200; i++) {
      tick(state);
      const { cx } = cellOf(state, tank);
      if (!sawB && cx >= 29) sawB = true;
      else if (sawB && !backAtA && cx <= 21) backAtA = true;
      else if (backAtA && !sawBAgain && cx >= 29) sawBAgain = true;
    }
    expect(sawB).toBe(true);
    expect(backAtA).toBe(true);
    expect(sawBAgain).toBe(true); // die Runde wiederholt sich
    expect(tank.order?.kind).toBe('PATROL'); // Auftrag bleibt bestehen
  });

  it('fights whatever crosses the route, then resumes the round', () => {
    const state = arena(2);
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    const straggler = spawnUnit(state, 'RIFLEMAN', 1, 25, 21);
    tick(state, [{ type: 'PATROL', playerId: 0, unitIds: [tank.id], cx: 30, cy: 20 }]);

    let died = false;
    for (let i = 0; i < 300 && !died; i++) {
      tick(state);
      died = !state.units.some((u) => u.id === straggler.id);
    }
    expect(died).toBe(true);
    let sawB = false;
    for (let i = 0; i < 400 && !sawB; i++) {
      tick(state);
      sawB = cellOf(state, tank).cx >= 29;
    }
    expect(sawB).toBe(true); // Patrouille läuft nach dem Gefecht weiter
  });
});

describe('Position halten (HOLD)', () => {
  it('stays put during a base alarm while unordered units rush out', () => {
    const state = arena(3);
    const holder = spawnUnit(state, 'TANK', 0, 10, 10);
    const rusher = spawnUnit(state, 'TANK', 0, 10, 12);
    // Feind-Artillerie beschießt den Bauhof aus der Distanz → AGGRO-Events.
    const arty = spawnUnit(state, 'ARTILLERY', 1, 13, 3);
    tick(state, [
      { type: 'HOLD', playerId: 0, unitIds: [holder.id] },
      { type: 'ATTACK', playerId: 1, unitIds: [arty.id], targetId: state.buildings[0]!.id },
    ]);
    const before = cellOf(state, holder);
    runTicks(state, 200);
    expect(cellOf(state, holder)).toEqual(before); // hält, trotz Alarm
    expect(cellOf(state, rusher)).not.toEqual({ cx: 10, cy: 12 }); // der andere zieht los
    expect(holder.order?.kind).toBe('HOLD');
  });

  it('fires in place at enemies in range without moving', () => {
    const state = arena(4);
    const holder = spawnUnit(state, 'TANK', 0, 20, 20);
    tick(state, [{ type: 'HOLD', playerId: 0, unitIds: [holder.id] }]);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 23, 20); // in Panzer-Reichweite (4,5)
    const before = cellOf(state, holder);
    let died = false;
    for (let i = 0; i < 200 && !died; i++) {
      tick(state);
      died = !state.units.some((u) => u.id === victim.id);
    }
    expect(died).toBe(true);
    expect(cellOf(state, holder)).toEqual(before);
  });
});

describe('Eskorte (ESCORT)', () => {
  it('follows the ward across the map and ends nearby', () => {
    const state = arena(5);
    const harvester = spawnUnit(state, 'HARVESTER', 0, 12, 12);
    const guard = spawnUnit(state, 'TANK', 0, 10, 10);
    tick(state, [
      { type: 'ESCORT', playerId: 0, unitIds: [guard.id], targetId: harvester.id },
      { type: 'MOVE', playerId: 0, unitIds: [harvester.id], cx: 40, cy: 40 },
    ]);
    for (let i = 0; i < 900; i++) tick(state);
    const h = cellOf(state, harvester);
    const g = cellOf(state, guard);
    expect(Math.max(Math.abs(h.cx - g.cx), Math.abs(h.cy - g.cy))).toBeLessThanOrEqual(3);
    expect(guard.order?.kind).toBe('ESCORT');
  });

  it('fights off attackers near the route and clears the order when the ward dies', () => {
    const state = arena(6);
    const ward = spawnUnit(state, 'RIFLEMAN', 0, 20, 20);
    const guard = spawnUnit(state, 'TANK', 0, 19, 19);
    const bandit = spawnUnit(state, 'RIFLEMAN', 1, 22, 21);
    tick(state, [{ type: 'ESCORT', playerId: 0, unitIds: [guard.id], targetId: ward.id }]);
    let banditDead = false;
    for (let i = 0; i < 300 && !banditDead; i++) {
      tick(state);
      banditDead = !state.units.some((u) => u.id === bandit.id);
    }
    expect(banditDead).toBe(true);

    // Schützling stirbt → die Order löst sich.
    ward.hp = 0;
    runTicks(state, 5);
    expect(guard.order).toBeNull();
  });

  it('helicopters may escort, jets and foreign/dead targets are refused', () => {
    const state = arena(7);
    const heli = spawnUnit(state, 'HELI', 0, 12, 12);
    const jet = spawnUnit(state, 'STRIKEJET', 0, 13, 12);
    const ward = spawnUnit(state, 'TANK', 0, 14, 12);
    const foe = spawnUnit(state, 'TANK', 1, 40, 40);
    tick(state, [
      { type: 'ESCORT', playerId: 0, unitIds: [heli.id, jet.id], targetId: ward.id },
      { type: 'ESCORT', playerId: 0, unitIds: [ward.id], targetId: foe.id },
    ]);
    expect(heli.order).toEqual({ kind: 'ESCORT', targetId: ward.id }); // hover may escort
    expect(jet.order).toBeNull();
    expect(ward.order).toBeNull(); // foe is not an own unit
  });
});

describe('Flugzeug-Sonderfälle', () => {
  it('helicopters may PATROL and HOLD, jets may not', () => {
    const state = arena(8);
    const heli = spawnUnit(state, 'HELI', 0, 12, 12);
    const jet = spawnUnit(state, 'STRIKEJET', 0, 14, 12);
    tick(state, [
      { type: 'PATROL', playerId: 0, unitIds: [heli.id, jet.id], cx: 30, cy: 12 },
    ]);
    expect(heli.order?.kind).toBe('PATROL');
    expect(jet.order).toBeNull();

    tick(state, [{ type: 'HOLD', playerId: 0, unitIds: [heli.id, jet.id] }]);
    expect(heli.order?.kind).toBe('HOLD');
    expect(jet.order).toBeNull();
  });

  it('a dry holding helicopter keeps station instead of flying home', () => {
    const state = arena(9);
    constructBuilding(state, 'HELIPAD', 0, 8, 10);
    const heli = spawnUnit(state, 'HELI', 0, 20, 20);
    heli.ammo = 0;
    tick(state, [{ type: 'HOLD', playerId: 0, unitIds: [heli.id] }]);
    runTicks(state, 200);
    expect(heli.order?.kind).toBe('HOLD');
    const { cx, cy } = cellOf(state, heli);
    expect(Math.abs(cx - 20) + Math.abs(cy - 20)).toBeLessThanOrEqual(1); // kein Heimflug
  });
});

describe('Determinismus', () => {
  it('all three standing orders replay bit-identically', () => {
    const run = (): string => {
      const state = arena(10);
      const p = spawnUnit(state, 'TANK', 0, 20, 20);
      const h = spawnUnit(state, 'TANK', 0, 22, 20);
      const w = spawnUnit(state, 'HARVESTER', 0, 24, 20);
      const g = spawnUnit(state, 'TANK', 0, 24, 22);
      spawnUnit(state, 'RIFLEMAN', 1, 28, 24);
      tick(state, [
        { type: 'PATROL', playerId: 0, unitIds: [p.id], cx: 32, cy: 20 },
        { type: 'HOLD', playerId: 0, unitIds: [h.id] },
        { type: 'ESCORT', playerId: 0, unitIds: [g.id], targetId: w.id },
        { type: 'MOVE', playerId: 0, unitIds: [w.id], cx: 36, cy: 30 },
      ]);
      for (let i = 0; i < 400; i++) tick(state);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
