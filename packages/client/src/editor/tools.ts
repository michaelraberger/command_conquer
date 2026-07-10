import {
  RESOURCE_NONE,
  TERRAIN_DIRT,
  isPassableKind,
} from '@cac/sim';
import type { EditorDraft } from './editorState.js';

/** Ore/gem fields are stamped with this amount (cf. stampResourcePatch: 400–699). */
export const RESOURCE_STAMP_AMOUNT = 500;

export type ToolId = 'terrain' | 'resource' | 'eraser' | 'fill' | 'spawn';

/** Round-ish brush: all cells within `size/2` (Euclidean, like stampResourcePatch). */
function forBrush(
  draft: EditorDraft,
  cx: number,
  cy: number,
  size: number,
  apply: (idx: number) => void,
): void {
  const r = Math.floor(size / 2);
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= draft.width || y >= draft.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r + 1) continue;
      apply(y * draft.width + x);
    }
  }
}

/** Paints a terrain kind; painting impassable ground clears resources under it. */
export function paintTerrain(draft: EditorDraft, cx: number, cy: number, size: number, kind: number): void {
  forBrush(draft, cx, cy, size, (idx) => {
    draft.terrain[idx] = kind;
    if (!isPassableKind(kind)) {
      draft.ore[idx] = 0;
      draft.resourceKind[idx] = RESOURCE_NONE;
    }
  });
}

/** Paints an ore/gem field. Forces dirt underneath (like stampResourcePatch),
 *  otherwise harvesters could never reach it. */
export function paintResource(draft: EditorDraft, cx: number, cy: number, size: number, kind: number): void {
  forBrush(draft, cx, cy, size, (idx) => {
    draft.terrain[idx] = TERRAIN_DIRT;
    draft.ore[idx] = RESOURCE_STAMP_AMOUNT;
    draft.resourceKind[idx] = kind;
  });
}

/** Removes resource fields (terrain stays). */
export function eraseResource(draft: EditorDraft, cx: number, cy: number, size: number): void {
  forBrush(draft, cx, cy, size, (idx) => {
    draft.ore[idx] = 0;
    draft.resourceKind[idx] = RESOURCE_NONE;
  });
}

/** 4-neighbour flood fill of the clicked terrain region with `kind`. */
export function floodFillTerrain(draft: EditorDraft, cx: number, cy: number, kind: number): void {
  const from = draft.terrain[cy * draft.width + cx]!;
  if (from === kind) return;
  const queue: number[] = [cy * draft.width + cx];
  draft.terrain[queue[0]!] = kind;
  const clearIfBlocked = (idx: number): void => {
    if (!isPassableKind(kind)) {
      draft.ore[idx] = 0;
      draft.resourceKind[idx] = RESOURCE_NONE;
    }
  };
  clearIfBlocked(queue[0]!);
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    const x = idx % draft.width;
    const y = (idx - x) / draft.width;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= draft.width || ny >= draft.height) continue;
      const ni = ny * draft.width + nx;
      if (draft.terrain[ni] !== from) continue;
      draft.terrain[ni] = kind;
      clearIfBlocked(ni);
      queue.push(ni);
    }
  }
}

/** Index of the spawn at/near (cx, cy), or -1. */
export function spawnAt(draft: EditorDraft, cx: number, cy: number, tolerance = 2): number {
  return draft.spawns.findIndex(
    ([x, y]) => Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= tolerance,
  );
}

/** Spawn tool click: on a spawn → remove it (min 2 stays); else add (max 6). */
export function toggleSpawn(draft: EditorDraft, cx: number, cy: number): void {
  const hit = spawnAt(draft, cx, cy);
  if (hit >= 0) {
    if (draft.spawns.length > 2) draft.spawns.splice(hit, 1);
    return;
  }
  if (draft.spawns.length < 6) draft.spawns.push([cx, cy]);
}
