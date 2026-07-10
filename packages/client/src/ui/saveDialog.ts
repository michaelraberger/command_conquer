import type { GameState } from '@cac/sim';
import type { Hotkeys } from '../input/hotkeys.js';
import { currentUser } from '../net/auth.js';
import { saveGame } from '../net/savesRepo.js';
import { cloudEnabled } from '../net/supabase.js';
import type { GameMeta } from '../main.js';

/**
 * In-game save dialog (F6). Pauses the sim while open (via the public
 * `hotkeys.paused` flag, without the pause overlay); serialization happens on
 * the main thread between ticks, so the snapshot is always tick-consistent.
 */
export function initSaveDialog(state: GameState, hotkeys: Hotkeys, meta: GameMeta): void {
  const dialog = document.getElementById('save-dialog')!;
  const nameInput = document.getElementById('save-name') as HTMLInputElement;
  const error = document.getElementById('save-error')!;
  const confirmBtn = document.getElementById('save-confirm') as HTMLButtonElement;

  let wasPaused = false;

  const close = (): void => {
    dialog.style.display = 'none';
    hotkeys.paused = wasPaused;
  };

  const open = (): void => {
    if (dialog.style.display === 'flex') return;
    wasPaused = hotkeys.paused;
    hotkeys.paused = true;
    dialog.style.display = 'flex';
    error.textContent = '';
    confirmBtn.disabled = false;
    nameInput.value = `Spielstand ${new Date().toLocaleString('de')}`;
    if (!cloudEnabled()) {
      error.textContent = 'Cloud nicht konfiguriert (siehe supabase/README.md).';
      confirmBtn.disabled = true;
      return;
    }
    void currentUser().then((user) => {
      if (!user) {
        error.textContent = 'Anmeldung erforderlich — Spielstände speichern geht nur mit Konto.';
        confirmBtn.disabled = true;
      }
    });
    nameInput.focus();
    nameInput.select();
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F6') {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && dialog.style.display === 'flex') {
      close();
    }
  });

  document.getElementById('save-cancel')!.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    void (async () => {
      confirmBtn.disabled = true;
      error.textContent = '';
      try {
        await saveGame(nameInput.value, state, meta.balance, meta.mapLabel);
        close();
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        confirmBtn.disabled = false;
      }
    })();
  });
}
