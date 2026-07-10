import {
  RESOURCE_NONE,
  TERRAIN_DIRT,
  emptyCustomMap,
  validateCustomMap,
  type CustomMapData,
} from '@cac/sim';

/** Mutable working copy of a map inside the editor (typed arrays for speed). */
export interface EditorDraft {
  name: string;
  width: number;
  height: number;
  terrain: Uint8Array;
  ore: Uint16Array;
  resourceKind: Uint8Array;
  spawns: [number, number][];
  /** Neutral structures (Erz-Bohrtürme), (cx, cy) = footprint top-left. */
  neutralBuildings: Array<{ type: string; cx: number; cy: number }>;
  /** Cloud row id when the draft was loaded from / saved to the gallery. */
  cloudId: string | null;
}

const DRAFT_KEY = 'cac-editor-draft';
const UNDO_CAP = 50;

export function newDraft(width = 64, height = 64): EditorDraft {
  return fromCustomMapData(emptyCustomMap(width, height), null);
}

export function fromCustomMapData(map: CustomMapData, cloudId: string | null): EditorDraft {
  return {
    name: map.name,
    width: map.width,
    height: map.height,
    terrain: Uint8Array.from(map.terrain),
    ore: Uint16Array.from(map.ore),
    resourceKind: Uint8Array.from(map.resourceKind),
    spawns: map.spawns.map(([x, y]) => [x, y]),
    neutralBuildings: (map.neutralBuildings ?? []).map((b) => ({ ...b })),
    cloudId,
  };
}

/** Snapshot as the storable/playable format; mapType derives from the layout. */
export function toCustomMapData(draft: EditorDraft): CustomMapData {
  const map: CustomMapData = {
    version: 1,
    name: draft.name.trim() || 'Unbenannte Karte',
    width: draft.width,
    height: draft.height,
    terrain: Array.from(draft.terrain),
    ore: Array.from(draft.ore),
    resourceKind: Array.from(draft.resourceKind),
    spawns: draft.spawns.map(([x, y]) => [x, y]),
    mapType: 'BADLANDS',
    neutralBuildings: draft.neutralBuildings.map((b) => ({ ...b })),
  };
  const check = validateCustomMap(map);
  if (check.ok) map.mapType = check.mapType;
  return map;
}

/** Content-preserving resize: existing cells are kept top-left, new area is
 *  dirt; spawns are clamped into the new bounds (validation flags overlaps). */
export function resizeDraft(draft: EditorDraft, width: number, height: number): EditorDraft {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_DIRT);
  const ore = new Uint16Array(width * height);
  const resourceKind = new Uint8Array(width * height).fill(RESOURCE_NONE);
  const copyW = Math.min(width, draft.width);
  const copyH = Math.min(height, draft.height);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      const from = y * draft.width + x;
      const to = y * width + x;
      terrain[to] = draft.terrain[from]!;
      ore[to] = draft.ore[from]!;
      resourceKind[to] = draft.resourceKind[from]!;
    }
  }
  return {
    ...draft,
    width,
    height,
    terrain,
    ore,
    resourceKind,
    spawns: draft.spawns.map(([x, y]) => [Math.min(x, width - 6), Math.min(y, height - 6)]),
    // Neutral buildings whose 2×2 footprint no longer fits are dropped.
    neutralBuildings: draft.neutralBuildings
      .filter((b) => b.cx + 2 <= width && b.cy + 2 <= height)
      .map((b) => ({ ...b })),
  };
}

// --- Undo (full snapshots — ≤64 KB each at 96², trivially affordable) -------

export interface UndoStack {
  snapshots: EditorDraft[];
}

export const cloneDraft = (d: EditorDraft): EditorDraft => ({
  ...d,
  terrain: d.terrain.slice(),
  ore: d.ore.slice(),
  resourceKind: d.resourceKind.slice(),
  spawns: d.spawns.map(([x, y]) => [x, y]),
  neutralBuildings: d.neutralBuildings.map((b) => ({ ...b })),
});

export function pushUndo(stack: UndoStack, draft: EditorDraft): void {
  stack.snapshots.push(cloneDraft(draft));
  if (stack.snapshots.length > UNDO_CAP) stack.snapshots.shift();
}

export function popUndo(stack: UndoStack): EditorDraft | null {
  return stack.snapshots.pop() ?? null;
}

// --- localStorage draft persistence (survives reloads and test matches) -----

export function saveDraftLocal(draft: EditorDraft): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ map: toCustomMapData(draft), cloudId: draft.cloudId }),
    );
  } catch {
    // Quota exceeded or storage disabled — the draft simply won't survive a reload.
  }
}

export function loadDraftLocal(): EditorDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { map: CustomMapData; cloudId: string | null };
    if (parsed.map?.version !== 1) return null;
    return fromCustomMapData(parsed.map, parsed.cloudId ?? null);
  } catch {
    return null;
  }
}

export function clearDraftLocal(): void {
  localStorage.removeItem(DRAFT_KEY);
}
