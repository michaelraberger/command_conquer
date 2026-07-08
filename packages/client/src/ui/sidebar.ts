import {
  BUILDING_RULES,
  FACTION_NAMES,
  SUPERWEAPON_CHARGE_TICKS,
  SUPERWEAPON_STATS,
  UNIT_RULES,
  WALL_LEVELS,
  availableToFaction,
  buildingMaxHp,
  buildingRule,
  isBuildingType,
  powerBalance,
  storageCapacity,
  techFor,
  techRule,
  TECH_RULES,
  sellRefund,
  unitRule,
  type BuildingType,
  type Command,
  type GameState,
  type ProductionCategory,
  type TechId,
  type Unit,
  type UnitType,
} from '@cac/sim';
import type { Controls } from '../input/controls.js';
import { session } from '../session.js';
import type { PlacementMode } from './placement.js';

const TABS: Array<{ key: ProductionCategory; label: string; short: string; icon: string }> = [
  { key: 'building', label: 'Gebäude', short: 'Bau', icon: '🏭' },
  { key: 'infantry', label: 'Infanterie', short: 'Inf.', icon: '👥' },
  { key: 'vehicle', label: 'Fahrzeuge', short: 'Fahr.', icon: '🚙' },
  { key: 'air', label: 'Luft', short: 'Luft', icon: '🚁' },
  { key: 'naval', label: 'See', short: 'See', icon: '⚓' },
];

interface ItemEl {
  root: HTMLElement;
  progress: HTMLElement;
  state: HTMLElement;
  item: string;
  category: ProductionCategory;
}

/** RA2-style tabbed build sidebar, driven directly from sim state. */
export class Sidebar {
  private activeTab: ProductionCategory = 'building';
  private itemEls: ItemEl[] = [];
  private creditsEl = document.getElementById('credits')!;
  private factionEl = document.getElementById('faction')!;
  private powerBarEl = document.getElementById('powerbar')!;
  private powerFillEl = document.getElementById('powerfill')!;
  private powerLabelEl = document.getElementById('powerlabel')!;
  private lowPowerEl = document.getElementById('lowpower')!;
  private tabsEl = document.getElementById('tabs')!;
  private itemsEl = document.getElementById('items')!;
  private binfoEl = document.getElementById('binfo')!;
  private lastBinfoKey = '';
  private swEl = document.getElementById('superweapon')!;
  private swFill = document.getElementById('sw-fill')!;
  private swLabel = document.getElementById('sw-label')!;
  private swButton = document.getElementById('sw-fire') as HTMLButtonElement;

