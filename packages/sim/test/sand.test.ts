import { describe, expect, it } from 'vitest';
import {
  TERRAIN_SAND,
  canPlaceBuilding,
  createGame,
  emptyCustomMap,
  isBuildableKind,
  isPassableKind,
  validateCustomMap,
} from '../src/index.js';

describe('Wüste (TERRAIN_SAND)', () => {
  it('is passable and buildable like dirt/grass', () => {
    expect(isPassableKind(TERRAIN_SAND)).toBe(true);
    expect(isBuildableKind(TERRAIN_SAND)).toBe(true);
  });

  it('validates an all-sand map, including spawn areas on sand', () => {
    const map = emptyCustomMap(48, 48, 'Wüstentest');
    map.terrain.fill(TERRAIN_SAND);
    const v = validateCustomMap(map);
    expect(v.ok).toBe(true);
    expect(v.mapType).toBe('BADLANDS');
  });

  it('allows building placement on sand', () => {
    const map = emptyCustomMap(48, 48, 'Wüstentest');
    map.terrain.fill(TERRAIN_SAND);
    const state = createGame(7, { customMap: map });
    const [sx, sy] = map.spawns[0]!;
    expect(canPlaceBuilding(state, 0, 'POWER', sx - 4, sy - 4)).toBe(true);
  });
});
