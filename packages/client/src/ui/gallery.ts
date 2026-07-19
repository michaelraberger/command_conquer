import { deserialize, type AiDifficulty, type Faction } from '@cac/sim';
import { gunzipFromBase64 } from '../net/gzip.js';
import { deleteMap, getMap, myMaps, publicMaps, setPublic, type MapRow } from '../net/mapsRepo.js';
import { deleteSave, listSaves, loadSaveData } from '../net/savesRepo.js';
import { cloudEnabled } from '../net/supabase.js';
import { paintMapData } from '../render/palette.js';
import { authUser, onUserChange } from './authUi.js';
import { startScreenHooks } from './screens.js';

/**
 * Start-panel tabs: Gefecht (the classic skirmish form), Karten (own + public
 * custom maps) and Laden (cloud saves). Only shown when Supabase is configured;
 * guests still get the Karten tab to play public maps.
 */
export function initStartTabs(): void {
  if (!cloudEnabled()) return;

  const nav = document.getElementById('start-tabs')!;
  nav.style.display = 'flex';
  const panels: Record<string, HTMLElement> = {
    gefecht: document.getElementById('tab-gefecht')!,
    mehrspieler: document.getElementById('tab-mehrspieler')!,
    karten: document.getElementById('tab-karten')!,
    laden: document.getElementById('tab-laden')!,
  };
  for (const btn of nav.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    btn.addEventListener('click', () => {
      for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b === btn);
      for (const [key, panel] of Object.entries(panels)) {
        panel.classList.toggle('active', key === btn.dataset['tab']);
      }
      if (btn.dataset['tab'] === 'karten') void refreshMaps();
      if (btn.dataset['tab'] === 'laden') void refreshSaves();
    });
  }

  onUserChange(() => {
    // Re-render on login/logout when a cloud tab is open.
    if (panels['karten']!.classList.contains('active')) void refreshMaps();
    if (panels['laden']!.classList.contains('active')) void refreshSaves();
  });
}

/** Current skirmish settings from the Gefecht fieldsets (shared with custom maps). */
function currentSettings(): { faction: Faction; difficulty: AiDifficulty; opponents: number } {
  const pick = (name: string): string =>
    (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement).value;
  return {
    faction: pick('faction') as Faction,
    difficulty: pick('difficulty') as AiDifficulty,
    opponents: Number(pick('opponents')),
  };
}

// --- Karten tab --------------------------------------------------------------

async function refreshMaps(): Promise<void> {
  const mineWrap = document.getElementById('my-maps')!;
  const mineHeading = document.getElementById('my-maps-heading')!;
  const publicWrap = document.getElementById('public-maps')!;

  const loggedIn = authUser() !== null;
  mineWrap.style.display = loggedIn ? '' : 'none';
  mineHeading.style.display = loggedIn ? '' : 'none';

  if (loggedIn) {
    mineWrap.innerHTML = '<div class="list-empty">Lade …</div>';
    try {
      renderMapList(mineWrap, await myMaps(), true, 'Noch keine eigenen Karten — baue eine im Karteneditor!');
    } catch (err) {
      mineWrap.innerHTML = `<div class="list-empty">${errText(err)}</div>`;
    }
  }
  publicWrap.innerHTML = '<div class="list-empty">Lade …</div>';
  try {
    renderMapList(publicWrap, await publicMaps(), false, 'Noch keine öffentlichen Karten.');
  } catch (err) {
    publicWrap.innerHTML = `<div class="list-empty">${errText(err)}</div>`;
  }
}

