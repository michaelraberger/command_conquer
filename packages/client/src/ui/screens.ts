import {
  createGame,
  type AiDifficulty,
  type BalanceConfig,
  type CustomMapData,
  type Faction,
  type GameState,
  type MapType,
} from '@cac/sim';
import { colorCss, paintMapData } from '../render/palette.js';

/** Fixed seed for the start-screen thumbnails — a representative sample; the
 * actual match rolls its own seed, so details (blobs, islets) will vary. */
const PREVIEW_SEED = 1337;

type MapState = ReturnType<typeof createGame>;

/** Draws a top-down 1:1 map (terrain, resources, bases) into `ctx`. */
function paintMap(ctx: CanvasRenderingContext2D, state: MapState): void {
  paintMapData(ctx, state);
  for (const b of state.buildings) {
    ctx.fillStyle = colorCss(state.players[b.owner]!.color);
    ctx.fillRect(b.cx - 1, b.cy - 1, 4, 4);
  }
}

/** Paints a top-down thumbnail (terrain, resources, HQ spots) per map card. */
function renderMapPreviews(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas.map-preview');
  for (const canvas of canvases) {
    const state = createGame(PREVIEW_SEED, { mapType: canvas.dataset['maptype'] as MapType });
    canvas.width = state.mapWidth;
    canvas.height = state.mapHeight;
    paintMap(canvas.getContext('2d')!, state);
  }
}

/**
 * Full-map backdrop: renders the selected map (with the chosen opponent count,
 * so the bases hint at what's coming) upscaled to fill the screen. It's blurred
 * and darkened in CSS, so a chunky source is fine.
 */
function renderStartBackground(mapType: MapType, opponents: number, mapSize: number): void {
  const bg = document.getElementById('start-bg') as HTMLCanvasElement | null;
  if (!bg) return;
  const state = createGame(PREVIEW_SEED, {
    mapType,
    opponents,
    ai: true,
    mapWidth: mapSize,
    mapHeight: mapSize,
  });
  const small = document.createElement('canvas');
  small.width = state.mapWidth;
  small.height = state.mapHeight;
  paintMap(small.getContext('2d')!, state);

  const w = window.innerWidth;
  const h = window.innerHeight;
  bg.width = w;
  bg.height = h;
  const ctx = bg.getContext('2d')!;
  ctx.imageSmoothingEnabled = true; // smooth the 64² source into soft blobs
  const scale = Math.max(w / small.width, h / small.height);
  const dw = small.width * scale;
  const dh = small.height * scale;
  ctx.drawImage(small, (w - dw) / 2, (h - dh) / 2, dw, dh);
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
    }
  | { kind: 'editor'; map?: CustomMapData | undefined; cloudId?: string | undefined };

/** Blocking start screen; resolves once the player picks an action. */
export function showStartScreen(): Promise<StartAction> {
  const root = document.getElementById('start')!;
  root.style.display = 'flex';
  renderMapPreviews();

  const faction = (): Faction =>
    (document.querySelector('input[name="faction"]:checked') as HTMLInputElement).value as Faction;
  const difficulty = (): AiDifficulty =>
    (document.querySelector('input[name="difficulty"]:checked') as HTMLInputElement)
      .value as AiDifficulty;
  const mapType = (): MapType =>
    (document.querySelector('input[name="maptype"]:checked') as HTMLInputElement).value as MapType;
  const opponents = (): number =>
    Number((document.querySelector('input[name="opponents"]:checked') as HTMLInputElement).value);
  const mapSize = (): number =>
    Number((document.querySelector('input[name="mapsize"]:checked') as HTMLInputElement).value);

  // Blurred full-map backdrop that follows the map/opponent/size choice.
  const paintBackdrop = (): void => renderStartBackground(mapType(), opponents(), mapSize());
  paintBackdrop();
  for (const input of document.querySelectorAll(
    'input[name="maptype"], input[name="opponents"], input[name="mapsize"]',
  )) {
    input.addEventListener('change', paintBackdrop);
  }
  window.addEventListener('resize', paintBackdrop);

  return new Promise((resolve) => {
    const finish = (action: StartAction): void => {
      root.style.display = 'none';
      resolve(action);
    };
    document.getElementById('start-ai')!.addEventListener('click', () => {
      finish({
        kind: 'skirmish',
        choice: {
          faction: faction(),
          difficulty: difficulty(),
          mapType: mapType(),
          opponents: opponents(),
          mapSize: mapSize(),
        },
      });
    });
    document.getElementById('start-editor')?.addEventListener('click', () => {
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

/** Victory/defeat overlay. */
export function showEndScreen(won: boolean, opts: { backToEditor?: boolean } = {}): void {
  const root = document.getElementById('end')!;
  root.style.display = 'flex';
  root.querySelector('h1')!.textContent = won ? 'SIEG!' : 'NIEDERLAGE';
  root.querySelector('h1')!.style.color = won ? '#53c94f' : '#e04a3a';
  document.getElementById('end-restart')!.addEventListener('click', () => location.reload());

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
}
