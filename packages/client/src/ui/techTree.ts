import { satisfiesRequirement, techRule, type GameState, type TechId } from '@cac/sim';
import { session } from '../session.js';
import { computeTechTree, TILE_H, TILE_W, type TreeNode } from './techTreeLayout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface NodeRef {
  node: TreeNode;
  el: HTMLElement;
  techEl: HTMLElement | null;
  edgeEls: SVGPathElement[];
  status: string;
}

/**
 * Tech-tree overlay in the style of the classic C&C posters: Bauhof at the
 * bottom, tiers above, orthogonal connectors. Toggled by a button and `T`.
 * Layout is static per match (rules + faction); only the live statuses
 * (built / available / locked) refresh on a timer while the overlay is open.
 */
export class TechTreeOverlay {
  private readonly panel = document.getElementById('techtree')!;
  private readonly btn = document.getElementById('techtree-btn')!;
  private readonly scroll = this.panel.querySelector<HTMLElement>('.tt-scroll')!;
  private readonly content = document.getElementById('tt-content')!;
  private refs = new Map<string, NodeRef>();
  private timer: number | null = null;

  constructor(private state: GameState) {
    this.btn.addEventListener('click', () => this.toggle());
    document.getElementById('techtree-close')?.addEventListener('click', () => this.close());
    this.panel.addEventListener('pointerdown', (e) => {
      if (e.target === this.panel) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // don't hijack the cheat input
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.panel.classList.contains('open')) {
        e.preventDefault();
        this.close();
      }
    });
  }

  private toggle(): void {
    if (this.panel.classList.contains('open')) this.close();
    else this.open();
  }

  private open(): void {
    this.build();
    this.refreshStatuses();
    this.panel.classList.add('open');
    // Start at the root: the Bauhof sits at the bottom of the poster.
    this.scroll.scrollTop = this.scroll.scrollHeight;
    const root = this.refs.get('CONYARD');
    if (root !== undefined) {
      this.scroll.scrollLeft = root.node.x + TILE_W / 2 - this.scroll.clientWidth / 2;
    }
    this.timer = window.setInterval(() => this.refreshStatuses(), 500);
  }

  private close(): void {
    this.panel.classList.remove('open');
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private build(): void {
    const faction = this.state.players[session.localPlayer]!.faction;
    const { nodes, edges, width, height } = computeTechTree(faction);
    this.refs = new Map();

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('tt-edges');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const children: Array<HTMLElement | SVGElement> = [svg];
    for (const node of nodes) {
      const { el, techEl } = this.buildNode(node);
      children.push(el);
      this.refs.set(node.item, { node, el, techEl, edgeEls: [], status: '' });
    }
    for (const edge of edges) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.classList.add('tt-edge');
      if (edge.kind === 'upgrade') path.classList.add('upgrade');
      path.setAttribute('d', edge.path);
      svg.appendChild(path);
      this.refs.get(edge.to)?.edgeEls.push(path);
    }

    this.content.style.width = `${width}px`;
    this.content.style.height = `${height}px`;
    this.content.replaceChildren(...children);
  }

  private buildNode(node: TreeNode): { el: HTMLElement; techEl: HTMLElement | null } {
    const el = document.createElement('div');
    el.className = 'tt-node';
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${TILE_W}px`;
    el.style.height = `${TILE_H}px`;
    el.title = node.tooltip;

    const name = document.createElement('div');
    name.className = 'tt-name';
    name.textContent = `${node.categoryIcon} ${node.name}`;

    const cost = document.createElement('div');
    cost.className = 'tt-meta';
    const costSpan = document.createElement('span');
    costSpan.className = 'tt-cost';
    costSpan.textContent = `$${node.cost}`;
    cost.append(costSpan);
    if (node.power !== undefined) {
      const power = document.createElement('span');
      power.textContent = `⚡${node.power > 0 ? '+' : '−'}${Math.abs(node.power)}`;
      power.style.color = node.power > 0 ? '#53c94f' : '#e0954a';
      cost.append(power);
    }
    if (node.unique === true) {
      const unique = document.createElement('span');
      unique.textContent = '1×';
      cost.append(unique);
    }
    el.append(name, cost);

    let techEl: HTMLElement | null = null;
    if (node.tech !== undefined) {
      techEl = document.createElement('div');
      techEl.className = 'tt-tech';
      techEl.textContent = `🔬 ${techRule(node.tech).name}`;
      el.append(techEl);
    } else if (node.upgradeOf !== undefined) {
      const upgrade = document.createElement('div');
      upgrade.className = 'tt-tech';
      upgrade.textContent = '⬆ Ausbau';
      el.append(upgrade);
    }
    return { el, techEl };
  }

  /** Toggle status classes only — no relayout (same logic as the sidebar). */
  private refreshStatuses(): void {
    const local = session.localPlayer;
    const player = this.state.players[local]!;
    // satisfiesRequirement: upgraded buildings still count as their base type
    // (ein Fortschr. Kraftwerk hält den Kraftwerk-Knoten grün).
    const standing = (type: string): boolean =>
      this.state.buildings.some((b) => b.owner === local && satisfiesRequirement(b.type, type));

    for (const ref of this.refs.values()) {
      const { node } = ref;
      const prereqsMet = player.motherload || node.statusRequires.every(standing);
      const techLocked =
        !player.motherload && node.tech !== undefined && !player.researched.includes(node.tech);
      // Buildings turn green while an instance stands; units stay blue/grey —
      // they are consumable, so "built" would flicker off when the last one dies.
      const status =
        node.kind === 'building' && standing(node.item)
          ? 'built'
          : prereqsMet && !techLocked
            ? 'available'
            : 'locked';
      if (status === ref.status) continue;
      ref.status = status;
      for (const cls of ['built', 'available', 'locked']) {
        const on = cls === status;
        ref.el.classList.toggle(cls, on);
        for (const edge of ref.edgeEls) edge.classList.toggle(cls, on);
      }
    }
    for (const ref of this.refs.values()) {
      if (ref.techEl !== null && ref.node.tech !== undefined) {
        ref.techEl.classList.toggle('researched', player.researched.includes(ref.node.tech as TechId));
      }
    }
  }
}
