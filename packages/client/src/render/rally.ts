import { buildingRule, type GameState } from '@cac/sim';
import { Graphics, type Container } from 'pixi.js';
import { session } from '../session.js';
import { cellToScreen, worldToScreen } from './iso.js';

/**
 * Rally-point marker for the selected own production building: a flag in the
 * owner's colour on the rally cell plus a dashed guide line from the
 * building. Render-only — the sim never sees any of this.
 */
export class RallyOverlay {
  private readonly g = new Graphics();
  private lastSig = '';

  constructor(layer: Container) {
    layer.addChild(this.g);
  }

  update(state: GameState, selectedBuildingId: number | null): void {
    let b =
      selectedBuildingId !== null
        ? state.buildings.find((x) => x.id === selectedBuildingId)
        : undefined;
    if (
      b &&
      (b.owner !== session.localPlayer ||
        b.rallyCx < 0 ||
        buildingRule(b.type).produces === null)
    ) {
      b = undefined;
    }
    const sig = b ? `${b.id}|${b.rallyCx}|${b.rallyCy}` : '';
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.g.clear();
    if (!b) return;

    const color = state.players[b.owner]?.color ?? 0xffffff;
    const from = worldToScreen(b.x, b.y);
    const to = cellToScreen(b.rallyCx, b.rallyCy);

    // Dashed guide line building → rally cell.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const DASH = 10;
      const GAP = 7;
      for (let d = 0; d < len; d += DASH + GAP) {
        const e = Math.min(d + DASH, len);
        this.g
          .moveTo(from.x + (dx * d) / len, from.y + (dy * d) / len)
          .lineTo(from.x + (dx * e) / len, from.y + (dy * e) / len);
      }
      this.g.stroke({ width: 2, color, alpha: 0.55 });
    }

    // Ground ring + flag pole + pennant in the owner's colour.
    this.g.ellipse(to.x, to.y, 10, 5).stroke({ width: 2, color, alpha: 0.9 });
    this.g.ellipse(to.x, to.y, 3.5, 1.8).fill({ color, alpha: 0.9 });
    this.g.rect(to.x - 1, to.y - 26, 2, 26).fill(0xe8e4da);
    this.g
      .poly([to.x + 1, to.y - 26, to.x + 15, to.y - 21.5, to.x + 1, to.y - 17])
      .fill(color)
      .stroke({ width: 1, color: 0x2a2620, alpha: 0.35 });
  }
}
