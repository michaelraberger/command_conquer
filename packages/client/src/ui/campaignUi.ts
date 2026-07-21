import { validateMissionDef } from '@cac/sim';
import {
  CAMPAIGNS,
  CAMPAIGN_IDS,
  CAMPAIGN_LENGTH,
  getMission,
  type CampaignId,
  type CampaignMissionDef,
} from '../campaign/index.js';
import { completedCount, isCompleted, isUnlocked, onProgressChange } from '../campaign/progress.js';
import { cloudEnabled } from '../net/supabase.js';
import { paintMapData } from '../render/palette.js';
import { onUserChange } from './authUi.js';
import { startMenuHooks, startScreenHooks } from './screens.js';

/**
 * "Kampagne" main-menu panel: faction choice → mission list (with lock/
 * completion state) → briefing → mission start. Fully offline-capable; the
 * cloud only mirrors progress when a user is logged in (net/campaignRepo.ts).
 */

/** localStorage flag: the end screen requests this mission after the reload. */
export const CAMPAIGN_NEXT_KEY = 'cac-campaign-next';

let selected: CampaignId = 'allies';
let view: 'factions' | 'missions' | 'briefing' = 'factions';

export function initCampaignUi(): void {
  startMenuHooks.onOpen['kampagne'] = () => renderFactions();

  // Progress changed (mission completed, cloud sync): refresh the list views
  // in place — never yank an open briefing away.
  onProgressChange(() => {
    if (!document.getElementById('tab-kampagne')!.classList.contains('active')) return;
    if (view === 'factions') renderFactions();
    else if (view === 'missions') renderMissions();
  });

  if (cloudEnabled()) {
    const sync = (): void =>
      void import('../net/campaignRepo.js')
        .then(({ syncProgress }) => syncProgress())
        .catch(() => undefined);
    onUserChange(sync);
    sync();
  }

  // "Nächste Mission"/"Erneut versuchen" from the end screen: the page just
  // reloaded — jump straight to that mission's briefing.
  startMenuHooks.onShown = () => {
    const next = localStorage.getItem(CAMPAIGN_NEXT_KEY);
    if (!next) return;
    localStorage.removeItem(CAMPAIGN_NEXT_KEY);
    const mission = getMission(next);
    if (!mission) return;
    selected = mission.campaign;
    startMenuHooks.openPanel?.('kampagne');
    renderBriefing(mission);
  };
}

const show = (next: 'factions' | 'missions' | 'briefing'): void => {
  view = next;
  document.getElementById('camp-factions')!.style.display = next === 'factions' ? '' : 'none';
  document.getElementById('camp-missions')!.style.display = next === 'missions' ? '' : 'none';
  document.getElementById('camp-briefing')!.style.display = next === 'briefing' ? '' : 'none';
};

