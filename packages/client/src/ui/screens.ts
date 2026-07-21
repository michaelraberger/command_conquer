import {
  createGame,
  type AiDifficulty,
  type BalanceConfig,
  type CustomMapData,
  type Faction,
  type GameState,
  type MapType,
} from '@cac/sim';
import { fetchCareer } from '../net/careerRepo.js';
import { cloudEnabled } from '../net/supabase.js';
import { colorCss, paintMapData } from '../render/palette.js';
import { createMapPicker, type MapSelection } from './mapPicker.js';
import { buildStatsTable, formatTicks } from './statsTable.js';

/** Fixed seed for the start-screen thumbnails — a representative sample; the
 * actual match rolls its own seed, so details (blobs, islets) will vary. */
const PREVIEW_SEED = 1337;

type MapState = ReturnType<typeof createGame>;

/** Draws a top-down 1:1 map (terrain, resources, bases) into `ctx`. */
function paintMap(ctx: CanvasRenderingContext2D, state: MapState): void {
  paintMapData(ctx, state);
  for (const b of state.buildings) {
    // Neutral map furniture (bridge spans, ore drills) has no player record —
    // the terrain already shows it, only player bases get a colour dot.
    const owner = state.players[b.owner];
    if (!owner) continue;
    ctx.fillStyle = colorCss(owner.color);
    ctx.fillRect(b.cx - 1, b.cy - 1, 4, 4);
  }
}