  constructor(
    private state: GameState,
    private send: (cmd: Command) => void,
    private placement: PlacementMode,
    private controls: Controls,
  ) {
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.title = tab.label;
      const ico = document.createElement('span');
      ico.className = 'tab-ico';
      ico.textContent = tab.icon;
      const lbl = document.createElement('span');
      lbl.className = 'tab-lbl';
      lbl.textContent = tab.short;
      btn.append(ico, lbl);
      btn.addEventListener('click', () => {
        this.activeTab = tab.key;
        this.renderTabs();
        this.buildItems();
      });
      this.tabsEl.appendChild(btn);
    }
    this.factionEl.textContent = FACTION_NAMES[this.player().faction];
    this.swButton.addEventListener('click', () => {
      const silo = this.chargingSilo();
      if (silo && silo.charge >= SUPERWEAPON_CHARGE_TICKS) {
        this.placement.activateStrike(buildingRule(silo.type).superweapon!);
      }
    });
    this.renderTabs();
    this.buildItems();
  }

  /** The player's first superweapon silo, if any. */
  private chargingSilo() {
    return (
      this.state.buildings.find(
        (b) =>
          b.owner === session.localPlayer && buildingRule(b.type).superweapon !== null,
      ) ?? null
    );
  }

  private player() {
    return this.state.players[session.localPlayer]!;
  }

  private itemsForTab(): string[] {
    const faction = this.player().faction;
    if (this.activeTab === 'building') {
      const list = (Object.keys(BUILDING_RULES) as BuildingType[]).filter(
        (t) => BUILDING_RULES[t].buildable && availableToFaction(BUILDING_RULES[t].factions, faction),
      );
      return [...list, 'WALL']; // walls use the instant-placement flow
    }
    return (Object.keys(UNIT_RULES) as UnitType[]).filter(
      (t) =>
        UNIT_RULES[t].category === this.activeTab &&
        availableToFaction(UNIT_RULES[t].factions, faction),
    );
  }

  private renderTabs(): void {
    const buttons = this.tabsEl.querySelectorAll('button');
    TABS.forEach((tab, i) => buttons[i]!.classList.toggle('active', tab.key === this.activeTab));
  }

  private buildItems(): void {
    this.itemsEl.replaceChildren();
    this.itemEls = [];
    for (const item of this.itemsForTab()) {
      const rule = isBuildingType(item) ? buildingRule(item) : unitRule(item as UnitType);
      const root = document.createElement('div');
      root.className = 'item';
      const progress = document.createElement('div');
      progress.className = 'progress';
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = rule.name;
      const cost = document.createElement('span');
      cost.className = 'cost';
      cost.textContent = `$${rule.cost}`;
      row.append(name, cost);
      const stateEl = document.createElement('div');
      stateEl.className = 'state';
      root.append(progress, row);
      // Show each building's power draw/output right in the tile.
      if (isBuildingType(item) && buildingRule(item).power !== 0) {
        const power = buildingRule(item).power;
        const powerEl = document.createElement('div');
        powerEl.className = 'power';
        powerEl.textContent = `⚡ ${power > 0 ? '+' : '−'}${Math.abs(power)} Strom`;
        powerEl.style.color = power > 0 ? '#53c94f' : '#e0954a';
        root.append(powerEl);
      }
      root.append(stateEl);
      root.addEventListener('click', () => this.onItemClick(item));
      root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.onItemCancel(item);
      });
      this.itemsEl.appendChild(root);
      this.itemEls.push({ root, progress, state: stateEl, item, category: this.activeTab });
    }
  }

  private queue(category: ProductionCategory) {
    return this.player().queues[category];
  }

  private onItemClick(item: string): void {
    if (item === 'WALL') {
      this.placement.activate('WALL');
      return;
    }
    const q = this.queue(this.activeTab);
    if (q.item === item && q.ready && isBuildingType(item)) {
      this.placement.activate(item);
      return;
    }
    if (q.item !== null) return; // queue busy
    this.send({ type: 'BUILD_START', playerId: session.localPlayer, item });
  }

  private onItemCancel(item: string): void {
    const q = this.queue(this.activeTab);
    if (q.item === item) {
      this.send({ type: 'BUILD_CANCEL', playerId: session.localPlayer, category: this.activeTab });
      if (this.placement.active === item) this.placement.cancel();
    }
  }

  /** Called every frame; touches the DOM sparingly. */
  update(): void {
    const player = this.player();
    const cap = storageCapacity(this.state, session.localPlayer);
    const credits = `$ ${player.credits} / ${cap}`;
    if (this.creditsEl.textContent !== credits) this.creditsEl.textContent = credits;

    const { produced, used } = powerBalance(this.state, session.localPlayer);
    const deficit = used > produced;
    const pct = produced === 0 ? 0 : Math.min(100, Math.round((1 - used / Math.max(produced, 1)) * 100));
    this.powerFillEl.style.width = `${produced === 0 && used === 0 ? 100 : pct}%`;
    this.powerFillEl.style.background = deficit ? '#e04a3a' : '#53c94f';
    const label = `Strom ${used} / ${produced}${deficit ? ' – Defizit!' : ''}`;
    if (this.powerLabelEl.textContent !== label) this.powerLabelEl.textContent = label;
    // Flash the bar and raise the on-map warning while power is short.
    this.powerBarEl.classList.toggle('low', deficit);
    this.lowPowerEl.style.display = deficit ? 'flex' : 'none';

    for (const el of this.itemEls) {
      if (el.item === 'WALL') {
        const affordable = player.credits >= buildingRule('WALL').cost;
        el.root.classList.toggle('disabled', !affordable);
        el.root.classList.toggle('ready', this.placement.active === 'WALL');
        const text =
          this.placement.active === 'WALL'
            ? 'Platzieren … (Rechtsklick beendet)'
            : 'Sofortbau · mehrfach platzierbar';
        if (el.state.textContent !== text) el.state.textContent = text;
        continue;
      }
      const q = this.queue(el.category);
      const rule = isBuildingType(el.item) ? buildingRule(el.item) : unitRule(el.item as UnitType);
      const prereqsMet = rule.requires.every((req) =>
        this.state.buildings.some((b) => b.owner === session.localPlayer && b.type === req),
      );
      const tech = techFor(el.item);
      const techLocked = tech !== undefined && !player.researched.includes(tech);
      const isThis = q.item === el.item;
      const busy = q.item !== null && !isThis;

      el.root.classList.toggle('disabled', !prereqsMet || techLocked || busy);
      el.root.classList.toggle('ready', isThis && q.ready);
      el.progress.style.width =
        isThis && !q.ready ? `${Math.round((q.progress / rule.buildTime) * 100)}%` : '0%';

      let text = '';
      if (!prereqsMet) {
        text = `braucht ${rule.requires
          .filter((r) => !this.state.buildings.some((b) => b.owner === session.localPlayer && b.type === r))
          .map((r) => buildingRule(r as BuildingType).name)
          .join(', ')}`;
      } else if (techLocked) {
        text = `erforschen: ${techRule(tech).name}`;
      } else if (isThis && q.ready) {
        text = 'Bereit – klicken zum Platzieren';
      } else if (isThis) {
        text = `${Math.round((q.progress / rule.buildTime) * 100)} % … (Rechtsklick: Abbruch)`;
      } else if (busy) {
        text = 'Warteschlange belegt';
      }
      if (el.state.textContent !== text) el.state.textContent = text;
    }

    this.updateBuildingInfo();
    this.updateSuperweapon();
  }

  /** Charge bar + fire button for the player's superweapon. */
  private updateSuperweapon(): void {
    const silo = this.chargingSilo();
    if (!silo) {
      if (this.swEl.style.display !== 'none') this.swEl.style.display = 'none';
      return;
    }
    if (this.swEl.style.display !== 'block') this.swEl.style.display = 'block';
    const kind = buildingRule(silo.type).superweapon!;
    const pct = Math.min(100, Math.round((silo.charge / SUPERWEAPON_CHARGE_TICKS) * 100));
    const ready = silo.charge >= SUPERWEAPON_CHARGE_TICKS;
    this.swFill.style.width = `${pct}%`;
    const label = ready
      ? `${SUPERWEAPON_STATS[kind].name} BEREIT`
      : `${SUPERWEAPON_STATS[kind].name} lädt … ${pct}%`;
    if (this.swLabel.textContent !== label) this.swLabel.textContent = label;
    this.swButton.disabled = !ready;
    this.swButton.textContent =
      this.placement.strike !== null ? 'Ziel anklicken …' : 'Ziel wählen';
  }

  /** Info panel for the selected own building (wall upgrades, rally hint). */
  private updateBuildingInfo(): void {
    const id = this.controls.selectedBuilding;
    const building = id === null ? null : this.state.buildings.find((b) => b.id === id);
    if (!building) {
      this.updateUnitInfo();
      return;
    }
    const p = this.player();
    const researchKey =
      building.type === 'TECHCENTER'
        ? `:${p.researched.join(',')}:${p.research ? `${p.research.tech}${p.research.progress}` : '-'}`
        : '';
    const key = `${building.id}:${building.hp}:${building.level}:${p.credits}${researchKey}`;
    if (key === this.lastBinfoKey) return;
    this.lastBinfoKey = key;

    const rule = buildingRule(building.type);
    this.binfoEl.style.display = 'block';
    this.binfoEl.replaceChildren();
    const title = document.createElement('div');
    title.className = 'btitle';
    title.textContent =
      building.type === 'WALL' ? `${rule.name} (Stufe ${building.level})` : rule.name;
    const hp = document.createElement('div');
    hp.className = 'bhp';
    hp.textContent = `HP ${building.hp} / ${buildingMaxHp(building)}`;
    this.binfoEl.append(title, hp);

    if (building.type === 'WALL' && building.level < WALL_LEVELS.length) {
      const next = WALL_LEVELS[building.level]!;
      const btn = document.createElement('button');
      btn.className = 'bupgrade';
      btn.textContent = `Ausbauen → Stufe ${building.level + 1} ($${next.upgradeCost})`;
      btn.disabled = this.player().credits < next.upgradeCost;
      btn.addEventListener('click', () => {
        this.send({ type: 'UPGRADE_BUILDING', playerId: session.localPlayer, buildingId: building.id });
      });
      this.binfoEl.append(btn);
    }
    if (rule.produces !== null) {
      const hint = document.createElement('div');
      hint.className = 'bhint';
      hint.textContent = 'Rechtsklick auf Karte: Sammelpunkt';
      this.binfoEl.append(hint);
    }
    if (building.type === 'TECHCENTER') this.renderResearchMenu();

    const sell = document.createElement('button');
    sell.className = 'bsell';
    sell.textContent = `Verkaufen (+$${sellRefund(building.type, building.level)})`;
    sell.addEventListener('click', () => {
      this.send({ type: 'SELL_BUILDING', playerId: session.localPlayer, buildingId: building.id });
      this.controls.selectedBuilding = null;
    });
    this.binfoEl.append(sell);
  }

  /** Research picker shown when a Techzentrum is selected: pick one tech to
   *  research (cost + time), or watch/cancel the one in progress. */
  private renderResearchMenu(): void {
    const p = this.player();
    if (p.research !== null) {
      const rule = techRule(p.research.tech);
      const pct = Math.round((p.research.progress / rule.time) * 100);
      const label = document.createElement('div');
      label.className = 'bhint';
      label.textContent = `Forschung: ${rule.name} — ${pct} %`;
      const bar = document.createElement('div');
      bar.style.cssText = 'height:6px;background:#232b35;border-radius:3px;overflow:hidden;margin:4px 0';
      const fill = document.createElement('div');
      fill.style.cssText = `height:100%;width:${pct}%;background:#4da6ff`;
      bar.append(fill);
      const cancel = document.createElement('button');
      cancel.className = 'bsell';
      cancel.textContent = 'Forschung abbrechen';
      cancel.addEventListener('click', () =>
        this.send({ type: 'RESEARCH_CANCEL', playerId: session.localPlayer }),
      );
      this.binfoEl.append(label, bar, cancel);
      return;
    }
    const heading = document.createElement('div');
    heading.className = 'bhint';
    heading.textContent = 'Forschung wählen:';
    this.binfoEl.append(heading);
    let any = false;
    for (const id of Object.keys(TECH_RULES) as TechId[]) {
      if (p.researched.includes(id)) continue;
      const rule = techRule(id);
      if (!availableToFaction(rule.factions, p.faction)) continue;
      any = true;
      const btn = document.createElement('button');
      btn.className = 'bupgrade';
      const mins = Math.max(1, Math.round(rule.time / (60 * 15)));
      btn.textContent = `${rule.name} ($${rule.cost}, ~${mins} min)`;
      btn.disabled = p.credits < 1;
      btn.addEventListener('click', () =>
        this.send({ type: 'RESEARCH_START', playerId: session.localPlayer, tech: id }),
      );
      this.binfoEl.append(btn);
    }
    if (!any) {
      const done = document.createElement('div');
      done.className = 'bhint';
      done.textContent = 'Alles erforscht.';
      this.binfoEl.append(done);
    }
  }

  /** Shows what the current unit selection is: a single unit's name + hp, or a
   *  by-type breakdown for a group. Shares the #binfo panel with buildings. */
  private updateUnitInfo(): void {
    const units = [...this.controls.selected]
      .map((uid) => this.state.units.find((u) => u.id === uid))
      .filter((u): u is Unit => u !== undefined);
    if (units.length === 0) {
      if (this.lastBinfoKey !== '') {
        this.binfoEl.replaceChildren();
        this.binfoEl.style.display = 'none';
        this.lastBinfoKey = '';
      }
      return;
    }
    // Tally by type (ascending id order is already deterministic).
    const counts = new Map<UnitType, number>();
    for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
    const key = `u:${[...counts].map(([t, n]) => `${t}${n}`).join(',')}:${
      units.length === 1 ? units[0]!.hp : ''
    }`;
    if (key === this.lastBinfoKey) return;
    this.lastBinfoKey = key;

    this.binfoEl.style.display = 'block';
    this.binfoEl.replaceChildren();
    const title = document.createElement('div');
    title.className = 'btitle';
    if (counts.size === 1) {
      const [type, n] = [...counts][0]!;
      title.textContent = n === 1 ? unitRule(type).name : `${unitRule(type).name} ×${n}`;
    } else {
      title.textContent = `${units.length} Einheiten`;
    }
    this.binfoEl.append(title);

    if (units.length === 1) {
      const hp = document.createElement('div');
      hp.className = 'bhp';
      hp.textContent = `HP ${units[0]!.hp} / ${unitRule(units[0]!.type).maxHp}`;
      this.binfoEl.append(hp);
    } else {
      const list = document.createElement('div');
      list.className = 'bhint';
      list.textContent = [...counts].map(([t, n]) => `${unitRule(t).name} ×${n}`).join(', ');
      this.binfoEl.append(list);
    }

    // MCV(s) selected → offer to deploy into a construction yard.
    const mcvIds = units.filter((u) => u.type === 'MCV').map((u) => u.id);
    if (mcvIds.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'bupgrade';
      btn.textContent = 'Entfalten → Bauhof (D)';
      btn.addEventListener('click', () =>
        this.send({ type: 'DEPLOY', playerId: session.localPlayer, unitIds: mcvIds }),
      );
      this.binfoEl.append(btn);
    }
  }
}
