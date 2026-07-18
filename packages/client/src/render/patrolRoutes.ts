import type { GameState } from '@cac/sim';
import { Container, Graphics } from 'pixi.js';
import { session } from '../session.js';
import { cellToScreen } from './iso.js';

const ROUTE_GREEN = 0x3fd45a;
const ROUTE_BRIGHT = 0x8affa0;

/**
 * Render-only overlay that shows the patrol routes of the local player's
 * units: a green line between the two patrol points with a marker on each
 * end. A route is only visible while one of its units is selected — or for
 * every patrol at once while the R overlay toggle is on. Selected routes
 * draw brighter; identical routes (group patrols) are drawn once.
 */
export class PatrolRouteOverlay {
  readonly layer = new Container();
  private readonly g = new Graphics();

  constructor() {
    this.layer.addChild(this.g);
  }

  update(state: GameState, selected: ReadonlySet<number>, showAll: boolean): void {
    this.g.clear();

    // Collect distinct routes; a route is "bright" if any of its units is selected.
    const routes = new Map<string, { ax: number; ay: number; bx: number; by: number; bright: boolean }>();
    for (const unit of state.units) {
      if (unit.owner !== session.localPlayer) continue;
      const o = unit.order;
      if (!o || o.kind !== 'PATROL') continue;
      const bright = selected.has(unit.id);
      if (!bright && !showAll) continue;
      const key = `${o.ax},${o.ay},${o.bx},${o.by}`;
      const route = routes.get(key);
      if (route) route.bright ||= bright;
      else routes.set(key, { ax: o.ax, ay: o.ay, bx: o.bx, by: o.by, bright });
    }

    for (const r of routes.values()) {
      const pa = cellToScreen(r.ax, r.ay);
      const pb = cellToScreen(r.bx, r.by);
      const color = r.bright ? ROUTE_BRIGHT : ROUTE_GREEN;
      const alpha = r.bright ? 0.95 : 0.55;
      const g = this.g;
      // Soft glow under a crisp core line.
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width: 6, color, alpha: alpha * 0.25 });
      g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width: 2, color, alpha });
      // Start and end markers: filled dot in an outlined ring.
      for (const p of [pa, pb]) {
        g.circle(p.x, p.y, 7).stroke({ width: 2, color, alpha });
        g.circle(p.x, p.y, 3).fill({ color, alpha });
      }
    }
  }
}
