import { INFANTRY_STACK, isNavigableWater, passableFor, type GridView } from '../map.js';
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
  /** Infantry share tiles: only full packs and vehicles block (avoidUnits). */
  infantry?: boolean;
}

const COST_STRAIGHT = 10;
const COST_DIAGONAL = 14;
const MAX_EXPANSIONS = 6000;
const INF = 0x7fffffff;

/**
 * Module-level scratch buffers, grown to the largest map seen. Repaths fire
 * every few ticks per moving unit; allocating ~330 KB per call on a 192² map
 * would hammer the GC. A generation stamp per cell replaces the O(size)
 * refill: an entry is only valid when its stamp matches the current call's
 * generation. Pure scratch — results stay deterministic by construction.
 */
let scratchSize = 0;
let gScore = new Int32Array(0);
let cameFrom = new Int32Array(0);
let gStamp = new Int32Array(0);
let closedStamp = new Int32Array(0);
let generation = 0;

function ensureScratch(size: number): void {
  if (size > scratchSize) {
    scratchSize = size;
    gScore = new Int32Array(size);
    cameFrom = new Int32Array(size);
    gStamp = new Int32Array(size);
    closedStamp = new Int32Array(size);
    generation = 0;
  }
  generation++;
  if (generation === INF) {
    gStamp.fill(0);
    closedStamp.fill(0);
    generation = 1;
  }
}

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

  ensureScratch(size);
  const gen = generation;
  const gAt = (i: number): number => (gStamp[i] === gen ? gScore[i]! : INF);
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
      if (opts.infantry === true) {
        if (occ > 0 && occ !== opts.selfId) return false;
        if (occ <= -INFANTRY_STACK) return false;
      } else if (occ !== 0 && occ !== opts.selfId) {
        return false;
      }
    }
    return true;
  };

  gScore[startIdx] = 0;
  gStamp[startIdx] = gen;
  open.push(startIdx, heuristic(targetCx - startCx, targetCy - startCy));

  let bestIdx = startIdx;
  let bestH = heuristic(targetCx - startCx, targetCy - startCy);
  let expansions = 0;

  while (open.size > 0 && expansions < MAX_EXPANSIONS) {
    const cur = open.pop();
    if (closedStamp[cur] === gen) continue;
    closedStamp[cur] = gen;
    expansions++;

    if (cur === targetIdx) {
      bestIdx = cur;
      break;
    }

    const cx = cur % w;
    const cy = (cur - cx) / w;
    const curH = heuristic(targetCx - cx, targetCy - cy);
    if (curH < bestH || (curH === bestH && gAt(cur) < gAt(bestIdx))) {
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
        if (closedStamp[nIdx] === gen) continue;
        const step = dx !== 0 && dy !== 0 ? COST_DIAGONAL : COST_STRAIGHT;
        const g = gScore[cur]! + step;
        if (g >= gAt(nIdx)) continue;
        gScore[nIdx] = g;
        gStamp[nIdx] = gen;
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
