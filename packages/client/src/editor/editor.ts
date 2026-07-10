import {
  RESOURCE_GEMS,
  RESOURCE_ORE,
  TERRAIN_BRIDGE,
  TERRAIN_DIRT,
  TERRAIN_GRASS,
  TERRAIN_ICE,
  TERRAIN_ROCK,
  TERRAIN_SAND,
  TERRAIN_TREE,
  TERRAIN_WATER,
  createGame,
  validateCustomMap,
  type CustomMapData,
} from '@cac/sim';
import type { Application } from 'pixi.js';
import { currentUser } from '../net/auth.js';
import { saveMap } from '../net/mapsRepo.js';
import { cloudEnabled } from '../net/supabase.js';
import { paintMapData } from '../render/palette.js';
import {
  fromCustomMapData,
  loadDraftLocal,
  newDraft,
  popUndo,
  pushUndo,
  resizeDraft,
  saveDraftLocal,
  toCustomMapData,
  type EditorDraft,
  type UndoStack,
} from './editorState.js';
import {
  eraseResource,
  floodFillTerrain,
  paintResource,
  paintTerrain,
  spawnAt,
  toggleSpawn,
  type ToolId,
} from './tools.js';

const TERRAIN_BY_KEY: Record<string, number> = {
  dirt: TERRAIN_DIRT,
  grass: TERRAIN_GRASS,
  water: TERRAIN_WATER,
  rock: TERRAIN_ROCK,
  tree: TERRAIN_TREE,
  ice: TERRAIN_ICE,
  sand: TERRAIN_SAND,
  bridge: TERRAIN_BRIDGE,
};

/**
 * Full-screen tile editor on a top-down 2D canvas. One instance per page load
 * (the app is one-shot); a test match hides the overlay and starts a real game,
 * the end screen's "Zurück zum Editor" reloads with the reopen flag set — the
 * draft always lives in localStorage.
 */