function renderFactions(): void {
  const wrap = document.getElementById('camp-factions')!;
  wrap.replaceChildren();
  for (const id of CAMPAIGN_IDS) {
    const missions = CAMPAIGNS[id].missions;
    const done = completedCount(id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `camp-card camp-${id}`;
    card.innerHTML = `
      <span class="camp-card-title"></span>
      <span class="camp-card-sub"></span>
      <span class="camp-card-progress"></span>`;
    card.querySelector('.camp-card-title')!.textContent =
      id === 'allies' ? 'Alliierte' : 'Sowjets';
    card.querySelector('.camp-card-sub')!.textContent =
      id === 'allies'
        ? 'Präzision, Technologie, Luftüberlegenheit'
        : 'Masse, Panzerstahl, Tesla-Gewalt';
    card.querySelector('.camp-card-progress')!.textContent =
      `${done} / ${CAMPAIGN_LENGTH} Missionen · ${missions.length} verfügbar`;
    card.addEventListener('click', () => {
      selected = id;
      renderMissions();
    });
    wrap.appendChild(card);
  }
  show('factions');
}

function renderMissions(): void {
  const wrap = document.getElementById('camp-missions')!;
  wrap.replaceChildren();

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'subtle camp-back';
  back.textContent = '◄ Fraktion wählen';
  back.addEventListener('click', renderFactions);
  wrap.appendChild(back);

  const heading = document.createElement('h3');
  heading.className = `list-heading camp-${selected}`;
  heading.textContent = CAMPAIGNS[selected].title;
  wrap.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'list';
  const missions = CAMPAIGNS[selected].missions;
  const ids = missions.map((m) => m.id);
  missions.forEach((mission, i) => {
    const unlocked = isUnlocked(selected, ids, i);
    const done = isCompleted(selected, mission.id);
    const row = document.createElement('div');
    row.className = 'list-row camp-mission-row';
    if (!unlocked) row.classList.add('locked');
    row.innerHTML = `
      <span class="camp-state"></span>
      <div class="grow">
        <div class="title"></div>
        <div class="meta"></div>
      </div>
      <div class="actions"></div>`;
    row.querySelector('.camp-state')!.textContent = done ? '✔' : unlocked ? '▶' : '🔒';
    row.querySelector('.title')!.textContent = mission.title;
    row.querySelector('.meta')!.textContent = unlocked
      ? mission.tagline
      : `Gesperrt — schließe zuerst Mission ${i} ab.`;
    if (unlocked) {
      const btn = document.createElement('button');
      btn.textContent = 'Briefing';
      btn.addEventListener('click', () => renderBriefing(mission));
      row.querySelector('.actions')!.appendChild(btn);
    }
    list.appendChild(row);
  });
  // Missions beyond the shipped batch: visible teaser rows, clearly locked.
  for (let i = missions.length; i < CAMPAIGN_LENGTH; i++) {
    const row = document.createElement('div');
    row.className = 'list-row camp-mission-row locked';
    row.innerHTML = `<span class="camp-state">🔒</span><div class="grow"><div class="title"></div><div class="meta">Folgt in einem späteren Update.</div></div>`;
    row.querySelector('.title')!.textContent = `Mission ${i + 1}`;
    list.appendChild(row);
  }
  wrap.appendChild(list);
  show('missions');
}

function renderBriefing(mission: CampaignMissionDef): void {
  const wrap = document.getElementById('camp-briefing')!;
  wrap.replaceChildren();

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'subtle camp-back';
  back.textContent = '◄ Missionsliste';
  back.addEventListener('click', renderMissions);
  wrap.appendChild(back);

  const head = document.createElement('div');
  head.className = `camp-brief-head camp-${mission.campaign}`;
  head.innerHTML = `<div class="camp-brief-kicker">EINSATZBESPRECHUNG</div><h3></h3>`;
  head.querySelector('h3')!.textContent = mission.title;
  wrap.appendChild(head);

  const def = mission.makeSimDef();

  const body = document.createElement('div');
  body.className = 'camp-brief-body';

  const preview = document.createElement('canvas');
  preview.className = 'camp-brief-map';
  preview.width = def.map.width;
  preview.height = def.map.height;
  paintMapData(preview.getContext('2d')!, {
    mapWidth: def.map.width,
    mapHeight: def.map.height,
    terrain: def.map.terrain,
    ore: def.map.ore,
    resourceKind: def.map.resourceKind,
  });
  body.appendChild(preview);

  const text = document.createElement('div');
  text.className = 'camp-brief-text';
  for (const para of mission.briefing) {
    const p = document.createElement('p');
    p.textContent = para;
    text.appendChild(p);
  }
  const objHead = document.createElement('div');
  objHead.className = 'field-label';
  objHead.textContent = 'Missionsziele';
  text.appendChild(objHead);
  const objList = document.createElement('ul');
  objList.className = 'camp-brief-objectives';
  for (const obj of def.objectives) {
    if (obj.hidden === true) continue; // surprises stay surprises
    const li = document.createElement('li');
    if (obj.optional === true) li.classList.add('bonus');
    li.textContent = mission.objectiveTexts[obj.id] ?? obj.id;
    objList.appendChild(li);
  }
  text.appendChild(objList);
  body.appendChild(text);
  wrap.appendChild(body);

  const startBtn = document.createElement('button');
  startBtn.textContent = 'Mission starten';
  startBtn.className = 'camp-start';
  startBtn.addEventListener('click', () => {
    const check = validateMissionDef(def);
    if (!check.ok) {
      alert(`Missionsdaten fehlerhaft:\n${check.errors.join('\n')}`);
      return;
    }
    startScreenHooks.onAction?.({ kind: 'campaign', mission, simDef: def });
  });
  wrap.appendChild(startBtn);
  show('briefing');
}
