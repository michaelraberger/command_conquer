import {
  PARADROP_DROP_RADIUS,
  SUBCELL,
  SUPERWEAPON_STATS,
  buildingRule,
  canPlaceBuilding,
  type Building,
  type BuildingType,
  type Command,
  type GameState,
  type SuperweaponKind,
} from '@cac/sim';

/** Everything the "pick a target cell" mode can aim: superweapons + paradrop. */
export type StrikeKind = SuperweaponKind | 'PARADROP';
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
  /** Superweapon/paradrop targeting mode ("Ziel wählen"). */
  strike: StrikeKind | null = null;
  /** Repair mode (sidebar wrench): clicks toggle self-repair on own buildings. */
  repair = false;
  private readonly ghost = new Graphics();
  /** Blueprint footprints of placements already SENT but not yet executed —
   *  instant feedback that bridges the lockstep input delay (~330 ms online).
   *  Purely cosmetic and short-lived; the real building replaces it. */
  private readonly pendingG = new Graphics();
  private pending: Array<{ cx: number; cy: number; w: number; h: number; until: number }> = [];
  private lastCell = { cx: -1, cy: -1 };

  constructor(
    ghostLayer: Container,
    private state: GameState,
    private send: (cmd: Command) => void,
  ) {
    this.ghost.visible = false;
    ghostLayer.addChild(this.pendingG, this.ghost);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancel();
    });
  }

  /** Remember a just-sent placement and draw its blueprint immediately. */
  private notePending(cx: number, cy: number, w: number, h: number): void {
    this.pending.push({ cx, cy, w, h, until: performance.now() + 1200 });
    this.redrawPending();
    window.setTimeout(() => this.redrawPending(), 1250);
  }

  private redrawPending(): void {
    const now = performance.now();
    this.pending = this.pending.filter((p) => p.until > now);
    this.pendingG.clear();
    for (const p of this.pending) {
      for (let y = p.cy; y < p.cy + p.h; y++) {
        for (let x = p.cx; x < p.cx + p.w; x++) {
          const { x: sx, y: sy } = cellToScreen(x, y);
          this.pendingG
            .poly([
              sx, sy - TILE_H / 2,
              sx + TILE_W / 2, sy,
              sx, sy + TILE_H / 2,
              sx - TILE_W / 2, sy,
            ])
            .fill({ color: 0x9fd0ff, alpha: 0.28 })
            .stroke({ width: 1, color: 0x9fd0ff, alpha: 0.85 });
        }
      }
    }
  }

  /** True while any placement/targeting mode consumes canvas clicks. */
  get busy(): boolean {
    return this.active !== null || this.strike !== null || this.repair;
  }

  activate(type: BuildingType): void {
    this.strike = null;
    this.repair = false;
    this.active = type;
    this.lastCell = { cx: -1, cy: -1 };
    this.ghost.visible = true;
    this.ghost.clear();
  }

  activateStrike(kind: StrikeKind): void {
    this.active = null;
    this.repair = false;
    this.strike = kind;
    this.lastCell = { cx: -1, cy: -1 };
    this.ghost.visible = true;
    this.ghost.clear();
  }

  /** Sidebar wrench: clicks now toggle self-repair on own buildings. */
  activateRepair(): void {
    this.active = null;
    this.strike = null;
    this.repair = true;
    this.lastCell = { cx: -1, cy: -1 };
    this.ghost.visible = true;
    this.ghost.clear();
  }

  cancel(): void {
    this.active = null;
    this.strike = null;
    this.repair = false;
    this.ghost.visible = false;
  }

  /** Update the ghost for the hovered cell. */
  hover(cx: number, cy: number): void {
    if (!this.busy) return;
    if (cx === this.lastCell.cx && cy === this.lastCell.cy) return;
    this.lastCell = { cx, cy };
    if (this.strike) {
      this.redrawStrike(cx, cy);
    } else if (this.repair) {
      this.redrawRepair(cx, cy);
    } else {
      this.redraw(cx, cy);
    }
  }

  /** The building whose footprint covers the cell, if any. */
  private buildingAt(cx: number, cy: number): Building | null {
    if (cx < 0 || cy < 0 || cx >= this.state.mapWidth || cy >= this.state.mapHeight) return null;
    const id = this.state.structures[cy * this.state.mapWidth + cx]!;
    if (id === 0) return null;
    return this.state.buildings.find((b) => b.id === id) ?? null;
  }

  /** Repair mode: gold outline over the hovered own building's footprint. */
  private redrawRepair(cx: number, cy: number): void {
    this.ghost.clear();
    const building = this.buildingAt(cx, cy);
    const own = building !== null && building.owner === session.localPlayer;
    const rule = own ? buildingRule(building.type) : null;
    const x0 = own ? building.cx : cx;
    const y0 = own ? building.cy : cy;
    const w = rule?.width ?? 1;
    const h = rule?.height ?? 1;
    const color = own ? 0xffd94d : 0x8a94a0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const { x: sx, y: sy } = cellToScreen(x, y);
        this.ghost
          .poly([
            sx, sy - TILE_H / 2,
            sx + TILE_W / 2, sy,
            sx, sy + TILE_H / 2,
            sx - TILE_W / 2, sy,
          ])
          .fill({ color, alpha: own ? 0.22 : 0.1 })
          .stroke({ width: 1, color, alpha: 0.9 });
      }
    }
  }

  /** Blast/drop-zone ellipse (iso projection of the world-space circle).
   *  Superweapons paint red destruction; the paradrop a green landing zone. */
  private redrawStrike(cx: number, cy: number): void {
    const kind = this.strike!;
    const rCells = kind === 'PARADROP' ? PARADROP_DROP_RADIUS : SUPERWEAPON_STATS[kind].radius / SUBCELL;
    const color = kind === 'PARADROP' ? 0x53c94f : 0xff4d4d;
    const { x, y } = cellToScreen(cx, cy);
    const k = Math.SQRT2;
    this.ghost.clear();
    this.ghost
      .ellipse(x, y, rCells * 32 * k, rCells * 16 * k)
      .fill({ color, alpha: 0.12 })
      .stroke({ width: 2, color, alpha: 0.9 });
    this.ghost.moveTo(x - 8, y).lineTo(x + 8, y).stroke({ width: 1.5, color });
    this.ghost.moveTo(x, y - 4).lineTo(x, y + 4).stroke({ width: 1.5, color });
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
    if (this.strike === 'PARADROP') {
      this.send({ type: 'PARADROP', playerId: session.localPlayer, cx, cy });
      this.cancel();
      return true;
    }
    if (this.strike) {
      this.send({ type: 'FIRE_SUPERWEAPON', playerId: session.localPlayer, cx, cy, kind: this.strike });
      this.cancel();
      return true;
    }
    if (this.repair) {
      const building = this.buildingAt(cx, cy);
      if (building && building.owner === session.localPlayer) {
        this.send({ type: 'TOGGLE_REPAIR', playerId: session.localPlayer, buildingId: building.id });
      }
      // Stay active (chain like walls) — right-click/Escape leaves the mode.
      this.lastCell = { cx: -1, cy: -1 };
      return true;
    }
    if (!this.active) return false;
    if (!canPlaceBuilding(this.state, session.localPlayer, this.active, cx, cy)) return true;
    if (this.active === 'WALL') {
      this.send({ type: 'PLACE_WALL', playerId: session.localPlayer, cx, cy });
      this.notePending(cx, cy, 1, 1);
      this.lastCell = { cx: -1, cy: -1 }; // ghost refresh; stay active for chains
      return true;
    }
    const rule = buildingRule(this.active);
    this.send({ type: 'PLACE_BUILDING', playerId: session.localPlayer, cx, cy });
    this.notePending(cx, cy, rule.width, rule.height);
    this.cancel();
    return true;
  }
}