export async function openEditor(
  app: Application,
  initial?: { map: CustomMapData; cloudId: string | null },
): Promise<void> {
  const root = document.getElementById('editor')!;
  root.style.display = 'flex';

  let draft: EditorDraft = initial
    ? fromCustomMapData(initial.map, initial.cloudId)
    : (loadDraftLocal() ?? newDraft());
  const undo: UndoStack = { snapshots: [] };

  // --- DOM handles -----------------------------------------------------------
  const canvas = document.getElementById('ed-canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const nameInput = document.getElementById('ed-name') as HTMLInputElement;
  const sizeSelect = document.getElementById('ed-size') as HTMLSelectElement;
  const status = document.getElementById('ed-status')!;
  const saveBtn = document.getElementById('ed-save') as HTMLButtonElement;

  // Offscreen 1px-per-cell buffer; repainting all of it per stroke is cheap
  // (96² = 9216 px), the visible canvas just scales it up.
  const base = document.createElement('canvas');

  let tool: ToolId = 'terrain';
  let terrainKind = TERRAIN_WATER;
  let resourceKind = RESOURCE_ORE;
  let brushSize = 3;
  let zoom = 8;
  let panX = 0;
  let panY = 0;

  const say = (text: string, kind: 'info' | 'error' | 'ok' = 'info'): void => {
    status.textContent = text;
    status.className = `ed-status-${kind}`;
  };

  // --- Rendering ---------------------------------------------------------------
  const rebake = (): void => {
    base.width = draft.width;
    base.height = draft.height;
    paintMapData(base.getContext('2d')!, {
      mapWidth: draft.width,
      mapHeight: draft.height,
      terrain: draft.terrain,
      ore: draft.ore,
      resourceKind: draft.resourceKind,
    });
  };

  const render = (): void => {
    const wrap = canvas.parentElement!;
    if (canvas.width !== wrap.clientWidth || canvas.height !== wrap.clientHeight) {
      canvas.width = wrap.clientWidth;
      canvas.height = wrap.clientHeight;
    }
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, panX, panY, draft.width * zoom, draft.height * zoom);

    // Spawn markers with player numbers.
    for (let i = 0; i < draft.spawns.length; i++) {
      const [sx, sy] = draft.spawns[i]!;
      const px = panX + (sx + 0.5) * zoom;
      const py = panY + (sy + 0.5) * zoom;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = 'rgba(77,166,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(8, zoom), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, zoom)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py + 1);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };

  const centerMap = (): void => {
    zoom = Math.max(
      4,
      Math.min(
        16,
        Math.floor(Math.min(canvas.parentElement!.clientWidth / draft.width, canvas.parentElement!.clientHeight / draft.height)),
      ),
    );
    panX = Math.floor((canvas.parentElement!.clientWidth - draft.width * zoom) / 2);
    panY = Math.floor((canvas.parentElement!.clientHeight - draft.height * zoom) / 2);
  };

  const refresh = (): void => {
    rebake();
    render();
  };

  const commit = (): void => {
    saveDraftLocal(draft);
    refresh();
  };

  // --- Pointer handling ----------------------------------------------------
  const cellAt = (e: PointerEvent | WheelEvent): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left - panX) / zoom);
    const cy = Math.floor((e.clientY - rect.top - panY) / zoom);
    return cx >= 0 && cy >= 0 && cx < draft.width && cy < draft.height ? [cx, cy] : null;
  };

  let painting = false;
  let panning = false;
  let draggedSpawn = -1;
  let lastX = 0;
  let lastY = 0;

  const applyAt = (cx: number, cy: number): void => {
    if (tool === 'terrain') paintTerrain(draft, cx, cy, brushSize, terrainKind);
    else if (tool === 'resource') paintResource(draft, cx, cy, brushSize, resourceKind);
    else if (tool === 'eraser') eraseResource(draft, cx, cy, brushSize);
    rebake();
    render();
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 1 || e.button === 2) {
      panning = true;
      return;
    }
    const cell = cellAt(e);
    if (!cell) return;
    const [cx, cy] = cell;
    pushUndo(undo, draft);
    if (tool === 'spawn') {
      draggedSpawn = spawnAt(draft, cx, cy);
      if (draggedSpawn < 0) {
        toggleSpawn(draft, cx, cy);
        commit();
      }
      render();
      return;
    }
    if (tool === 'fill') {
      floodFillTerrain(draft, cx, cy, terrainKind);
      commit();
      return;
    }
    painting = true;
    applyAt(cx, cy);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (panning) {
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      render();
      return;
    }
    const cell = cellAt(e);
    if (!cell) return;
    if (painting) applyAt(cell[0], cell[1]);
    else if (draggedSpawn >= 0) {
      draft.spawns[draggedSpawn] = cell;
      render();
    }
  });

  const endStroke = (): void => {
    if (painting || draggedSpawn >= 0) {
      // A click on an existing spawn without moving removes it.
      saveDraftLocal(draft);
    }
    painting = false;
    panning = false;
    draggedSpawn = -1;
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const oldZoom = zoom;
      zoom = Math.max(3, Math.min(24, zoom + (e.deltaY < 0 ? 1 : -1)));
      // Zoom around the cursor: keep the cell under it stationary.
      panX = mx - ((mx - panX) / oldZoom) * zoom;
      panY = my - ((my - panY) / oldZoom) * zoom;
      render();
    },
    { passive: false },
  );

  window.addEventListener('resize', render);

  // --- Toolbar wiring --------------------------------------------------------
  const toolButtons = root.querySelectorAll<HTMLButtonElement>('[data-ed-tool]');
  const markActive = (): void => {
    for (const btn of toolButtons) btn.classList.toggle('active', btn.dataset['edTool'] === tool);
    for (const sw of root.querySelectorAll<HTMLButtonElement>('[data-ed-terrain]')) {
      sw.classList.toggle('active', TERRAIN_BY_KEY[sw.dataset['edTerrain']!] === terrainKind);
    }
    for (const sw of root.querySelectorAll<HTMLButtonElement>('[data-ed-res]')) {
      sw.classList.toggle(
        'active',
        (sw.dataset['edRes'] === 'gems' ? RESOURCE_GEMS : RESOURCE_ORE) === resourceKind,
      );
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-ed-brush]')) {
      b.classList.toggle('active', Number(b.dataset['edBrush']) === brushSize);
    }
  };

  for (const btn of toolButtons) {
    btn.addEventListener('click', () => {
      tool = btn.dataset['edTool'] as ToolId;
      markActive();
    });
  }
  for (const sw of root.querySelectorAll<HTMLButtonElement>('[data-ed-terrain]')) {
    sw.addEventListener('click', () => {
      terrainKind = TERRAIN_BY_KEY[sw.dataset['edTerrain']!]!;
      if (tool !== 'fill') tool = 'terrain';
      markActive();
    });
  }
  for (const sw of root.querySelectorAll<HTMLButtonElement>('[data-ed-res]')) {
    sw.addEventListener('click', () => {
      resourceKind = sw.dataset['edRes'] === 'gems' ? RESOURCE_GEMS : RESOURCE_ORE;
      tool = 'resource';
      markActive();
    });
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-ed-brush]')) {
    b.addEventListener('click', () => {
      brushSize = Number(b.dataset['edBrush']);
      markActive();
    });
  }

  nameInput.value = draft.name;
  nameInput.addEventListener('input', () => {
    draft.name = nameInput.value;
    saveDraftLocal(draft);
  });

  sizeSelect.value = String(draft.width);
  sizeSelect.addEventListener('change', () => {
    const size = Number(sizeSelect.value);
    pushUndo(undo, draft);
    draft = resizeDraft(draft, size, size);
    centerMap();
    commit();
  });

  document.getElementById('ed-undo')!.addEventListener('click', () => {
    const prev = popUndo(undo);
    if (!prev) {
      say('Nichts rückgängig zu machen.');
      return;
    }
    draft = prev;
    nameInput.value = draft.name;
    sizeSelect.value = String(draft.width);
    commit();
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && root.style.display !== 'none') {
      e.preventDefault();
      document.getElementById('ed-undo')!.dispatchEvent(new MouseEvent('click'));
    }
  });

  document.getElementById('ed-new')!.addEventListener('click', () => {
    if (!confirm('Karte verwerfen und neu beginnen?')) return;
    pushUndo(undo, draft);
    draft = newDraft(Number(sizeSelect.value), Number(sizeSelect.value));
    nameInput.value = draft.name;
    centerMap();
    commit();
    say('Neue leere Karte.');
  });

  // --- Validate / test / save / back ----------------------------------------
  const validate = (): { map: CustomMapData; ok: boolean } => {
    const map = toCustomMapData(draft);
    const check = validateCustomMap(map);
    if (!check.ok) say(check.errors.join(' '), 'error');
    else if (check.warnings.length > 0) say(`OK (${mapTypeLabel(check.mapType)}) — ${check.warnings.join(' ')}`, 'ok');
    else say(`Karte ist gültig (${mapTypeLabel(check.mapType)}, ${map.spawns.length} Spieler).`, 'ok');
    return { map, ok: check.ok };
  };

  document.getElementById('ed-check')!.addEventListener('click', validate);

  document.getElementById('ed-test')!.addEventListener('click', () => {
    const { map, ok } = validate();
    if (!ok) return;
    saveDraftLocal(draft);
    void (async () => {
      const { loadBalance, startGame } = await import('../main.js');
      const { LocalDriver } = await import('../loop.js');
      const { session } = await import('../session.js');
      const seed = (Math.random() * 0xffffffff) >>> 0;
      session.localPlayer = 0;
      const state = createGame(seed, {
        customMap: map,
        opponents: map.spawns.length - 1,
        ai: true,
        aiDifficulty: 'normal',
        balance: await loadBalance(),
      });
      root.style.display = 'none';
      await startGame(app, state, new LocalDriver(), {
        balance: await loadBalance(),
        mapLabel: map.name,
        testPlay: true,
      });
    })();
  });

  saveBtn.addEventListener('click', () => {
    const { map, ok } = validate();
    if (!ok) return;
    void (async () => {
      try {
        saveBtn.disabled = true;
        const id = await saveMap(map, draft.cloudId ?? undefined);
        draft.cloudId = id;
        saveDraftLocal(draft);
        say(`„${map.name}" gespeichert.`, 'ok');
      } catch (err) {
        say(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        saveBtn.disabled = false;
      }
    })();
  });

  document.getElementById('ed-back')!.addEventListener('click', () => {
    saveDraftLocal(draft);
    location.reload(); // one-shot app: back to the start screen via fresh boot
  });

  // Cloud save needs a login; guests can still build and test-play.
  if (!cloudEnabled()) {
    saveBtn.disabled = true;
    saveBtn.title = 'Cloud nicht konfiguriert (siehe supabase/README.md).';
  } else if ((await currentUser()) === null) {
    saveBtn.disabled = true;
    saveBtn.title = 'Anmeldung erforderlich — Karten speichern geht nur mit Konto.';
  }

  markActive();
  centerMap();
  refresh();
  say('Gelände malen: Werkzeug wählen und ziehen. Mittlere/rechte Maustaste: verschieben, Mausrad: Zoom.');
}

function mapTypeLabel(t: string): string {
  return t === 'ISLANDS' ? 'Inselkarte' : t === 'RIVER' ? 'Flusskarte' : 'Landkarte';
}
