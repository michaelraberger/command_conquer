import { createGame, type CustomMapData, type MapType } from '@cac/sim';
import { getMap, publicMaps } from '../net/mapsRepo.js';
import { colorCss, paintMapData } from '../render/palette.js';

/** Fixed seed for procedural previews — a representative sample; the actual
 *  match rolls its own seed (same convention as the old start-screen cards). */
const PREVIEW_SEED = 1337;

export const MAP_TYPE_LABELS: Record<MapType, string> = {
  BADLANDS: 'Ödland',
  RIVER: 'Flusstal',
  ISLANDS: 'Inselgruppe',
};

export type MapSelection =
  | { kind: 'proc'; mapType: MapType }
  | { kind: 'cloud'; id: string; name: string; maxPlayers: number };

export interface MapPicker {
  selection(): MapSelection;
  /** Resolves the full map data of the current cloud selection (cached). */
  loadSelectedMap(): Promise<CustomMapData | undefined>;
  /** (Re)loads the public gallery maps into the list. */
  refreshCloud(): Promise<void>;
  /** Repaints the big preview (call when the size choice changes). */
  refreshPreview(): void;
}

/** Shared cache: full map rows are fetched once per session (preview + play). */
const mapDataCache = new Map<string, Promise<CustomMapData>>();

function cachedMap(id: string): Promise<CustomMapData> {
  let p = mapDataCache.get(id);
  if (!p) {
    p = getMap(id);
    p.catch(() => mapDataCache.delete(id)); // failed fetches may retry later
    mapDataCache.set(id, p);
  }
  return p;
}

function paintCustom(canvas: HTMLCanvasElement, map: CustomMapData): void {
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d')!;
  paintMapData(ctx, {
    mapWidth: map.width,
    mapHeight: map.height,
    terrain: map.terrain,
    ore: map.ore,
    resourceKind: map.resourceKind,
  });
  // Spawn markers, like the bases on procedural previews.
  ctx.fillStyle = '#e8b339';
  for (const [sx, sy] of map.spawns) ctx.fillRect(sx - 1, sy - 1, 4, 4);
}

function paintProcedural(canvas: HTMLCanvasElement, mapType: MapType, size: number): void {
  const state = createGame(PREVIEW_SEED, { mapType, mapWidth: size, mapHeight: size });
  canvas.width = state.mapWidth;
  canvas.height = state.mapHeight;
  const ctx = canvas.getContext('2d')!;
  paintMapData(ctx, state);
  for (const b of state.buildings) {
    ctx.fillStyle = colorCss(state.players[b.owner]!.color);
    ctx.fillRect(b.cx - 1, b.cy - 1, 4, 4);
  }
}

/** Paints any lobby map choice into a canvas (guest preview in the lobby). */
export function paintSelectionPreview(
  canvas: HTMLCanvasElement,
  sel: { mapType: MapType; mapSize: number; cloudMap?: { id: string } | null },
): void {
  if (sel.cloudMap) {
    void cachedMap(sel.cloudMap.id)
      .then((map) => paintCustom(canvas, map))
      .catch(() => undefined);
  } else {
    paintProcedural(canvas, sel.mapType, sel.mapSize);
  }
}

/**
 * Classic C&C-style map chooser used by BOTH the skirmish form and the
 * multiplayer lobby: a scrollable list of maps on the left (the three
 * procedural ones plus every public gallery map), one BIG preview of the
 * selection on the right.
 */
export function createMapPicker(
  container: HTMLElement,
  opts: {
    /** Radio group name — unique per picker instance. */
    name: string;
    /** Include public gallery maps (needs Supabase; ignored offline). */
    cloud: boolean;
    /** Map side length for procedural previews (defaults to 64). */
    getSize?: () => number;
    onChange?: (sel: MapSelection) => void;
  },
): MapPicker {
  const cloudMeta = new Map<string, { name: string; maxPlayers: number }>();

  const root = document.createElement('div');
  root.className = 'picker';
  const list = document.createElement('div');
  list.className = 'picker-list';
  const previewPane = document.createElement('div');
  previewPane.className = 'picker-preview';
  const canvas = document.createElement('canvas');
  const info = document.createElement('div');
  info.className = 'picker-info';
  previewPane.append(canvas, info);
  root.append(list, previewPane);
  container.replaceChildren(root);

  const row = (value: string, label: string, meta: string, checked: boolean): HTMLLabelElement => {
    const el = document.createElement('label');
    el.className = 'picker-row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = opts.name;
    input.value = value;
    input.checked = checked;
    input.addEventListener('change', () => {
      refreshPreview();
      opts.onChange?.(selection());
    });
    const name = document.createElement('span');
    name.className = 'picker-row-name';
    name.textContent = label;
    el.append(input, name);
    if (meta) {
      const metaEl = document.createElement('small');
      metaEl.textContent = meta;
      el.append(metaEl);
    }
    return el;
  };

  for (const [type, label] of Object.entries(MAP_TYPE_LABELS) as Array<[MapType, string]>) {
    list.append(row(`proc:${type}`, label, 'Zufallskarte', type === 'BADLANDS'));
  }

  const selection = (): MapSelection => {
    const input = container.querySelector<HTMLInputElement>(`input[name="${opts.name}"]:checked`);
    const value = input?.value ?? 'proc:BADLANDS';
    if (value.startsWith('cloud:')) {
      const id = value.slice('cloud:'.length);
      const meta = cloudMeta.get(id);
      return { kind: 'cloud', id, name: meta?.name ?? 'Karte', maxPlayers: meta?.maxPlayers ?? 4 };
    }
    return { kind: 'proc', mapType: value.slice('proc:'.length) as MapType };
  };

  const refreshPreview = (): void => {
    const sel = selection();
    if (sel.kind === 'proc') {
      const size = opts.getSize?.() ?? 64;
      paintProcedural(canvas, sel.mapType, size);
      info.textContent = `${MAP_TYPE_LABELS[sel.mapType]} · ${size} × ${size} · Zufallskarte`;
      return;
    }
    info.textContent = `${sel.name} · max. ${sel.maxPlayers} Spieler`;
    void cachedMap(sel.id)
      .then((map) => {
        paintCustom(canvas, map);
        info.textContent = `${sel.name} · ${map.width} × ${map.height} · max. ${sel.maxPlayers} Spieler`;
      })
      .catch(() => {
        info.textContent = `${sel.name} — Vorschau nicht verfügbar`;
      });
  };

  const refreshCloud = async (): Promise<void> => {
    if (!opts.cloud) return;
    let rows;
    try {
      rows = await publicMaps();
    } catch {
      return; // gallery unreachable — procedural maps still work
    }
    for (const el of list.querySelectorAll('.picker-row-cloud, .picker-divider')) el.remove();
    if (rows.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'picker-divider';
      divider.textContent = 'Galerie';
      list.append(divider);
    }
    for (const r of rows) {
      cloudMeta.set(r.id, { name: r.name, maxPlayers: r.max_players });
      const el = row(`cloud:${r.id}`, r.name, `max. ${r.max_players} Spieler · ${r.author}`, false);
      el.classList.add('picker-row-cloud');
      list.append(el);
    }
  };

  refreshPreview();

  return {
    selection,
    refreshCloud,
    refreshPreview,
    loadSelectedMap: async () => {
      const sel = selection();
      return sel.kind === 'cloud' ? cachedMap(sel.id) : undefined;
    },
  };
}
