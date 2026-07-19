import type { RemoteDriverEvents } from '../net/lockstep.js';

const TOAST_MS = 5000;

/**
 * In-game multiplayer overlays: the "waiting for players" veil, drop toasts
 * and the fatal end states (disconnect/desync/abort). Pure DOM, wired as the
 * RemoteDriver's event sink.
 */
export function createMpOverlay(): RemoteDriverEvents {
  const wait = document.getElementById('mp-wait')!;
  const waitNames = document.getElementById('mp-wait-names')!;
  const fatal = document.getElementById('mp-fatal')!;
  const fatalTitle = document.getElementById('mp-fatal-title')!;
  const fatalText = document.getElementById('mp-fatal-text')!;
  const toast = document.getElementById('mp-toast')!;
  let toastTimer: number | null = null;

  document.getElementById('mp-fatal-back')!.addEventListener('click', () => location.reload());

  const showFatal = (title: string, text: string): void => {
    wait.style.display = 'none';
    fatalTitle.textContent = title;
    fatalText.textContent = text;
    fatal.style.display = 'flex';
  };

  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.style.display = 'block';
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.style.display = 'none';
    }, TOAST_MS);
  };

  return {
    onWaiting: (names) => {
      if (names === null) {
        wait.style.display = 'none';
      } else {
        waitNames.textContent = names.join(', ');
        wait.style.display = 'flex';
      }
    },
    onPlayerDropped: (name) => showToast(`${name} hat das Spiel verlassen.`),
    onDesync: () =>
      showFatal('Desynchronisiert', 'Die Spielstände sind auseinandergelaufen — die Partie wurde beendet.'),
    onSelfDisconnected: () =>
      showFatal('Verbindung getrennt', 'Du wurdest aus dem Spiel entfernt.'),
    onAborted: (reason) => showFatal('Partie beendet', reason),
  };
}
