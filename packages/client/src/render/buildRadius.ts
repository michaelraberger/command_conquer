import { SUBCELL, buildingRule, type Building, type GameState } from '@cac/sim';
import { Graphics, type Container } from 'pixi.js';
import { session } from '../session.js';
import { worldToScreen, TILE_H, TILE_W } from './iso.js';

/** world-space circle → iso ellipse aspect factor. */
const K = Math.SQRT2;

/**
 * Build/attack-radius indicator, inscribed in the true chebyshev region so
 * nothing over-promises:
 *  - Total buildable area: a faint blue circle around every own REAL building
 *    (their union is where new buildings may go). Shown when a building is
 *    selected OR the R-hotkey toggle is on.
 *  - Selected building: its own build radius, brighter blue, on top.
 *  - Selected defense (Wachturm, Prisma, …): additionally its ATTACK radius
 *    in red — deliberately distinct from the build radius, since the two
 *    differ (a Prisma shoots further than it extends the base).
 *
 * Walls never open buildable area, so they contribute no circle; a selected
 * wall just highlights its own block.
 */
export class BuildRadiusOverlay {
  private readonly g = new Graphics();
  private lastSig = '';

  constructor(layer: Container) {
    layer.addChild(this.g);
  }

  update(state: GameState, selectedBuildingId: number | null, showAll: boolean): void {
    const own = state.buildings.filter((b) => b.owner === session.localPlayer);
    const sel = selectedBuildingId !== null ? own.find((b) => b.id === selectedBuildingId) : undefined;
    const selIsWall = sel?.type === 'WALL';
    // A selected wall shows only its own block — never a radius. The total
    // buildable area still appears via the R-toggle or a real-building select.
    const showTotal = showAll || (sel !== undefined && !selIsWall);
    // Redraw only when something that affects the drawing changed. Buildings
    // never move, so their count captures add/remove.
    const sig = `${selectedBuildingId}|${showTotal}|${own.length}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    this.g.clear();
    if (showTotal) {
      for (const b of own) if (b.type !== 'WALL') this.drawCircle(b, 0x53a0ff, 0.05, 0.4, 1);
    }
    if (sel && selIsWall) this.drawFootprint(sel, 0xff3b30);
    else if (sel) {
      this.drawCircle(sel, 0x53a0ff, 0.12, 0.9, 2);
      const weapon = buildingRule(sel.type).weapon;
      if (weapon) {
        this.drawRangeRing(sel, weapon.range, 0xff3b30, 0.04, 0.85);
        // Dead zone up close (AGT): a thin inner ring marks where it can't fire.
        if (weapon.minRange && weapon.minRange > 0) {
          this.drawRangeRing(sel, weapon.minRange, 0xff3b30, 0, 0.5);
        }
      }
    }
  }

  /** A range ring (red) — measured from the building centre like the sim does. */
  private drawRangeRing(b: Building, range: number, color: number, fillAlpha: number, strokeAlpha: number): void {
    const radiusCells = range / SUBCELL;
    const c = worldToScreen(b.x, b.y);
    this.g
      .ellipse(c.x, c.y, radiusCells * 32 * K, radiusCells * 16 * K)
      .fill({ color, alpha: fillAlpha })
      .stroke({ width: 2, color, alpha: strokeAlpha });
  }

  private drawCircle(
    b: Building,
    color: number,
    fillAlpha: number,
    strokeAlpha: number,
    strokeWidth: number,
  ): void {
    const rule = buildingRule(b.type);
    const radiusCells = 3 + Math.min(rule.width, rule.height) / 2;
    const c = worldToScreen(b.x, b.y);
    this.g
      .ellipse(c.x, c.y, radiusCells * 32 * K, radiusCells * 16 * K)
      .fill({ color, alpha: fillAlpha })
      .stroke({ width: strokeWidth, color, alpha: strokeAlpha });
  }

  /** Highlights just the building's own tiles — no projected radius. */
  private drawFootprint(b: Building, color: number): void {
    const rule = buildingRule(b.type);
    for (let dy = 0; dy < rule.height; dy++) {
      for (let dx = 0; dx < rule.width; dx++) {
        const c = worldToScreen((b.cx + dx) * 256 + 128, (b.cy + dy) * 256 + 128);
        this.g
          .poly([
            c.x, c.y - TILE_H / 2,
            c.x + TILE_W / 2, c.y,
            c.x, c.y + TILE_H / 2,
            c.x - TILE_W / 2, c.y,
          ])
          .fill({ color, alpha: 0.18 })
          .stroke({ width: 2, color, alpha: 0.9 });
      }
    }
  }
}
