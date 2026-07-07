import {
  SUBCELL,
  SUPERWEAPON_STATS,
  buildingRule,
  canPlaceBuilding,
  type BuildingType,
  type Command,
  type GameState,
  type SuperweaponKind,
} from '@cac/sim';
import { Graphics, type Container } from 'pixi.js';
import { cellToScreen, TILE_H, TILE_W } from '../render/iso.js';
import { session } from '../session.js';

/**
 * Building placement mode: a green/red footprint ghost follows the cursor;
 * left-click places, right-click or Escape cancels. Walls chain: the mode
 * stays active after each placement so you can drag out a line of them.
 */
export class PlacementMode {
  active: BuildingType | null = null;
  /** Superweapon targeting mode ("Ziel wählen"). */
  strike: SuperweaponKind | null = null;
  private readonly ghost = new Graphics();
  private lastCell = { cx: -1, cy: -1 };

  constructor(
    ghostLayer: Container,
    private state: GameState,
    private send: (cmd: Command) => void,
  ) {
    this.ghost.visible = false;
    ghostLayer.addChild(this.ghost);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  /** True while any placement/targeting mode consumes canvas clicks. */
  get busy(): boolean {
    return this.active !== null || this.strike !== null;
  }

  activate(type: BuildingType): void {
    this.strike = null;
    this.active = type;
    this.lastCell = { cx: -1, cy: -1 };
    this.ghost.visible = true;
    this.ghost.clear();
  }

  activateStrike(kind: SuperweaponKind): void {
    this.active = null;
    this.strike = kind;
    this.lastCell = { cx: -1, cy: -1 };
    this.ghost.visible = true;
    this.ghost.clear();
  }

  cancel(): void {
    this.active = null;
    this.strike = null;
    this.ghost.visible = false;
  }

  /** Update the ghost for the hovered cell. */
  hover(cx: number, cy: number): void {
    if (!this.busy) return;
    if (cx === this.lastCell.cx && cy === this.lastCell.cy) return;
    this.lastCell = { cx, cy };
    if (this.strike) {
      this.redrawStrike(cx, cy);
    } else {
      this.redraw(cx, cy);
    }
  }

  /** Blast-radius ellipse (iso projection of the world-space circle). */
  private redrawStrike(cx: number, cy: number): void {
    const stats = SUPERWEAPON_STATS[this.strike!];
    const rCells = stats.radius / SUBCELL;
    const { x, y } = cellToScreen(cx, cy);
    const k = Math.SQRT2;
    this.ghost.clear();
    this.ghost
      .ellipse(x, y, rCells * 32 * k, rCells * 16 * k)
      .fill({ color: 0xff4d4d, alpha: 0.12 })
      .stroke({ width: 2, color: 0xff4d4d, alpha: 0.9 });
    this.ghost.moveTo(x - 8, y).lineTo(x + 8, y).stroke({ width: 1.5, color: 0xff4d4d });
    this.ghost.moveTo(x, y - 4).lineTo(x, y + 4).stroke({ width: 1.5, color: 0xff4d4d });
  }

  private redraw(cx: number, cy: number): void {
    const rule = buildingRule(this.active!);
    const ok = canPlaceBuilding(this.state, session.localPlayer, this.active!, cx, cy);
    const color = ok ? 0x53c94f : 0xe04a3a;
    this.ghost.clear();
    for (let y = cy; y < cy + rule.height; y++) {
      for (let x = cx; x < cx + rule.width; x++) {
        const { x: sx, y: sy } = cellToScreen(x, y);
        this.ghost
          .poly([
            sx, sy - TILE_H / 2,
            sx + TILE_W / 2, sy,
            sx, sy + TILE_H / 2,
            sx - TILE_W / 2, sy,
          ])
          .fill({ color, alpha: 0.3 })
          .stroke({ width: 1, color, alpha: 0.9 });
      }
    }
  }

  /** Attempt to place at the given cell. Returns true if the click was consumed. */
  place(cx: number, cy: number): boolean {
    if (this.strike) {
      this.send({ type: 'FIRE_SUPERWEAPON', playerId: session.localPlayer, cx, cy });
      this.cancel();
      return true;
    }
    if (!this.active) return false;
    if (!canPlaceBuilding(this.state, session.localPlayer, this.active, cx, cy)) return true;
    if (this.active === 'WALL') {
      this.send({ type: 'PLACE_WALL', playerId: session.localPlayer, cx, cy });
      this.lastCell = { cx: -1, cy: -1 }; // ghost refresh; stay active for chains
      return true;
    }
    this.send({ type: 'PLACE_BUILDING', playerId: session.localPlayer, cx, cy });
    this.cancel();
    return true;
  }
}
