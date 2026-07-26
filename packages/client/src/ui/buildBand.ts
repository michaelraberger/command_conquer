import {
  BUILDING_RULES,
  UNIT_RULES,
  availableToFaction,
  buildingRule,
  findFreeAirfield,
  isBuildingType,
  satisfiesRequirement,
  techFor,
  unitRule,
  type Building,
  type BuildingType,
  type GameState,
  type ProductionCategory,
  type UnitType,
} from '@cac/sim';
import type { Container } from 'pixi.js';
import type { Controls } from '../input/controls.js';
import { worldToScreen } from '../render/iso.js';
import { session } from '../session.js';
import type { Sidebar } from './sidebar.js';

/**
 * Floating build band over the selected production building: click a tile to
 * start production right there (same queues/flow as the sidebar — clicks are
 * delegated to Sidebar.clickItem). DOM-over-canvas: the band is positioned
 * every frame from the building's world position + camera offset; its CONTENT
 * only rebuilds on a structural key change so buttons never die mid-click
 * (the sidebar's lastBinfoKey discipline).
 */
export class BuildBand {
  private readonly root = document.getElementById('buildband')!;
  private tiles: Array<{ el: HTMLElement; item: string }> = [];
  private lastKey = '';

  constructor(
    private readonly state: GameState,
    private readonly controls: Controls,
    private readonly sidebar: Sidebar,
    private readonly world: Container,
  ) {}

  /** The category a selected building offers (CONYARD builds buildings). */
  private static bandCategory(b: Building): ProductionCategory | null {
    if (b.type === 'CONYARD') return 'building';
    return buildingRule(b.type).produces;
  }

  update(): void {
    const id = this.controls.selectedBuilding;
    const building = id === null ? null : this.state.buildings.find((b) => b.id === id);
    const category =
      building && building.owner === session.localPlayer ? BuildBand.bandCategory(building) : null;
    if (!building || category === null) {
      if (this.lastKey !== '') {
        this.root.style.display = 'none';
        this.lastKey = '';
      }
      return;
    }

    // Follow the building on screen (stage coords ≈ CSS px, canvas fills the
    // window); anchored above the sprite via CSS translate(-50%, -100%).
    const p = worldToScreen(building.x, building.y);
    this.root.style.left = `${Math.round(p.x + this.world.position.x)}px`;
    this.root.style.top = `${Math.round(p.y + this.world.position.y - 58)}px`;

    const player = this.state.players[session.localPlayer]!;
    const q = player.queues[category];
    // Structural key: prereq/unique/tech states shift with own buildings and
    // research; queue identity/readiness swaps tile highlighting.
    let own = 0;
    for (const b of this.state.buildings) if (b.owner === player.id) own++;
    const key = `${building.id}:${category}:${q.item}:${q.ready}:${player.researched.length}:${own}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.rebuild(category, player.faction);
      this.root.style.display = 'flex';
    }

    // Cheap per-frame refresh: progress % on the queued tile.
    if (q.item !== null && !q.ready) {
      const tile = this.tiles.find((t) => t.item === q.item);
      if (tile) {
        const rule = isBuildingType(q.item)
          ? buildingRule(q.item)
          : unitRule(q.item as UnitType);
        const pct = Math.min(99, Math.floor((q.progress / rule.buildTime) * 100));
        tile.el.dataset['pct'] = `${pct}%`;
      }
    }
  }

  private items(category: ProductionCategory, faction: string): string[] {
    if (category === 'building') {
      const list = (Object.keys(BUILDING_RULES) as BuildingType[]).filter(
        (t) =>
          BUILDING_RULES[t].buildable &&
          availableToFaction(BUILDING_RULES[t].factions, faction as never),
      );
      return [...list, 'WALL'];
    }
    return (Object.keys(UNIT_RULES) as UnitType[]).filter(
      (t) =>
        UNIT_RULES[t].category === category &&
        unitRule(t).hidden !== true &&
        availableToFaction(UNIT_RULES[t].factions, faction as never),
    );
  }

  private rebuild(category: ProductionCategory, faction: string): void {
    this.root.replaceChildren();
    this.tiles = [];
    const player = this.state.players[session.localPlayer]!;
    const q = player.queues[category];
    for (const item of this.items(category, faction)) {
      const rule = isBuildingType(item) ? buildingRule(item) : unitRule(item as UnitType);
      const el = document.createElement('button');
      el.className = 'bb-tile';
      el.textContent = rule.name;
      const cost = document.createElement('span');
      cost.className = 'bb-cost';
      cost.textContent = `$${rule.cost}`;
      el.appendChild(cost);

      // Same gating logic as the sidebar tiles (compact form).
      const prereqsMet =
        player.motherload ||
        rule.requires.every((req) =>
          this.state.buildings.some(
            (b) => b.owner === player.id && satisfiesRequirement(b.type, req),
          ),
        );
      const tech = techFor(item);
      const techLocked =
        !player.motherload && tech !== undefined && !player.researched.includes(tech);
      const uniqueBuilt =
        isBuildingType(item) &&
        buildingRule(item).unique === true &&
        this.state.buildings.some((b) => b.owner === player.id && b.type === item);
      const noAirfield =
        !isBuildingType(item) &&
        unitRule(item as UnitType).airfieldBound === true &&
        findFreeAirfield(this.state, player.id) === null;
      const locked = !prereqsMet || techLocked || uniqueBuilt || noAirfield;
      if (locked) {
        el.classList.add('locked');
        el.title = uniqueBuilt
          ? 'Nur einmal baubar – steht bereits'
          : techLocked
            ? 'Forschung nötig'
            : noAirfield
              ? 'Kein freies Flugfeld'
              : `Benötigt: ${rule.requires.join(', ')}`;
      }
      if (q.item === item) el.classList.add(q.ready ? 'ready' : 'queued');
      if (q.item === item && q.ready) el.title = 'Klick: platzieren';

      el.addEventListener('click', () => {
        if (locked) return;
        this.sidebar.clickItem(item);
        this.lastKey = ''; // re-render highlight next frame
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.sidebar.cancelItem(item);
        this.lastKey = '';
      });
      this.root.appendChild(el);
      this.tiles.push({ el, item });
    }
  }
}
