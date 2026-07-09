import { describe, expect, it } from 'vitest';
import {
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
  type GameState,
} from '../src/index.js';

/** Open ground with a full rock wall down column 30 and a single gap at row 20
 *  (the starting conyards stay, so victory doesn't fire). */
function walled(seed = 1): GameState {
  const s = createGame(seed);
  s.units = [];
  s.occupancy.fill(0);
  s.terrain.fill(TERRAIN_DIRT);
  for (let y = 0; y < s.mapHeight; y++) {
    if (y !== 20) s.terrain[cellIndex(s, 30, y)] = TERRAIN_ROCK;
  }
  return s;
}

describe('Tor (gate)', () => {
  it('lets its owner through but blocks the enemy', () => {
    const s = walled();
    constructBuilding(s, 'GATE', 0, 30, 20); // gate owned by player 0, in the gap
    const mine = spawnUnit(s, 'TANK', 0, 28, 20);
    const foe = spawnUnit(s, 'TANK', 1, 28, 19);
    tick(s, [
      { type: 'MOVE', playerId: 0, unitIds: [mine.id], cx: 34, cy: 20 },
      { type: 'MOVE', playerId: 1, unitIds: [foe.id], cx: 34, cy: 19 },
    ]);
    for (let i = 0; i < 500 && mine.cell % s.mapWidth <= 30; i++) tick(s);
    expect(mine.cell % s.mapWidth).toBeGreaterThan(30); // passed through its own gate
    for (let i = 0; i < 200; i++) tick(s);
    expect(foe.cell % s.mapWidth).toBeLessThan(31); // the gate (and rock) stop the enemy
  });

  it('blocks even the owner is false — it blocks everyone else like a wall', () => {
    const s = walled(2);
    constructBuilding(s, 'GATE', 1, 30, 20); // this gate belongs to the ENEMY (player 1)
    const mine = spawnUnit(s, 'TANK', 0, 28, 20);
    tick(s, [{ type: 'MOVE', playerId: 0, unitIds: [mine.id], cx: 34, cy: 20 }]);
    for (let i = 0; i < 300; i++) tick(s);
    expect(mine.cell % s.mapWidth).toBeLessThan(31); // can't use the enemy's gate
  });

  it('reopens the cell (as plain ground) when the gate is destroyed', () => {
    const s = walled(3);
    const gate = constructBuilding(s, 'GATE', 0, 30, 20);
    expect(s.gateOwner[cellIndex(s, 30, 20)]).toBe(1); // owner 0 → +1
    gate.hp = 0;
    tick(s); // deathSystem clears it
    expect(s.gateOwner[cellIndex(s, 30, 20)]).toBe(0);
    expect(s.structures[cellIndex(s, 30, 20)]).toBe(0);
  });

  it('gate state round-trips through serialization', () => {
    const s = walled(4);
    constructBuilding(s, 'GATE', 0, 30, 20);
    const mine = spawnUnit(s, 'TANK', 0, 28, 20);
    tick(s, [{ type: 'MOVE', playerId: 0, unitIds: [mine.id], cx: 34, cy: 20 }]);
    for (let i = 0; i < 40; i++) tick(s);
    const copy = deserialize(serialize(s));
    for (let i = 0; i < 200; i++) { tick(s); tick(copy); }
    expect(hashState(copy)).toBe(hashState(s));
  });
});