function renderMapList(wrap: HTMLElement, rows: MapRow[], own: boolean, emptyText: string): void {
  wrap.innerHTML = '';
  if (rows.length === 0) {
    wrap.innerHTML = `<div class="list-empty">${emptyText}</div>`;
    return;
  }
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'list-row';
    el.innerHTML = `
      <canvas width="${row.width}" height="${row.height}"></canvas>
      <div class="grow">
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <div class="actions"></div>`;
    el.querySelector('.title')!.textContent = row.name;
    el.querySelector('.meta')!.textContent =
      `${row.width}×${row.height} · max. ${row.max_players} Spieler · von ${row.author}` +
      (own ? (row.is_public ? ' · öffentlich' : ' · privat') : '');

    // Preview lazily from the full map data (cheap paint, no createGame).
    void getMap(row.id)
      .then((map) => {
        const canvas = el.querySelector('canvas')!;
        paintMapData(canvas.getContext('2d')!, {
          mapWidth: map.width,
          mapHeight: map.height,
          terrain: map.terrain,
          ore: map.ore,
          resourceKind: map.resourceKind,
        });
      })
      .catch(() => undefined);

    const actions = el.querySelector('.actions')!;
    const btn = (label: string, subtle: boolean, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      if (subtle) b.className = 'subtle';
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };

    btn('Spielen', false, () => {
      void (async () => {
        try {
          const map = await getMap(row.id);
          const settings = currentSettings();
          startScreenHooks.onAction?.({
            kind: 'skirmish',
            choice: {
              ...settings,
              opponents: Math.min(settings.opponents, map.spawns.length - 1),
              mapType: map.mapType,
              mapSize: map.width,
              customMap: map,
              mapLabel: map.name,
            },
          });
        } catch (err) {
          alert(errText(err));
        }
      })();
    });
    if (own) {
      btn('Bearbeiten', true, () => {
        void (async () => {
          try {
            const map = await getMap(row.id);
            startScreenHooks.onAction?.({ kind: 'editor', map, cloudId: row.id });
          } catch (err) {
            alert(errText(err));
          }
        })();
      });
      btn(row.is_public ? 'Privat schalten' : 'Veröffentlichen', true, () => {
        void setPublic(row.id, !row.is_public)
          .then(refreshMaps)
          .catch((err: unknown) => alert(errText(err)));
      });
      btn('Löschen', true, () => {
        if (!confirm(`Karte „${row.name}" wirklich löschen?`)) return;
        void deleteMap(row.id)
          .then(refreshMaps)
          .catch((err: unknown) => alert(errText(err)));
      });
    }
    wrap.appendChild(el);
  }
}

// --- Laden tab ---------------------------------------------------------------

async function refreshSaves(): Promise<void> {
  const wrap = document.getElementById('save-list')!;
  if (authUser() === null) {
    wrap.innerHTML = '<div class="list-empty">Zum Laden von Spielständen bitte anmelden.</div>';
    return;
  }
  wrap.innerHTML = '<div class="list-empty">Lade …</div>';
  let rows;
  try {
    rows = await listSaves();
  } catch (err) {
    wrap.innerHTML = `<div class="list-empty">${errText(err)}</div>`;
    return;
  }
  wrap.innerHTML = '';
  if (rows.length === 0) {
    wrap.innerHTML =
      '<div class="list-empty">Keine Spielstände. Im Spiel mit F6 (oder über das Menü) speichern.</div>';
    return;
  }
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'list-row';
    const minutes = Math.round(row.tick / 15 / 60);
    el.innerHTML = `
      <div class="grow">
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <div class="actions"></div>`;
    el.querySelector('.title')!.textContent = row.name;
    el.querySelector('.meta')!.textContent =
      `${row.map_label ?? 'Unbekannte Karte'} · ${minutes} min Spielzeit · ${new Date(row.created_at).toLocaleString('de')}`;

    const actions = el.querySelector('.actions')!;
    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Laden';
    loadBtn.addEventListener('click', () => {
      void (async () => {
        try {
          loadBtn.disabled = true;
          loadBtn.textContent = 'Lade …';
          const state = deserialize(await gunzipFromBase64(await loadSaveData(row.id)));
          startScreenHooks.onAction?.({
            kind: 'resume',
            state,
            balance: row.balance ?? undefined,
            mapLabel: row.map_label ?? undefined,
          });
        } catch (err) {
          loadBtn.disabled = false;
          loadBtn.textContent = 'Laden';
          alert(errText(err));
        }
      })();
    });
    actions.appendChild(loadBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Löschen';
    delBtn.className = 'subtle';
    delBtn.addEventListener('click', () => {
      if (!confirm(`Spielstand „${row.name}" wirklich löschen?`)) return;
      void deleteSave(row.id)
        .then(refreshSaves)
        .catch((err: unknown) => alert(errText(err)));
    });
    actions.appendChild(delBtn);
    wrap.appendChild(el);
  }
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
