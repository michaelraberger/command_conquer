import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  TERRAIN_WATER,
  UNIT_RULES,
  cellIndex,
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
  type UnitType,
} from '../src/index.js';

/** First water cell on the map (row-major). */
function waterCell(state: GameState): { cx: number; cy: number } {
  for (let i = 0; i < state.terrain.length; i++) {
    if (state.terrain[i] === TERRAIN_WATER) {
      return { cx: i % state.mapWidth, cy: Math.floor(i / state.mapWidth) };
    }
  }
  throw new Error('no water on map');
}

/** All-dirt battlefield with a sea channel in columns 20–27 (like naval.test). */
function coast(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.ore.fill(0);
  state.resourceKind.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  for (let y = 0; y < state.mapHeight; y++) {
    for (let x = 20; x <= 27; x++) state.terrain[cellIndex(state, x, y)] = TERRAIN_WATER;
  }
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

describe('Raketen-U-Boot (MISSILESUB)', () => {
  it('is available to both factions and out-ranges every other unit', () => {
    const rule = unitRule('MISSILESUB');
    expect(rule.factions).toBeNull();
    expect(rule.requires).toContain('SHIPYARD');
    expect(rule.requires).toContain('TECHCENTER');
    expect(rule.submerged).toBe(true);
    expect(rule.weapon!.arcing).toBe(true);
    for (const type of Object.keys(UNIT_RULES) as UnitType[]) {
      const other = unitRule(type);
      if (type === 'MISSILESUB' || !other.weapon) continue;
      expect(rule.weapon!.range).toBeGreaterThan(other.weapon.range);
    }
  });

  it('bombards a shore building from long range without moving', () => {
    const state = coast();
    const sub = spawnUnit(state, 'MISSILESUB', 0, 24, 10);
    const target = constructBuilding(state, 'POWER', 1, 35, 9); // ~11 Zellen entfernt
    const hpBefore = target.hp;
    const cellBefore = sub.cell;

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [sub.id], targetId: target.id }]);
    for (let i = 0; i < 300 && target.hp === hpBefore; i++) tick(state);

    expect(target.hp).toBeLessThan(hpBefore);
    expect(sub.cell).toBe(cellBefore); // Ziel liegt in Reichweite — kein Anfahren nötig
  });

  it('the AI queues a missile sub once its surface fleet stands', () => {
    // Hard AI on an island map with everything in place: shipyard, tech
    // center, transport, fleet at cap and a full war chest — the next naval
    // production must be the siege sub.
    const state = createGame(7, { ai: true, aiDifficulty: 'hard', mapType: 'ISLANDS' });
    const ai = state.players[1]!;
    ai.credits = 6000;
    const conyard = state.buildings.find((b) => b.owner === 1 && b.type === 'CONYARD')!;
    constructBuilding(state, 'TECHCENTER', 1, conyard.cx + 4, conyard.cy);
    constructBuilding(state, 'SHIPYARD', 1, conyard.cx + 4, conyard.cy + 4);
    // A factory and a second harvester, so the AI's economy phase (which
    // early-returns out of manageTraining) is already satisfied.
    constructBuilding(state, 'FACTORY', 1, conyard.cx - 4, conyard.cy);
    spawnUnit(state, 'HARVESTER', 1, conyard.cx - 2, conyard.cy + 4);
    const { cx, cy } = waterCell(state);
    spawnUnit(state, 'TRANSPORT', 1, cx, cy);
    for (let i = 0; i < 3; i++) spawnUnit(state, 'DESTROYER', 1, cx + i + 1, cy);

    let queued = false;
    for (let t = 0; t < 300 && !queued; t++) {
      tick(state);
      queued = ai.queues.naval.item === 'MISSILESUB';
    }
    expect(queued).toBe(true);
  });

  it('stays submerged: a tank cannot hurt it, a destroyer can', () => {
    const state = coast();
    const sub = spawnUnit(state, 'MISSILESUB', 1, 24, 30);
    const tank = spawnUnit(state, 'TANK', 0, 18, 30);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: sub.id }]);
    for (let i = 0; i < 120; i++) tick(state);
    expect(sub.hp).toBe(unitRule('MISSILESUB').maxHp);

    const destroyer = spawnUnit(state, 'DESTROYER', 0, 24, 26);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [destroyer.id], targetId: sub.id }]);
    for (let i = 0; i < 200 && sub.hp === unitRule('MISSILESUB').maxHp; i++) tick(state);
    expect(sub.hp).toBeLessThan(unitRule('MISSILESUB').maxHp);
  });
});