/** Upscales the small painted source canvas into the blurred fullscreen bg. */
function blitStartBackground(small: HTMLCanvasElement): void {
  const bg = document.getElementById('start-bg') as HTMLCanvasElement | null;
  if (!bg) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  bg.width = w;
  bg.height = h;
  const ctx = bg.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; // smooth the chunky source into soft blobs
  const scale = Math.max(w / small.width, h / small.height);
  const dw = small.width * scale;
  const dh = small.height * scale;
  ctx.drawImage(small, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Full-map backdrop following the map choice: procedural maps render a fixed-
 * seed sample (with the chosen opponent count, so the bases hint at what's
 * coming); gallery maps paint their authored layers.
 */
function renderStartBackground(
  sel: MapSelection,
  opponents: number,
  mapSize: number,
  loadMap: () => Promise<CustomMapData | undefined>,
): void {
  const small = document.createElement('canvas');
  if (sel.kind === 'proc') {
    const state = createGame(PREVIEW_SEED, {
      mapType: sel.mapType,
      opponents,
      ai: true,
      mapWidth: mapSize,
      mapHeight: mapSize,
    });
    small.width = state.mapWidth;
    small.height = state.mapHeight;
    paintMap(small.getContext('2d')!, state);
    blitStartBackground(small);
    return;
  }
  void loadMap()
    .then((map) => {
      if (!map) return;
      small.width = map.width;
      small.height = map.height;
      paintMapData(small.getContext('2d')!, {
        mapWidth: map.width,
        mapHeight: map.height,
        terrain: map.terrain,
        ore: map.ore,
        resourceKind: map.resourceKind,
      });
      blitStartBackground(small);
    })
    .catch(() => undefined);
}

export interface StartChoice {
  faction: Faction;
  difficulty: AiDifficulty;
  mapType: MapType;
  /** Number of AI opponents (1–5). */
  opponents: number;
  /** Map side length in cells (48 klein / 64 normal / 96 groß). */
  mapSize: number;
  /** Hand-authored map from the gallery — overrides mapType/mapSize. */
  customMap?: CustomMapData | undefined;
  /** Display name of the map (for save-game metadata). */
  mapLabel?: string | undefined;
}

/** What the player chose on the start screen. */
export type StartAction =
  | { kind: 'skirmish'; choice: StartChoice }
  | {
      kind: 'resume';
      state: GameState;
      balance?: BalanceConfig | undefined;
      mapLabel?: string | undefined;
      /** Set when the save belongs to a campaign mission. */
      campaign?: import('../campaign/types.js').CampaignRef | undefined;
      /** Control groups stored in the save blob (digit → unit ids). */
      groups?: Record<string, number[]> | undefined;
    }
  | { kind: 'editor'; map?: CustomMapData | undefined; cloudId?: string | undefined }
  /** Campaign mission from the Kampagne panel (simDef pre-built + validated). */
  | {
      kind: 'campaign';
      mission: import('../campaign/types.js').CampaignMissionDef;
      simDef: import('@cac/sim').MissionDef;
    }
  /** Internet match: the lobby agreed on a MatchStart (see net/lobby.ts). */
  | { kind: 'multiplayer'; match: import('../net/lobby.js').MatchStart };

/** Blocking start screen; resolves once the player picks an action. */
export function showStartScreen(): Promise<StartAction> {
  const root = document.getElementById('start')!;
  root.style.display = 'flex';

  const faction = (): Faction =>
    (document.querySelector('input[name="faction"]:checked') as HTMLInputElement).value as Faction;
  const difficulty = (): AiDifficulty =>
    (document.querySelector('input[name="difficulty"]:checked') as HTMLInputElement)
      .value as AiDifficulty;
  const opponents = (): number =>
    Number((document.querySelector('input[name="opponents"]:checked') as HTMLInputElement).value);
  const mapSize = (): number =>
    Number((document.querySelector('input[name="mapsize"]:checked') as HTMLInputElement).value);

  const sizeRow = document.getElementById('sp-size-row')!;
  const mapHint = document.getElementById('sp-map-hint')!;

  // The map chooser (procedural + public gallery maps, list + big preview).
  const picker = createMapPicker(document.getElementById('sp-map-picker')!, {
    name: 'maptype',
    cloud: cloudEnabled(),
    getSize: mapSize,
    onChange: () => onMapChange(),
  });
  void picker.refreshCloud();

  // Blurred full-map backdrop that follows the map/opponent/size choice;
  // gallery maps bring their own size, so the size row greys out for them.
  const paintBackdrop = (): void =>
    renderStartBackground(picker.selection(), opponents(), mapSize(), picker.loadSelectedMap);
  const onMapChange = (): void => {
    const sel = picker.selection();
    sizeRow.classList.toggle('mp-disabled', sel.kind === 'cloud');
    mapHint.textContent =
      sel.kind === 'cloud' ? `Eigene Karte · max. ${sel.maxPlayers} Spieler` : '';
    paintBackdrop();
  };
  onMapChange();
  for (const input of document.querySelectorAll('input[name="opponents"]')) {
    input.addEventListener('change', paintBackdrop);
  }
  for (const input of document.querySelectorAll('input[name="mapsize"]')) {
    input.addEventListener('change', () => {
      picker.refreshPreview(); // procedural preview follows the size choice
      paintBackdrop();
    });
  }
  window.addEventListener('resize', paintBackdrop);

  // Classic main menu: stacked command bars; each entry opens its sub-view
  // with a back control (the panels used to be tabs).
  const panelEl = document.getElementById('start-panel')!;
  const mainMenu = document.getElementById('main-menu')!;
  const subHead = document.getElementById('sub-head')!;
  const subTitle = document.getElementById('sub-title')!;
  const panels: Record<string, { el: HTMLElement; title: string }> = {
    gefecht: { el: document.getElementById('tab-gefecht')!, title: 'Gefecht' },
    kampagne: { el: document.getElementById('tab-kampagne')!, title: 'Kampagne' },
    mehrspieler: { el: document.getElementById('tab-mehrspieler')!, title: 'Mehrspieler & Online' },
    karten: { el: document.getElementById('tab-karten')!, title: 'Karten-Galerie' },
    laden: { el: document.getElementById('tab-laden')!, title: 'Spiel laden' },
  };
  const backToMenu = (): void => {
    for (const p of Object.values(panels)) p.el.classList.remove('active');
    subHead.style.display = 'none';
    mainMenu.style.display = '';
    panelEl.classList.add('menu-mode');
  };
  const openPanel = (key: string): void => {
    const panel = panels[key];
    if (!panel) return;
    for (const [k, p] of Object.entries(panels)) p.el.classList.toggle('active', k === key);
    subTitle.textContent = panel.title;
    subHead.style.display = '';
    mainMenu.style.display = 'none';
    panelEl.classList.remove('menu-mode');
    startMenuHooks.onOpen[key]?.();
    if (key === 'gefecht') paintBackdrop(); // canvas may have been created hidden
  };
  for (const btn of mainMenu.querySelectorAll<HTMLButtonElement>('[data-menu]')) {
    btn.addEventListener('click', () => openPanel(btn.dataset['menu']!));
    // Online features need the cloud; Gefecht, Kampagne and Editor work offline.
    const offline = btn.dataset['menu'] === 'gefecht' || btn.dataset['menu'] === 'kampagne';
    if (!offline && !cloudEnabled()) btn.style.display = 'none';
  }
  document.getElementById('menu-back')!.addEventListener('click', backToMenu);
  document.getElementById('menu-news')!.addEventListener('click', () => {
    document.getElementById('changelog-link')?.click();
  });
  // Late-added panels (Kampagne) may navigate the menu programmatically —
  // e.g. jumping straight to the next mission's briefing after a reload.
  startMenuHooks.openPanel = openPanel;
  startMenuHooks.onShown?.();

  return new Promise((resolve) => {
    const finish = (action: StartAction): void => {
      root.style.display = 'none';
      resolve(action);
    };
    document.getElementById('start-ai')!.addEventListener('click', () => {
      const sel = picker.selection();
      const base = {
        faction: faction(),
        difficulty: difficulty(),
        opponents: opponents(),
        mapSize: mapSize(),
      };
      if (sel.kind === 'proc') {
        finish({ kind: 'skirmish', choice: { ...base, mapType: sel.mapType } });
        return;
      }
      // Gallery map: fetch the authored layers, cap the AI count at the
      // map's spawn capacity (the sim would clamp anyway — the UI is honest).
      void picker
        .loadSelectedMap()
        .then((map) => {
          if (!map) return;
          finish({
            kind: 'skirmish',
            choice: {
              ...base,
              opponents: Math.min(base.opponents, map.spawns.length - 1),
              mapType: map.mapType,
              mapSize: map.width,
              customMap: map,
              mapLabel: map.name,
            },
          });
        })
        .catch((err: unknown) => {
          mapHint.textContent = err instanceof Error ? err.message : String(err);
        });
    });
    document.getElementById('menu-editor')?.addEventListener('click', () => {
      finish({ kind: 'editor' });
    });
    startScreenHooks.onAction = finish;
  });
}

/** Lets later-added start-screen panels (gallery, save list) resolve the
 *  start promise without threading callbacks through showStartScreen. */
export const startScreenHooks: { onAction: ((action: StartAction) => void) | null } = {
  onAction: null,
};

/** Per-panel open callbacks (gallery/save list register their refreshers),
 *  plus programmatic navigation hooks for the Kampagne panel. */
export const startMenuHooks: {
  onOpen: Record<string, () => void>;
  /** Assigned by showStartScreen — opens a main-menu panel programmatically. */
  openPanel?: (key: string) => void;
  /** Fires once per showStartScreen, after the menu is wired. */
  onShown?: () => void;
} = {
  onOpen: {},
};

/** Victory/defeat overlay. */
export function showEndScreen(
  won: boolean,
  opts: {
    backToEditor?: boolean;
    campaign?: { nextMissionId?: string | undefined; missionId: string } | undefined;
    /** Match statistics: rendered as the score table below the headline. */
    stats?: { state: GameState; localPlayer: number } | undefined;
    /** Resolves once the career upsert finished — the career line waits for it
     *  so it shows the totals INCLUDING this match. */
    careerReady?: Promise<unknown> | undefined;
  } = {},
): void {
  const root = document.getElementById('end')!;
  root.style.display = 'flex';
  root.querySelector('h1')!.textContent = won ? 'SIEG!' : 'NIEDERLAGE';
  root.querySelector('h1')!.style.color = won ? '#53c94f' : '#e04a3a';
  document.getElementById('end-restart')!.addEventListener('click', () => location.reload());

  const statsHost = document.getElementById('end-stats');
  if (statsHost && opts.stats) {
    statsHost.replaceChildren(buildStatsTable(opts.stats.state, opts.stats.localPlayer));
  }
  // Career line, fire-and-forget: logged-out/offline/missing table → the
  // block simply never appears (fetchCareer throws only on real DB errors).
  const careerHost = document.getElementById('end-career');
  if (careerHost && opts.stats) {
    Promise.resolve(opts.careerReady)
      .then(() => fetchCareer())
      .then((career) => {
        if (!career) return;
        careerHost.textContent =
          `Karriere: ${career.games} Partien · ${career.wins} Siege · ` +
          `Spielzeit ${formatTicks(career.playtimeTicks)}`;
        careerHost.style.display = 'block';
      })
      .catch(() => undefined);
  }

  // After an editor test match: reload with the reopen flag, boot() then jumps
  // straight back into the editor (the draft lives in localStorage).
  const editorBtn = document.getElementById('end-editor') as HTMLButtonElement | null;
  if (editorBtn) {
    editorBtn.style.display = opts.backToEditor ? '' : 'none';
    editorBtn.addEventListener('click', () => {
      localStorage.setItem('cac-reopen', 'editor');
      location.reload();
    });
  }

  // Campaign: victory offers the next mission, defeat a retry — both via the
  // one-shot reload flag that campaignUi picks up on the next boot.
  const nextBtn = document.getElementById('end-next') as HTMLButtonElement | null;
  const retryBtn = document.getElementById('end-retry') as HTMLButtonElement | null;
  const jumpTo = (missionId: string): void => {
    localStorage.setItem('cac-campaign-next', missionId);
    location.reload();
  };
  if (nextBtn) {
    const nextId = won ? opts.campaign?.nextMissionId : undefined;
    nextBtn.style.display = nextId !== undefined ? '' : 'none';
    if (nextId !== undefined) nextBtn.addEventListener('click', () => jumpTo(nextId));
  }
  if (retryBtn) {
    const show = !won && opts.campaign !== undefined;
    retryBtn.style.display = show ? '' : 'none';
    if (show) retryBtn.addEventListener('click', () => jumpTo(opts.campaign!.missionId));
  }
}
