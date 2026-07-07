import {
  DEFAULT_SERVER_PORT,
  RESOURCE_GEMS,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  TERRAIN_TREE,
  TERRAIN_WATER,
  createGame,
  type AiDifficulty,
  type Faction,
  type MapType,
} from '@cac/sim';
import { parseReplay, type ReplayFile } from '../replay.js';

/** Fixed seed for the start-screen thumbnails — a representative sample; the
 * actual match rolls its own seed, so details (blobs, islets) will vary. */
const PREVIEW_SEED = 1337;

/** Paints a top-down thumbnail (terrain, resources, HQ spots) per map card. */
function renderMapPreviews(): void {
  const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas.map-preview');
  for (const canvas of canvases) {
    const state = createGame(PREVIEW_SEED, { mapType: canvas.dataset['maptype'] as MapType });
    canvas.width = state.mapWidth;
    canvas.height = state.mapHeight;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(state.mapWidth, state.mapHeight);
    for (let i = 0; i < state.terrain.length; i++) {
      const t = state.terrain[i]!;
      const [r, g, b] =
        t === TERRAIN_WATER
          ? [43, 93, 138]
          : t === TERRAIN_ROCK
            ? [125, 122, 114]
            : t === TERRAIN_TREE
              ? [46, 74, 30]
              : t === TERRAIN_GRASS
                ? [77, 122, 53]
                : [138, 111, 77];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    for (let i = 0; i < state.ore.length; i++) {
      if (state.ore[i]! === 0) continue;
      ctx.fillStyle = state.resourceKind[i] === RESOURCE_GEMS ? '#9d7bff' : '#d9a62e';
      ctx.fillRect(i % state.mapWidth, Math.floor(i / state.mapWidth), 1, 1);
    }
    for (const b of state.buildings) {
      ctx.fillStyle = `#${state.players[b.owner]!.color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(b.cx - 1, b.cy - 1, 4, 4);
    }
  }
}

export type StartChoice =
  | { mode: 'ai'; faction: Faction; difficulty: AiDifficulty; mapType: MapType }
  | { mode: 'host'; faction: Faction; url: string; mapType: MapType }
  | { mode: 'join'; faction: Faction; url: string; code: string }
  | { mode: 'replay'; file: ReplayFile };

/** Blocking start screen; resolves once the player picks a game mode. */
export function showStartScreen(): Promise<StartChoice> {
  const root = document.getElementById('start')!;
  root.style.display = 'flex';
  renderMapPreviews();
  const urlInput = document.getElementById('mp-url') as HTMLInputElement;
  if (!urlInput.value) urlInput.value = `ws://${location.hostname}:${DEFAULT_SERVER_PORT}`;

  const faction = (): Faction =>
    (document.querySelector('input[name="faction"]:checked') as HTMLInputElement).value as Faction;
  const difficulty = (): AiDifficulty =>
    (document.querySelector('input[name="difficulty"]:checked') as HTMLInputElement)
      .value as AiDifficulty;
  const mapType = (): MapType =>
    (document.querySelector('input[name="maptype"]:checked') as HTMLInputElement).value as MapType;

  return new Promise((resolve) => {
    const done = (choice: StartChoice): void => {
      root.style.display = 'none';
      resolve(choice);
    };
    document.getElementById('start-ai')!.addEventListener('click', () => {
      done({ mode: 'ai', faction: faction(), difficulty: difficulty(), mapType: mapType() });
    });
    document.getElementById('mp-host')!.addEventListener('click', () => {
      done({ mode: 'host', faction: faction(), url: urlInput.value.trim(), mapType: mapType() });
    });
    document.getElementById('mp-join')!.addEventListener('click', () => {
      const code = (document.getElementById('mp-code') as HTMLInputElement).value.trim().toUpperCase();
      if (code) done({ mode: 'join', faction: faction(), url: urlInput.value.trim(), code });
    });

    const fileInput = document.getElementById('replay-file') as HTMLInputElement;
    document.getElementById('replay-open')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        done({ mode: 'replay', file: parseReplay(await file.text()) });
      } catch {
        setLobbyStatus('Keine gültige Replay-Datei.');
      }
    });
  });
}

/** Lobby status line on the start overlay (host code, connection state). */
export function setLobbyStatus(text: string): void {
  const el = document.getElementById('mp-status')!;
  el.textContent = text;
  document.getElementById('start')!.style.display = 'flex';
}

export function hideStartScreen(): void {
  document.getElementById('start')!.style.display = 'none';
}

/** Victory/defeat overlay (with replay download when a recorder exists). */
export function showEndScreen(won: boolean, onSaveReplay: (() => void) | null): void {
  const root = document.getElementById('end')!;
  root.style.display = 'flex';
  root.querySelector('h1')!.textContent = won ? 'SIEG!' : 'NIEDERLAGE';
  root.querySelector('h1')!.style.color = won ? '#53c94f' : '#e04a3a';
  const saveBtn = document.getElementById('end-replay') as HTMLButtonElement;
  saveBtn.style.display = onSaveReplay ? 'block' : 'none';
  if (onSaveReplay) saveBtn.addEventListener('click', onSaveReplay);
  document.getElementById('end-restart')!.addEventListener('click', () => location.reload());
}
