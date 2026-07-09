import { isNavigableWater, passableFor, type GridView } from '../map.js';
import type { PathCell } from '../state.js';
import { MinHeap } from './heap.js';

export interface PathOptions {
  /** Also treat cells reserved by other units as blocked (used for repaths). */
  avoidUnits: boolean;
  /** Unit doing the pathing; its own reservation never blocks it. */
  selfId: number;
  /** Ships: traverse open water instead of walkable land. */
  water?: boolean;
  /** Owner of the pathing unit — its own gates are passable, others block. */
  owner?: number;
}

const COST_STRAIGHT = 10;
const COST_DIAGONAL = 14;
const MAX_EXPANSIONS = 6000;
const INF = 0x7fffffff;

/** Octile distance heuristic in integer costs. */
function heuristic(dx: number, dy: number): number {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const lo = ax < ay ? ax : ay;
  const hi = ax < ay ? ay : ax;
  return COST_DIAGONAL * lo + COST_STRAIGHT * (hi - lo);
}

/**
 * 8-directional A* on the cell grid, integer math only.
 *
 * Best-effort: if the target is unreachable (water, enclosed, occupied when
 * avoidUnits is set), returns a path to the reachable cell closest to the
 * target — classic C&C "click on water, tank drives to the shore".
 * Returns null only when there is nowhere to go at all.
 */
export function findPath(
  grid: GridView,
  startCx: number,
  startCy: number,
  targetCx: number,
  targetCy: number,
  opts: PathOptions,
): PathCell[] | null {
  const w = grid.mapWidth;
  const h = grid.mapHeight;
  const size = w * h;
  const startIdx = startCy * w + startCx;
  const targetIdx = targetCy * w + targetCx;

  const gScore = new Int32Array(size).fill(INF);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();

  const owner = opts.owner ?? -1;
  const traversable =
    opts.water === true
      ? isNavigableWater
      : (grid: GridView, cx: number, cy: number): boolean => passableFor(grid, cx, cy, owner);
  const passable = (cx: number, cy: number): boolean => {
    if (!traversable(grid, cx, cy)) return false;
    if (opts.avoidUnits) {
      const occ = grid.occupancy[cy * w + cx]!;
      if (occ !== 0 && occ !== opts.selfId) return false;
    }
    return true;
  };

  gScore[startIdx] = 0;
  open.push(startIdx, heuristic(targetCx - startCx, targetCy - startCy));

  let bestIdx = startIdx;
  let bestH = heuristic(targetCx - startCx, targetCy - startCy);
  let expansions = 0;

  while (open.size > 0 && expansions < MAX_EXPANSIONS) {
    const cur = open.pop();
    if (closed[cur] === 1) continue;
    closed[cur] = 1;
    expansions++;

    if (cur === targetIdx) {
      bestIdx = cur;
      break;
    }

    const cx = cur % w;
    const cy = (cur - cx) / w;
    const curH = heuristic(targetCx - cx, targetCy - cy);
    if (curH < bestH || (curH === bestH && gScore[cur]! < gScore[bestIdx]!)) {
      bestH = curH;
      bestIdx = cur;
    }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(nx, ny)) continue;
        // No cutting corners: diagonals need both orthogonal neighbors free.
        if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) {
          continue;
        }
        const nIdx = ny * w + nx;
        if (closed[nIdx] === 1) continue;
        const step = dx !== 0 && dy !== 0 ? COST_DIAGONAL : COST_STRAIGHT;
        const g = gScore[cur]! + step;
        if (g >= gScore[nIdx]!) continue;
        gScore[nIdx] = g;
        cameFrom[nIdx] = cur;
        open.push(nIdx, g + heuristic(targetCx - nx, targetCy - ny));
      }
    }
  }

  if (bestIdx === startIdx) return null;

  const path: PathCell[] = [];
  let idx = bestIdx;
  while (idx !== startIdx) {
    const cx = idx % w;
    path.unshift({ cx, cy: (idx - cx) / w });
    idx = cameFrom[idx]!;
  }
  return path;
}
