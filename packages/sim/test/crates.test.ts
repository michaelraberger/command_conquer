import { describe, expect, it } from 'vitest';
import {
  CRATE_MONEY,
  FOG_EXPLORED,
  FOG_HIDDEN,
  FOG_VISIBLE,
  TERRAIN_DIRT,
  TERRAIN_ROCK,
  cellIndex,
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  spawnUnit,
  tick,
  unitRule,
  type CrateKind,
  type GameState,
} from '../src/index.js';

/** Empty dirt battlefield with both HQs so nobody auto-loses. */
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

function dropCrate(state: GameState, cx: number, cy: number, kind: CrateKind): void {
  state.crates.push({ id: state.nextEntityId++, cx, cy, kind });
}

describe('crate spawning', () => {
  it('spawns deterministically (two runs, same hash)', () => {
    const run = (): string => {
      const state = createGame(31337, { mapWidth: 96, mapHeight: 96, opponents: 2 });
      for (let i = 0; i < 1300; i++) tick(state);
      return `${hashState(state)}:${state.crates.length}`;
    };
    expect(run()).toBe(run());
  }, 30000);

  it('never spawns on blocked cells or near a base', () => {
    const state = createGame(55, { mapWidth: 96, mapHeight: 96, opponents: 2 });
    for (let i = 0; i < 3000; i++) tick(state);
    for (const crate of state.crates) {
      const idx = cellIndex(state, crate.cx, crate.cy);
      expect(state.structures[idx]).toBe(0);
      for (const [sx, sy] of state.spawns) {
        const d2 = (crate.cx - sx) ** 2 + (crate.cy - sy) ** 2;
        expect(d2).toBeGreaterThan(100);
      }
    }
  }, 30000);
});

describe('crate pickup', () => {
  it('MONEY pays the collector', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'MONEY');
    spawnUnit(state, 'TANK', 0, 30, 30);
    const before = state.players[0]!.credits;
    tick(state);
    expect(state.players[0]!.credits).toBe(before + CRATE_MONEY);
    expect(state.crates.length).toBe(0);
    expect(state.events.some((e) => e.type === 'CRATE_PICKUP' && e.kind === 'MONEY')).toBe(true);
  });

  it('HEAL cures own units around the crate, nobody else', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'HEAL');
    const collector = spawnUnit(state, 'TANK', 0, 30, 30);
    const near = spawnUnit(state, 'RIFLEMAN', 0, 32, 30);
    const enemy = spawnUnit(state, 'RIFLEMAN', 1, 31, 30);
    const far = spawnUnit(state, 'RIFLEMAN', 0, 40, 40);
    collector.hp = 10;
    near.hp = 10;
    enemy.hp = 10;
    far.hp = 10;
    tick(state);
    expect(collector.hp).toBe(unitRule('TANK').maxHp);
    expect(near.hp).toBe(unitRule('RIFLEMAN').maxHp);
    // The enemy is never healed (it may even take fire from the healed squad
    // in the same tick — anything above its old hp would be the bug).
    expect(enemy.hp).toBeLessThanOrEqual(10);
    expect(far.hp).toBe(10);
  });

  it('REVEAL turns hidden cells explored (never live vision) and survives fog decay', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'REVEAL');
    spawnUnit(state, 'TANK', 0, 30, 30);
    const fog = state.fogs[0]!;
    expect(Array.from(fog).some((f) => f === FOG_HIDDEN)).toBe(true);
    tick(state);
    expect(Array.from(state.fogs[0]!).every((f) => f !== FOG_HIDDEN)).toBe(true);
    // A far-away revealed cell is explored knowledge, not live sight.
    expect(state.fogs[0]![cellIndex(state, 60, 5)]).toBe(FOG_EXPLORED);
    // The enemy learned nothing.
    expect(Array.from(state.fogs[1]!).some((f) => f === FOG_HIDDEN)).toBe(true);
    // Fog decay never demotes explored back to hidden.
    for (let i = 0; i < 30; i++) tick(state);
    expect(Array.from(state.fogs[0]!).every((f) => f !== FOG_HIDDEN)).toBe(true);
    // Around the live tank it is actual vision.
    expect(state.fogs[0]![cellIndex(state, 30, 30)]).toBe(FOG_VISIBLE);
  });

  it('UNIT spawns a free faction vehicle next to the crate', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'UNIT');
    spawnUnit(state, 'RIFLEMAN', 0, 30, 30);
    const before = state.units.length;
    tick(state);
    expect(state.units.length).toBe(before + 1);
    const freebie = state.units[state.units.length - 1]!;
    expect(freebie.owner).toBe(0);
    expect(['TANK', 'LIGHTTANK', 'SCOUT']).toContain(freebie.type);
    const cx = freebie.cell % state.mapWidth;
    const cy = (freebie.cell - cx) / state.mapWidth;
    expect(Math.max(Math.abs(cx - 30), Math.abs(cy - 30))).toBeLessThanOrEqual(3);
  });

  it('UNIT falls back to money when the crate is fully enclosed', () => {
    const state = arena();
    // Rock ring radius 1..3 around the crate cell — no spawn spot anywhere.
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx === 0 && dy === 0) continue;
        state.terrain[cellIndex(state, 30 + dx, 30 + dy)] = TERRAIN_ROCK;
      }
    }
    dropCrate(state, 30, 30, 'UNIT');
    spawnUnit(state, 'RIFLEMAN', 0, 30, 30);
    const before = state.players[0]!.credits;
    const unitsBefore = state.units.length;
    tick(state);
    expect(state.units.length).toBe(unitsBefore);
    expect(state.players[0]!.credits).toBe(before + CRATE_MONEY);
  });

  it('aircraft fly over crates without collecting them', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'MONEY');
    const heli = spawnUnit(state, 'HELI', 0, 30, 30);
    heli.path = null;
    const before = state.players[0]!.credits;
    tick(state);
    expect(state.players[0]!.credits).toBe(before);
    expect(state.crates.length).toBe(1);
  });
});

describe('crate persistence', () => {
  it('crates survive a serialize round trip', () => {
    const state = arena();
    dropCrate(state, 30, 30, 'HEAL');
    dropCrate(state, 40, 40, 'UNIT');
    const copy = deserialize(serialize(state));
    expect(copy.crates).toEqual(state.crates);
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('old saves without a crates field load with none', () => {
    const state = arena();
    const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
    delete raw.crates;
    const copy = deserialize(JSON.stringify(raw));
    expect(copy.crates).toEqual([]);
    tick(copy); // and the sim keeps running
  });
});
