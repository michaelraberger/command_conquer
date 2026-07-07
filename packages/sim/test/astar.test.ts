import { describe, expect, it } from 'vitest';
import { TERRAIN_GRASS, TERRAIN_ROCK, type GridView } from '../src/map.js';
import { findPath } from '../src/path/astar.js';

function makeGrid(w: number, h: number, rocks: Array<[number, number]> = []): GridView {
  const terrain = new Uint8Array(w * h).fill(TERRAIN_GRASS);
  for (const [cx, cy] of rocks) terrain[cy * w + cx] = TERRAIN_ROCK;
  return {
    mapWidth: w,
    mapHeight: h,
    terrain,
    occupancy: new Int32Array(w * h),
    structures: new Int32Array(w * h),
  };
}

const OPTS = { avoidUnits: false, selfId: 0 };

describe('findPath', () => {
  it('finds a straight diagonal path on open ground', () => {
    const grid = makeGrid(10, 10);
    const path = findPath(grid, 0, 0, 5, 5, OPTS);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(path![path!.length - 1]).toEqual({ cx: 5, cy: 5 });
  });

  it('routes through a gap in a wall without cutting corners', () => {
    // Vertical wall at x=5 with a gap at y=7.
    const rocks: Array<[number, number]> = [];
    for (let y = 0; y < 10; y++) if (y !== 7) rocks.push([5, y]);
    const grid = makeGrid(10, 10, rocks);
    const path = findPath(grid, 2, 2, 8, 2, OPTS)!;
    expect(path).not.toBeNull();
    expect(path.some((c) => c.cx === 5 && c.cy === 7)).toBe(true);
    // Never step onto a rock.
    for (const c of path) {
      expect(grid.terrain[c.cy * 10 + c.cx]).toBe(TERRAIN_GRASS);
    }
  });

  it('walks to the closest reachable cell when the target is sealed off', () => {
    // Target (8,8) enclosed by a rock ring.
    const rocks: Array<[number, number]> = [
      [7, 7], [8, 7], [9, 7],
      [7, 8],         [9, 8],
      [7, 9], [8, 9], [9, 9],
    ];
    const grid = makeGrid(12, 12, rocks);
    const path = findPath(grid, 1, 1, 8, 8, OPTS);
    expect(path).not.toBeNull();
    const end = path![path!.length - 1]!;
    expect(end.cx === 8 && end.cy === 8).toBe(false);
    // Ends adjacent to the ring (chebyshev distance 2 from the target).
    expect(Math.max(Math.abs(end.cx - 8), Math.abs(end.cy - 8))).toBeLessThanOrEqual(2);
  });

  it('treats reserved cells as blocked when avoidUnits is set', () => {
    const grid = makeGrid(5, 5);
    grid.occupancy[2 * 5 + 2] = 99; // someone parked in the middle
    const path = findPath(grid, 0, 2, 4, 2, { avoidUnits: true, selfId: 1 })!;
    expect(path.some((c) => c.cx === 2 && c.cy === 2)).toBe(false);
    expect(path[path.length - 1]).toEqual({ cx: 4, cy: 2 });
  });

  it('returns null when start equals target', () => {
    const grid = makeGrid(5, 5);
    expect(findPath(grid, 2, 2, 2, 2, OPTS)).toBeNull();
  });
});
