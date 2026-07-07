import { DEFAULT_SERVER_PORT, type AiDifficulty, type Faction } from '@cac/sim';
import { parseReplay, type ReplayFile } from '../replay.js';

export type StartChoice =
  | { mode: 'ai'; faction: Faction; difficulty: AiDifficulty }
  | { mode: 'host'; faction: Faction; url: string }
  | { mode: 'join'; faction: Faction; url: string; code: string }
  | { mode: 'replay'; file: ReplayFile };

/** Blocking start screen; resolves once the player picks a game mode. */
export function showStartScreen(): Promise<StartChoice> {
  const root = document.getElementById('start')!;
  root.style.display = 'flex';
  const urlInput = document.getElementById('mp-url') as HTMLInputElement;
  if (!urlInput.value) urlInput.value = `ws://${location.hostname}:${DEFAULT_SERVER_PORT}`;

  const faction = (): Faction =>
    (document.querySelector('input[name="faction"]:checked') as HTMLInputElement).value as Faction;
  const difficulty = (): AiDifficulty =>
    (document.querySelector('input[name="difficulty"]:checked') as HTMLInputElement)
      .value as AiDifficulty;

  return new Promise((resolve) => {
    const done = (choice: StartChoice): void => {
      root.style.display = 'none';
      resolve(choice);
    };
    document.getElementById('start-ai')!.addEventListener('click', () => {
      done({ mode: 'ai', faction: faction(), difficulty: difficulty() });
    });
    document.getElementById('mp-host')!.addEventListener('click', () => {
      done({ mode: 'host', faction: faction(), url: urlInput.value.trim() });
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
