import {
  BUILDING_RULES,
  FACTION_NAMES,
  PARADROP_COOLDOWN_TICKS,
  SUPERWEAPON_CHARGE_TICKS,
  SUPERWEAPON_STATS,
  UNIT_RULES,
  WALL_LEVELS,
  availableToFaction,
  buildingMaxHp,
  buildingRule,
  findFreeAirfield,
  isBuildingType,
  powerBalance,
  satisfiesRequirement,
  storageCapacity,
  techFor,
  techRule,
  TECH_RULES,
  sellRefund,
  unitRule,
  type Building,
  type BuildingType,
  type Command,
  type GameState,
  type ProductionCategory,
  type SuperweaponKind,
  type TechId,
  type Unit,
  type UnitType,
} from '@cac/sim';
import type { Controls } from '../input/controls.js';
import { session } from '../session.js';
import type { PlacementMode, StrikeKind } from './placement.js';

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
  /** In-place refreshers for fast-changing panel bits (progress bars, button
   *  states). Running these instead of rebuilding keeps buttons clickable. */
  private binfoUpdaters: Array<() => void> = [];
  private swEl = document.getElementById('superweapon')!;
  private repairBtn = document.getElementById('repair-toggle') as HTMLButtonElement;
  /** One row (label + charge bar + fire button) per owned support power:
   *  one per superweapon SILO (keyed `sw:<buildingId>`, so two Raketensilos
   *  charge and fire independently) plus the paradrop (keyed 'PARADROP'). */
  private swRows = new Map<
    string,
    { root: HTMLElement; fill: HTMLElement; label: HTMLElement; button: HTMLButtonElement }
  >();

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
    // Wrench toggle: enter/leave the building self-repair mode.
    this.repairBtn.addEventListener('click', () => {
      if (this.placement.repair) this.placement.cancel();
      else this.placement.activateRepair();
    });
    this.renderTabs();
    this.buildItems();
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
        unitRule(t).hidden !== true && // scripted units (paradrop plane)
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
      const prereqsMet =
        player.motherload ||
        rule.requires.every((req) =>
          this.state.buildings.some(
            (b) => b.owner === session.localPlayer && satisfiesRequirement(b.type, req),
          ),
        );
      const tech = techFor(el.item);
      const techLocked =
        !player.motherload && tech !== undefined && !player.researched.includes(tech);
      // Unique buildings (Eiserner Vorhang): one standing instance per player.
      const uniqueBuilt =
        isBuildingType(el.item) &&
        buildingRule(el.item).unique === true &&
        this.state.buildings.some(
          (b) => b.owner === session.localPlayer && b.type === el.item,
        );
      // Airfield-bound jets: one per Flugfeld — with every field taken (or
      // none standing) the sim refuses the order, so grey the button out.
      // Not bypassed by motherload (the physical cap always holds).
      const noAirfield =
        !isBuildingType(el.item) &&
        unitRule(el.item as UnitType).airfieldBound === true &&
        findFreeAirfield(this.state, session.localPlayer) === null;
      const isThis = q.item === el.item;
      const busy = q.item !== null && !isThis;

      el.root.classList.toggle(
        'disabled',
        !prereqsMet || techLocked || busy || uniqueBuilt || noAirfield,
      );
      el.root.classList.toggle('ready', isThis && q.ready);
      el.progress.style.width =
        isThis && !q.ready ? `${Math.round((q.progress / rule.buildTime) * 100)}%` : '0%';

      let text = '';
      if (uniqueBuilt) {
        text = 'Nur einmal baubar – steht bereits';
      } else if (!prereqsMet) {
        text = `braucht ${rule.requires
          .filter(
            (r) =>
              !this.state.buildings.some(
                (b) => b.owner === session.localPlayer && satisfiesRequirement(b.type, r),
              ),
          )
          .map((r) => buildingRule(r as BuildingType).name)
          .join(', ')}`;
      } else if (techLocked) {
        text = `erforschen: ${techRule(tech).name}`;
      } else if (noAirfield) {
        text = 'Kein Flugfeld frei – weiteres Flugfeld bauen';
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
    // Wrench pressed-state mirrors the placement mode (Escape/right-click
    // leaves it without going through this button).
    this.repairBtn.classList.toggle('pressed', this.placement.repair);
  }

  /** Charge bar + fire button per superweapon SILO the player owns — two
   *  Raketensilos charge and fire independently (each gets its own row), and
   *  Soviets can field Raketensilo AND Eiserner Vorhang side by side. */
  private updateSuperweapon(): void {
    const silos: Building[] = [];
    for (const b of this.state.buildings) {
      if (b.owner !== session.localPlayer) continue;
      if (buildingRule(b.type).superweapon === null) continue;
      silos.push(b);
    }
    silos.sort((a, b) => a.id - b.id); // stable row order
    // Paradrop row: shown while a Flugfeld stands (per-player cooldown).
    const hasAirfield = this.state.buildings.some(
      (b) => b.owner === session.localPlayer && b.type === 'FLUGFELD',
    );
    const liveKeys = new Set(silos.map((s) => `sw:${s.id}`));
    for (const [key, row] of this.swRows) {
      const stale = key === 'PARADROP' ? !hasAirfield : !liveKeys.has(key);
      if (stale) {
        row.root.remove();
        this.swRows.delete(key);
      }
    }
    const show = silos.length > 0 || hasAirfield ? 'block' : 'none';
    if (this.swEl.style.display !== show) this.swEl.style.display = show;
    // Number rows only when a kind exists more than once ("Atomrakete 2").
    const kindCounts = new Map<SuperweaponKind, number>();
    for (const silo of silos) {
      const kind = buildingRule(silo.type).superweapon!;
      kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    }
    const kindSeen = new Map<SuperweaponKind, number>();
    for (const silo of silos) {
      const kind = buildingRule(silo.type).superweapon!;
      const nth = (kindSeen.get(kind) ?? 0) + 1;
      kindSeen.set(kind, nth);
      const row = this.swRows.get(`sw:${silo.id}`) ?? this.createSwRow(`sw:${silo.id}`, kind);
      const pct = Math.min(100, Math.round((silo.charge / SUPERWEAPON_CHARGE_TICKS) * 100));
      const ready = silo.charge >= SUPERWEAPON_CHARGE_TICKS;
      row.fill.style.width = `${pct}%`;
      const name =
        (kindCounts.get(kind) ?? 1) > 1
          ? `${SUPERWEAPON_STATS[kind].name} ${nth}`
          : SUPERWEAPON_STATS[kind].name;
      const label = ready ? `${name} BEREIT` : `${name} lädt … ${pct}%`;
      if (row.label.textContent !== label) row.label.textContent = label;
      row.button.disabled = !ready;
      const btnText =
        this.placement.strike === kind && ready ? 'Ziel anklicken …' : 'Ziel wählen';
      if (row.button.textContent !== btnText) row.button.textContent = btnText;
    }
    if (hasAirfield) {
      const row = this.swRows.get('PARADROP') ?? this.createSwRow('PARADROP', 'PARADROP');
      const cd = this.player().paradropCooldown;
      const pct = Math.round(((PARADROP_COOLDOWN_TICKS - cd) / PARADROP_COOLDOWN_TICKS) * 100);
      const ready = cd === 0;
      row.fill.style.width = `${pct}%`;
      const label = ready ? 'Luftlandung BEREIT' : `Luftlandung lädt … ${pct}%`;
      if (row.label.textContent !== label) row.label.textContent = label;
      row.button.disabled = !ready;
      const btnText = this.placement.strike === 'PARADROP' ? 'Ziel anklicken …' : 'Ziel wählen';
      if (row.button.textContent !== btnText) row.button.textContent = btnText;
    }
  }

  private createSwRow(key: string, kind: StrikeKind) {
    const root = document.createElement('div');
    root.className = 'sw-row';
    const label = document.createElement('div');
    label.className = 'sw-label';
    const bar = document.createElement('div');
    bar.className = 'sw-bar';
    const fill = document.createElement('div');
    fill.className = 'sw-fill';
    bar.appendChild(fill);
    const button = document.createElement('button');
    button.className = 'sw-fire';
    button.disabled = true;
    button.textContent = 'Ziel wählen';
    button.addEventListener('click', () => {
      if (kind === 'PARADROP') {
        if (this.player().paradropCooldown === 0) this.placement.activateStrike('PARADROP');
        return;
      }
      const charged = this.state.buildings.some(
        (b) =>
          b.owner === session.localPlayer &&
          buildingRule(b.type).superweapon === kind &&
          b.charge >= SUPERWEAPON_CHARGE_TICKS,
      );
      if (charged) this.placement.activateStrike(kind);
    });
    root.append(label, bar, button);
    this.swEl.appendChild(root);
    const row = { root, fill, label, button };
    this.swRows.set(key, row);
    return row;
  }

  /** Appends an "Ausbauen" button that stays affordability-gated in place. */
  private appendUpgradeButton(buildingId: number, label: string, cost: number): void {
    const btn = document.createElement('button');
    btn.className = 'bupgrade';
    btn.textContent = label;
    const affordable = (): void => {
      btn.disabled = this.player().credits < cost;
    };
    affordable();
    this.binfoUpdaters.push(affordable);
    btn.addEventListener('click', () => {
      this.send({ type: 'UPGRADE_BUILDING', playerId: session.localPlayer, buildingId });
    });
    this.binfoEl.append(btn);
  }

  /** Shows an animated "Ausbau … X%" bar while an in-place upgrade runs. */
  private appendUpgradeProgress(buildingId: number, targetName: string, buildTime: number): void {
    const label = document.createElement('div');
    label.className = 'bprog-label';
    const bar = document.createElement('div');
    bar.className = 'bprog-bar';
    const fill = document.createElement('div');
    fill.className = 'bprog-fill';
    bar.append(fill);
    this.binfoEl.append(label, bar);
    const refresh = (): void => {
      const b = this.state.buildings.find((x) => x.id === buildingId);
      const prog = b?.upgrade?.progress ?? buildTime;
      const pct = Math.min(100, Math.round((prog / buildTime) * 100));
      label.textContent = `Ausbau → ${targetName} … ${pct}%`;
      fill.style.width = `${pct}%`;
    };
    refresh();
    this.binfoUpdaters.push(refresh);
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
    // The key must only change on STRUCTURAL changes. Fast-changing values
    // (credits, research progress) are updated in place via binfoUpdaters —
    // rebuilding the panel every tick would destroy buttons mid-click.
    const researchKey =
      building.type === 'TECHCENTER'
        ? `:${p.researched.join(',')}:${p.research ? p.research.tech : '-'}`
        : '';
    const upgKey = building.upgrade ? `:up→${building.upgrade.to}` : '';
    const key = `${building.id}:${building.type}:${building.hp}:${building.level}${upgKey}${researchKey}`;
    if (key === this.lastBinfoKey) {
      for (const update of this.binfoUpdaters) update();
      return;
    }
    this.lastBinfoKey = key;
    this.binfoUpdaters = [];

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

    if (building.upgrade) {
      // Upgrade running: animate a progress bar in place until it finishes.
      const target = buildingRule(building.upgrade.to);
      this.appendUpgradeProgress(building.id, target.name, target.buildTime);
    } else if (building.type === 'WALL' && building.level < WALL_LEVELS.length) {
      const next = WALL_LEVELS[building.level]!;
      this.appendUpgradeButton(
        building.id,
        `Ausbauen → Stufe ${building.level + 1} ($${next.upgradeCost})`,
        next.upgradeCost,
      );
    } else if (rule.upgradeTo !== undefined && rule.upgradeCost !== undefined) {
      const targetName = buildingRule(rule.upgradeTo as BuildingType).name;
      this.appendUpgradeButton(building.id, `Ausbauen → ${targetName} ($${rule.upgradeCost})`, rule.upgradeCost);
    }
    if (rule.produces !== null) {
      const hint = document.createElement('div');
      hint.className = 'bhint';
      hint.textContent = 'Rechtsklick auf Karte: Sammelpunkt — Einheiten spawnen dann hier';
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
   *  research (cost + time), or watch/cancel the one in progress. The progress
   *  bar/label update in place (binfoUpdaters) so the panel is NOT rebuilt each
   *  tick — a rebuild would destroy the cancel button mid-click. */
  private renderResearchMenu(): void {
    const p = this.player();
    if (p.research !== null) {
      const startedTech = p.research.tech;
      const rule = techRule(startedTech);
      const label = document.createElement('div');
      label.className = 'bhint';
      const bar = document.createElement('div');
      bar.style.cssText = 'height:6px;background:#232b35;border-radius:3px;overflow:hidden;margin:4px 0';
      const fill = document.createElement('div');
      fill.style.cssText = 'height:100%;width:0%;background:#4da6ff';
      bar.append(fill);
      const refresh = (): void => {
        const r = this.player().research;
        if (r === null || r.tech !== startedTech) return; // key change rebuilds next frame
        const pct = Math.round((r.progress / rule.time) * 100);
        const text = `Forschung: ${rule.name} — ${pct} %`;
        if (label.textContent !== text) label.textContent = text;
        fill.style.width = `${pct}%`;
      };
      refresh();
      this.binfoUpdaters.push(refresh);
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
      // No credits gate: research may start broke — the cost drains over time.
      btn.textContent = `${rule.name} ($${rule.cost}, ~${mins} min)`;
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
    this.binfoUpdaters = []; // stale building-panel refreshers must not run here

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
      // Combat aircraft: show the sortie ammo (empty planes fly home to rearm).
      const maxAmmo = unitRule(units[0]!.type).ammo;
      if (maxAmmo !== undefined) {
        const ammo = document.createElement('div');
        ammo.className = 'bhp';
        ammo.textContent = `Munition ${units[0]!.ammo} / ${maxAmmo}`;
        this.binfoEl.append(ammo);
      }
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
