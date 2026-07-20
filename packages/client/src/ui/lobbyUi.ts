import { FACTION_NAMES, FACTIONS, type Faction } from '@cac/sim';
import { displayName } from '../net/auth.js';
import {
  Lobby,
  MAX_SEATS,
  type LobbyPlayer,
  type LobbySettings,
  type MatchStart,
} from '../net/lobby.js';
import { authUser, onUserChange } from './authUi.js';
import {
  MAP_TYPE_LABELS,
  createMapPicker,
  paintSelectionPreview,
  type MapPicker,
} from './mapPicker.js';
import { startScreenHooks } from './screens.js';

/** Seat dot tints — mirrors the sim's MP_COLORS (seat order = lobby order). */
const SEAT_COLORS = ['#3aa0ff', '#e04a3a', '#5fd873', '#f2d33c'];

/**
 * "Mehrspieler" start-screen tab. Three states: login gate → create/join
 * choice → lobby (code, players, map). The map picker is the same card grid
 * as the skirmish form; the agreed MatchStart leaves through
 * startScreenHooks.onAction like every other start path.
 */
export function initLobbyUi(): void {
  const loginHint = document.getElementById('mp-login-hint')!;
  const entry = document.getElementById('mp-entry')!;
  const lobbyView = document.getElementById('mp-lobby')!;
  const errorEl = document.getElementById('mp-error')!;
  const lobbyErrorEl = document.getElementById('mp-lobby-error')!;
  const codeEl = document.getElementById('mp-code')!;
  const codeInput = document.getElementById('mp-code-input') as HTMLInputElement;
  const playersEl = document.getElementById('mp-players')!;
  const hostSettings = document.getElementById('mp-settings-host')!;
  const guestSettings = document.getElementById('mp-settings-guest')!;
  const startBtn = document.getElementById('mp-start') as HTMLButtonElement;
  const statusEl = document.getElementById('mp-status')!;
  const createBtn = document.getElementById('mp-create') as HTMLButtonElement;
  const joinBtn = document.getElementById('mp-join') as HTMLButtonElement;
  const copyBtn = document.getElementById('mp-copy') as HTMLButtonElement;
  const sizeRow = document.getElementById('mp-size-row')!;
  const mapHint = document.getElementById('mp-map-hint')!;

  let lobby: Lobby | null = null;
  let picker: MapPicker | null = null;
  let playerCount = 0;
  let maxSeats = MAX_SEATS;

  const showEntry = (message = ''): void => {
    lobby = null;
    lobbyView.style.display = 'none';
    entry.style.display = authUser() ? '' : 'none';
    loginHint.style.display = authUser() ? 'none' : '';
    errorEl.textContent = message;
    createBtn.disabled = false;
    joinBtn.disabled = false;
  };

  const playerRow = (p: LobbyPlayer | null, seat: number, selfId: string): HTMLElement => {
    const row = document.createElement('div');
    row.className = p ? 'mp-player-row' : 'mp-player-row mp-empty';
    const dot = document.createElement('span');
    dot.className = 'mp-dot';
    if (p) dot.style.background = SEAT_COLORS[seat % SEAT_COLORS.length]!;
    const name = document.createElement('span');
    name.className = 'mp-name';
    name.textContent = p ? p.username : 'Freier Platz — Code weitergeben';
    row.append(dot, name);
    if (!p) return row;
    if (p.userId === selfId) {
      const select = document.createElement('select');
      for (const f of FACTIONS) {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = FACTION_NAMES[f];
        opt.selected = f === p.faction;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => {
        void lobby?.setFaction(select.value as Faction);
      });
      row.append(select);
    } else {
      const fac = document.createElement('span');
      fac.textContent = FACTION_NAMES[p.faction] ?? p.faction;
      row.append(fac);
    }
    if (p.host) {
      const badge = document.createElement('span');
      badge.className = 'mp-host-badge';
      badge.textContent = 'Host';
      row.append(badge);
    }
    return row;
  };

  const updateStatus = (isHost: boolean): void => {
    if (isHost) {
      startBtn.disabled = playerCount < 2;
      statusEl.textContent =
        playerCount < 2
          ? 'Es fehlt noch mindestens ein Mitspieler — teile den Code.'
          : playerCount > maxSeats
            ? `Die gewählte Karte erlaubt nur ${maxSeats} Spieler.`
            : '';
    } else {
      statusEl.textContent = 'Warte, bis der Host das Spiel startet …';
    }
  };

  const renderPlayers = (players: LobbyPlayer[], selfId: string, isHost: boolean): void => {
    playerCount = players.length;
    playersEl.replaceChildren();
    players.forEach((p, seat) => playersEl.append(playerRow(p, seat, selfId)));
    // Show the remaining open slots so the host sees the room isn't full.
    for (let seat = players.length; seat < Math.min(MAX_SEATS, maxSeats); seat++) {
      playersEl.append(playerRow(null, seat, selfId));
    }
    updateStatus(isHost);
  };

  const renderGuestSettings = (settings: LobbySettings): void => {
    guestSettings.replaceChildren();
    const box = document.createElement('div');
    box.className = 'mp-guest-map';
    const canvas = document.createElement('canvas');
    canvas.className = 'mp-guest-preview';
    paintSelectionPreview(canvas, settings);
    const title = document.createElement('div');
    if (settings.cloudMap) {
      title.textContent = settings.cloudMap.name;
      const sub = document.createElement('small');
      sub.textContent = `Karte aus der Galerie · max. ${settings.cloudMap.maxPlayers} Spieler`;
      title.append(sub);
    } else {
      title.textContent = MAP_TYPE_LABELS[settings.mapType] ?? settings.mapType;
      const sub = document.createElement('small');
      const sizeLabel =
        settings.mapSize === 96
          ? 'Klein'
          : settings.mapSize === 144
            ? 'Normal'
            : settings.mapSize === 192
              ? 'Groß'
              : `${settings.mapSize} × ${settings.mapSize}`;
      sub.textContent = `Größe: ${sizeLabel}`;
      title.append(sub);
    }
    box.append(canvas, title);
    guestSettings.append(box);
  };

  const currentHostSettings = (): LobbySettings => {
    const sel = picker?.selection() ?? { kind: 'proc' as const, mapType: 'BADLANDS' as const };
    const mapSize = Number(
      (document.querySelector('input[name="mp-mapsize"]:checked') as HTMLInputElement).value,
    );
    if (sel.kind === 'cloud') {
      return {
        mapType: 'BADLANDS', // ignored by the sim with a custom map
        mapSize,
        cloudMap: { id: sel.id, name: sel.name, maxPlayers: sel.maxPlayers },
      };
    }
    return { mapType: sel.mapType, mapSize, cloudMap: null };
  };

  const pushHostSettings = (): void => {
    if (!lobby?.isHost) return;
    const settings = currentHostSettings();
    maxSeats = settings.cloudMap?.maxPlayers ?? MAX_SEATS;
    sizeRow.classList.toggle('mp-disabled', settings.cloudMap !== null);
    mapHint.textContent = settings.cloudMap
      ? `Karte aus der Galerie · max. ${settings.cloudMap.maxPlayers} Spieler`
      : '';
    lobby.setSettings(settings);
    updateStatus(true);
  };

  const enterLobby = (l: Lobby): void => {
    lobby = l;
    maxSeats = MAX_SEATS;
    entry.style.display = 'none';
    lobbyView.style.display = '';
    lobbyErrorEl.textContent = '';
    codeEl.textContent = l.code;
    copyBtn.textContent = 'Code kopieren';
    hostSettings.style.display = l.isHost ? '' : 'none';
    guestSettings.style.display = l.isHost ? 'none' : '';
    startBtn.style.display = l.isHost ? '' : 'none';
    startBtn.disabled = true;
    updateStatus(l.isHost);
    if (l.isHost) {
      picker = createMapPicker(document.getElementById('mp-map-picker')!, {
        name: 'mp-maptype',
        cloud: true,
        onChange: pushHostSettings,
      });
      void picker.refreshCloud().then(pushHostSettings);
      pushHostSettings();
    }
  };

  const events = (selfId: string, isHost: boolean) => ({
    onPlayers: (players: LobbyPlayer[]) => renderPlayers(players, selfId, isHost),
    onSettings: (settings: LobbySettings) => {
      if (!isHost) {
        maxSeats = settings.cloudMap?.maxPlayers ?? MAX_SEATS;
        renderGuestSettings(settings);
      }
    },
    onStart: (match: MatchStart) => {
      startScreenHooks.onAction?.({ kind: 'multiplayer', match });
    },
    onClosed: (reason: string) => showEntry(reason),
  });

  createBtn.addEventListener('click', () => {
    const user = authUser();
    if (!user) return;
    createBtn.disabled = true;
    errorEl.textContent = '';
    const self = { userId: user.id, username: displayName(user) };
    Lobby.create(self, events(user.id, true)).then(
      (l) => enterLobby(l),
      (err: unknown) => showEntry(err instanceof Error ? err.message : String(err)),
    );
  });

  const join = (): void => {
    const user = authUser();
    if (!user) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      errorEl.textContent = 'Der Code hat 6 Zeichen.';
      return;
    }
    joinBtn.disabled = true;
    errorEl.textContent = '';
    const self = { userId: user.id, username: displayName(user) };
    Lobby.join(code, self, events(user.id, false)).then(
      (l) => enterLobby(l),
      (err: unknown) => showEntry(err instanceof Error ? err.message : String(err)),
    );
  };
  joinBtn.addEventListener('click', join);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });

  for (const input of document.querySelectorAll('input[name="mp-mapsize"]')) {
    input.addEventListener('change', pushHostSettings);
  }

  startBtn.addEventListener('click', () => {
    if (!lobby || playerCount < 2) return;
    startBtn.disabled = true;
    void import('../main.js').then(async ({ loadBalance }) => {
      const error = lobby?.startWith(await loadBalance()) ?? null;
      if (error) {
        lobbyErrorEl.textContent = error;
        startBtn.disabled = false;
      }
    });
  });

  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(codeEl.textContent ?? '').then(() => {
      copyBtn.textContent = 'Kopiert ✓';
      window.setTimeout(() => {
        copyBtn.textContent = 'Code kopieren';
      }, 1500);
    });
  });

  document.getElementById('mp-leave')!.addEventListener('click', () => {
    void lobby?.leave();
    showEntry();
  });

  // Login gate: multiplayer needs an account (Realtime rides on the session).
  document.getElementById('mp-login-btn')!.addEventListener('click', () => {
    document.getElementById('auth-open')?.click();
  });
  onUserChange(() => {
    if (!lobby) showEntry();
  });
  showEntry();
}
