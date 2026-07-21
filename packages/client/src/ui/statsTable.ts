import {
  TICKS_PER_SECOND,
  buildingRule,
  unitRule,
  type BuildingType,
  type GameState,
  type PlayerStats,
  type UnitType,
} from '@cac/sim';

/**
 * Pure builders for the match statistics table — shared by the end screen and
 * the in-game Tab overlay. Everything here only READS the state; rendering is
 * plain DOM (no pixi), styled via .stats-table in index.html.
 */

/** Sum of a per-type stat record. */
export function statTotal(rec: Partial<Record<string, number>>): number {
  let sum = 0;
  for (const key in rec) sum += rec[key] ?? 0;
  return sum;
}

/** Game clock as mm:ss, or h:mm:ss beyond an hour. */
export function formatTicks(ticks: number): string {
  const totalSec = Math.floor(ticks / TICKS_PER_SECOND);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60) % 60;
  const hrs = Math.floor(totalSec / 3600);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${min}:${ss}`;
}

/** Career aggregate persisted per account (jsonb column `totals`). */
export interface CareerTotals {
  unitsKilled: number;
  unitsLost: number;
  unitsProduced: number;
  buildingsKilled: number;
  buildingsLost: number;
  buildingsBuilt: number;
  healingDone: number;
  creditsHarvested: number;
  cratesCollected: number;
}

export function statsToTotals(stats: PlayerStats): CareerTotals {
  return {
    unitsKilled: statTotal(stats.unitsKilled),
    unitsLost: statTotal(stats.unitsLost),
    unitsProduced: statTotal(stats.unitsProduced),
    buildingsKilled: statTotal(stats.buildingsKilled),
    buildingsLost: statTotal(stats.buildingsLost),
    buildingsBuilt: statTotal(stats.buildingsBuilt),
    healingDone: stats.healingDone,
    creditsHarvested: stats.creditsHarvested,
    cratesCollected: stats.cratesCollected,
  };
}

const nf = new Intl.NumberFormat('de-AT');

function td(text: string, cls?: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (cls) cell.className = cls;
  return cell;
}

function unitName(t: string): string {
  return unitRule(t as UnitType).name;
}
function buildingName(t: string): string {
  return buildingRule(t as BuildingType).name;
}

/** "Panzer ×3 · Schütze ×2" — one per-type record, pretty names, sorted desc. */
function breakdownLine(rec: Partial<Record<string, number>>, nameOf: (t: string) => string): string {
  const parts = Object.entries(rec)
    .filter((e): e is [string, number] => (e[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${nameOf(t)} ×${nf.format(n)}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/**
 * The match table: one row per (non-neutral) player with the core columns,
 * plus a collapsible <details> per-type breakdown underneath each row.
 */
export function buildStatsTable(state: GameState, localPlayer: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'stats-table';

  const clock = document.createElement('div');
  clock.className = 'stats-clock';
  clock.textContent = `Spielzeit ${formatTicks(state.tick)}`;
  wrap.appendChild(clock);

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const [label, cls] of [
    ['', 'name'],
    ['Kills', 'num'],
    ['Verluste', 'num'],
    ['Produziert', 'num'],
    ['Gebäude', 'num'],
    ['Geheilt', 'num'],
    ['Credits', 'num'],
    ['Kisten', 'num'],
  ] as const) {
    const cell = document.createElement('th');
    cell.textContent = label;
    cell.className = cls;
    head.appendChild(cell);
  }
  table.appendChild(head);

  for (const p of state.players) {
    const s = p.stats;
    const row = document.createElement('tr');
    if (p.id === localPlayer) row.className = 'me';

    const nameCell = td('', 'name');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
    nameCell.appendChild(dot);
    nameCell.appendChild(document.createTextNode(p.name + (p.surrendered ? ' (aufgegeben)' : '')));
    row.appendChild(nameCell);

    row.appendChild(td(nf.format(statTotal(s.unitsKilled) + statTotal(s.buildingsKilled)), 'num'));
    row.appendChild(td(nf.format(statTotal(s.unitsLost) + statTotal(s.buildingsLost)), 'num'));
    row.appendChild(td(nf.format(statTotal(s.unitsProduced)), 'num'));
    row.appendChild(td(nf.format(statTotal(s.buildingsBuilt)), 'num'));
    row.appendChild(td(nf.format(s.healingDone), 'num'));
    row.appendChild(td(nf.format(s.creditsHarvested), 'num'));
    row.appendChild(td(nf.format(s.cratesCollected), 'num'));
    table.appendChild(row);

    const detailRow = document.createElement('tr');
    detailRow.className = 'detail';
    const detailCell = document.createElement('td');
    detailCell.colSpan = 8;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Aufschlüsselung nach Typ';
    details.appendChild(summary);
    const lines: Array<[string, string]> = [
      ['Einheiten zerstört', breakdownLine(s.unitsKilled, unitName)],
      ['Gebäude zerstört', breakdownLine(s.buildingsKilled, buildingName)],
      ['Einheiten verloren', breakdownLine(s.unitsLost, unitName)],
      ['Gebäude verloren', breakdownLine(s.buildingsLost, buildingName)],
      ['Einheiten produziert', breakdownLine(s.unitsProduced, unitName)],
      ['Gebäude gebaut', breakdownLine(s.buildingsBuilt, buildingName)],
    ];
    for (const [label, text] of lines) {
      const line = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.appendChild(strong);
      line.appendChild(document.createTextNode(text));
      details.appendChild(line);
    }
    detailCell.appendChild(details);
    detailRow.appendChild(detailCell);
    table.appendChild(detailRow);
  }

  wrap.appendChild(table);
  return wrap;
}
