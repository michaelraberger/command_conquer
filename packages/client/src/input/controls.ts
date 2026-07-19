import {
  FOG_VISIBLE,
  buildingRule,
  cellIndex,
  inBounds,
  toCell,
  unitRule,
  type Command,
  type GameState,
} from '@cac/sim';
import { Container, Graphics, type Application, type FederatedPointerEvent } from 'pixi.js';
import { CURSORS } from '../render/cursors.js';
import { screenToCell, worldToScreen } from '../render/iso.js';
import { session } from '../session.js';
import type { PlacementMode } from '../ui/placement.js';

const CLICK_TOLERANCE = 6; // px of pointer travel that still counts as a click
const PICK_RADIUS = 26; // px around a unit that counts as clicking it

/** Left-click/drag selection and right-click orders for units and buildings. */
export class Controls {
  readonly selected = new Set<number>();
  selectedBuilding: number | null = null;
  /** Notified whenever the player selects on the map (clears group-chip marks). */
  onManualSelect: (() => void) | null = null;
  /** True while the camera is in grab-pan mode (space held) — suppresses input. */
  isPanning: (() => boolean) | null = null;
  /** Armed via Q: the next right-click sets a patrol point instead of moving. */
  private patrolArmed = false;
  private dragStart: { x: number; y: number } | null = null;
  private readonly dragRect: Graphics;
  private readonly canvas: HTMLCanvasElement;

  constructor(
    app: Application,
    private world: Container,
    private state: GameState,
    private send: (cmd: Command) => void,
    private placement: PlacementMode,
  ) {
    this.canvas = app.canvas;
    this.dragRect = new Graphics();
    app.stage.addChild(this.dragRect);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (e) => this.onDown(e));
    app.stage.on('pointermove', (e) => this.onMove(e));
    app.stage.on('pointerup', (e) => this.onUp(e));
    app.stage.on('pointerupoutside', (e) => this.onUp(e));
    app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Hovered cell in map coordinates for a stage-global pointer position. */
  private cellAt(global: { x: number; y: number }): { cx: number; cy: number } {
    const local = this.world.toLocal(global);
    return screenToCell(local.x, local.y);
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.isPanning?.()) return; // space held → camera grab-pan owns the drag
    if (this.placement.busy) {
      if (e.button === 0) {
        const { cx, cy } = this.cellAt(e.global);
        this.placement.place(cx, cy);
      } else if (e.button === 2) {
        this.placement.cancel();
      }
      return;
    }
    if (e.button === 0) {
      this.patrolArmed = false; // a fresh selection cancels the armed patrol click
      this.dragStart = { x: e.global.x, y: e.global.y };
    } else if (e.button === 2) {
      this.issueOrder(e);
    }
  }

  private onMove(e: FederatedPointerEvent): void {
    if (this.isPanning?.()) return; // don't fight the grab cursor / start a box
    if (this.placement.busy) {
      const { cx, cy } = this.cellAt(e.global);
      this.placement.hover(cx, cy);
      this.canvas.style.cursor = 'default';
      return;
    }
    if (!this.dragStart) {
      // Classic C&C cursors: attack reticle over enemies, move arrows with a
      // selection in hand, select brackets over own (selectable) units.
      if (this.selected.size > 0) {
        this.canvas.style.cursor =
          this.enemyAt(e.global) !== null
            ? CURSORS.attack
            : this.hoverOwnUnit(e.global)
              ? CURSORS.select
              : CURSORS.move;
      } else {
        this.canvas.style.cursor = this.hoverOwnUnit(e.global) ? CURSORS.select : 'default';
      }
      return;
    }
    const { x, y } = this.dragStart;
    this.dragRect
      .clear()
      .rect(Math.min(x, e.global.x), Math.min(y, e.global.y), Math.abs(e.global.x - x), Math.abs(e.global.y - y))
      .fill({ color: 0x66ff66, alpha: 0.08 })
      .stroke({ width: 1, color: 0x8aff8a, alpha: 0.9 });
  }

  private onUp(e: FederatedPointerEvent): void {
    if (!this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;
    this.dragRect.clear();
    const moved = Math.max(Math.abs(e.global.x - start.x), Math.abs(e.global.y - start.y));
    if (moved <= CLICK_TOLERANCE) {
      this.clickSelect(e);
    } else {
      this.boxSelect(start, { x: e.global.x, y: e.global.y });
    }
  }

  /** Screen position of a unit in stage coordinates. */
  private unitStagePos(fx: number, fy: number): { x: number; y: number } {
    const p = worldToScreen(fx, fy);
    return { x: p.x + this.world.position.x, y: p.y + this.world.position.y };
  }

  private clickSelect(e: FederatedPointerEvent): void {
    let bestId = -1;
    let bestDist = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer) continue;
      if (unitRule(unit.type).hidden === true) continue; // scripted paradrop plane
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - e.global.x;
      const dy = p.y - e.global.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestId = unit.id;
      }
    }
    this.onManualSelect?.();
    this.selected.clear();
    this.selectedBuilding = null;
    if (bestId !== -1) {
      this.selected.add(bestId);
      return;
    }
    // No unit hit — try own buildings via the structures grid.
    const { cx, cy } = this.cellAt(e.global);
    if (!inBounds(this.state, cx, cy)) return;
    const id = this.state.structures[cellIndex(this.state, cx, cy)]!;
    if (id !== 0) {
      const building = this.state.buildings.find((b) => b.id === id);
      if (building && building.owner === session.localPlayer) this.selectedBuilding = id;
    }
  }

  private boxSelect(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    this.onManualSelect?.();
    this.selected.clear();
    this.selectedBuilding = null;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer) continue;
      if (unitRule(unit.type).hidden === true) continue; // scripted paradrop plane
      const p = this.unitStagePos(unit.x, unit.y);
      if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) {
        this.selected.add(unit.id);
      }
    }
  }

  /** Q pressed: the next right-click orders a patrol to the clicked cell. */
  armPatrol(): void {
    if (this.selected.size > 0) this.patrolArmed = true;
  }

  /** Any own selectable unit under the cursor (for the bracket cursor)? */
  private hoverOwnUnit(global: { x: number; y: number }): boolean {
    const r2 = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer) continue;
      if (unitRule(unit.type).hidden === true) continue; // scripted paradrop plane
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - global.x;
      const dy = p.y - global.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  /** Own carrier (transport ship or air transport) under the cursor, or null. */
  private ownTransportAt(global: { x: number; y: number }): number | null {
    let bestId: number | null = null;
    let bestDist = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer || unitRule(unit.type).carrier !== true) continue;
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - global.x;
      const dy = p.y - global.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestId = unit.id;
      }
    }
    return bestId;
  }

  /** Nearest own DAMAGED unit under the cursor (repair target), or null. */
  private ownDamagedUnitAt(global: { x: number; y: number }): number | null {
    let bestId: number | null = null;
    let bestDist = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer) continue;
      if (unitRule(unit.type).hidden === true) continue; // scripted paradrop plane
      if (unit.hp >= unitRule(unit.type).maxHp) continue; // only damaged units
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - global.x;
      const dy = p.y - global.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestId = unit.id;
      }
    }
    return bestId;
  }

  /** Nearest own unit under the cursor that isn't in the selection, or null
   *  (escort target pick — the ward can't escort itself). */
  private ownUnitAt(global: { x: number; y: number }): number | null {
    let bestId: number | null = null;
    let bestDist = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner !== session.localPlayer || this.selected.has(unit.id)) continue;
      if (unitRule(unit.type).hidden === true) continue;
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - global.x;
      const dy = p.y - global.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestId = unit.id;
      }
    }
    return bestId;
  }

  /** Nearest visible enemy (unit or building) under the cursor, or null. */
  private enemyAt(global: { x: number; y: number }): number | null {
    const fog = this.state.fogs[session.localPlayer]!;
    let bestId: number | null = null;
    let bestDist = PICK_RADIUS * PICK_RADIUS;
    for (const unit of this.state.units) {
      if (unit.owner === session.localPlayer) continue;
      if (fog[toCell(unit.y) * this.state.mapWidth + toCell(unit.x)] !== FOG_VISIBLE) continue;
      const p = this.unitStagePos(unit.x, unit.y);
      const dx = p.x - global.x;
      const dy = p.y - global.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestId = unit.id;
      }
    }
    if (bestId !== null) return bestId;
    // Enemy buildings: hit via the structures grid (explored is enough).
    const { cx, cy } = this.cellAt(global);
    if (!inBounds(this.state, cx, cy)) return null;
    if (fog[cellIndex(this.state, cx, cy)] === 0) return null;
    const id = this.state.structures[cellIndex(this.state, cx, cy)]!;
    if (id === 0) return null;
    const building = this.state.buildings.find((b) => b.id === id);
    return building && building.owner !== session.localPlayer ? id : null;
  }

  /**
   * Right-click: attack an enemy under the cursor, harvest when clicking ore
   * with harvesters selected, Ctrl = attack-move, plain = move. With a
   * production building selected instead, right-click sets its rally point.
   */
  private issueOrder(e: FederatedPointerEvent): void {
    const { cx, cy } = this.cellAt(e.global);
    if (this.selected.size === 0) {
      this.patrolArmed = false;
      if (this.selectedBuilding !== null && inBounds(this.state, cx, cy)) {
        const building = this.state.buildings.find((b) => b.id === this.selectedBuilding);
        if (building && buildingRule(building.type).produces !== null) {
          this.send({
            type: 'SET_RALLY',
            playerId: session.localPlayer,
            buildingId: building.id,
            cx,
            cy,
          });
        }
      }
      return;
    }
    const unitIds = [...this.selected].sort((x, y) => x - y);

    // Patrol mode (armed via Q): this right-click sets point B — the units
    // shuttle between where they stand now and the clicked cell.
    if (this.patrolArmed) {
      this.patrolArmed = false;
      if (inBounds(this.state, cx, cy)) {
        this.send({ type: 'PATROL', playerId: session.localPlayer, unitIds, cx, cy });
        return;
      }
    }

    // Specialists right-clicking a foreign building — engineers capture any
    // enemy/neutral building, spies infiltrate enemy storage. Must come before
    // ATTACK, since both are weaponless.
    if (!e.ctrlKey && inBounds(this.state, cx, cy)) {
      const structId = this.state.structures[cellIndex(this.state, cx, cy)]!;
      const building = structId !== 0 ? this.state.buildings.find((b) => b.id === structId) : undefined;
      if (building && building.owner !== session.localPlayer) {
        const unitById = new Map(this.state.units.map((u) => [u.id, u]));
        const special = new Set<number>();

        const engineers = unitIds.filter((id) => {
          const unit = unitById.get(id);
          return unit !== undefined && unitRule(unit.type).captures === true;
        });
        if (engineers.length > 0) {
          this.send({
            type: 'CAPTURE',
            playerId: session.localPlayer,
            unitIds: engineers,
            targetId: building.id,
          });
          for (const id of engineers) special.add(id);
        }

        if ((buildingRule(building.type).storage ?? 0) > 0) {
          const spies = unitIds.filter((id) => unitById.get(id)?.type === 'SPION');
          if (spies.length > 0) {
            this.send({
              type: 'INFILTRATE',
              playerId: session.localPlayer,
              unitIds: spies,
              targetId: building.id,
            });
            for (const id of spies) special.add(id);
          }
        }

        if (special.size > 0) {
          const rest = unitIds.filter((id) => !special.has(id));
          if (rest.length > 0) {
            this.send({ type: 'MOVE', playerId: session.localPlayer, unitIds: rest, cx, cy });
          }
          return;
        }
      }
    }

    if (!e.ctrlKey) {
      const targetId = this.enemyAt(e.global);
      if (targetId !== null) {
        this.send({ type: 'ATTACK', playerId: session.localPlayer, unitIds, targetId });
        return;
      }
    }

    if (!inBounds(this.state, cx, cy)) return;
    const byId = new Map(this.state.units.map((u) => [u.id, u]));

    // Ground units right-clicking an own transport ship → climb aboard.
    if (!e.ctrlKey) {
      const transportId = this.ownTransportAt(e.global);
      if (transportId !== null) {
        const boarders = unitIds.filter((id) => {
          const u = byId.get(id);
          if (!u || u.id === transportId) return false;
          const rule = unitRule(u.type);
          return rule.air !== true && rule.category !== 'naval';
        });
        if (boarders.length > 0) {
          this.send({ type: 'LOAD', playerId: session.localPlayer, unitIds: boarders, transportId });
          return;
        }
      }
    }

    // Repair vehicle right-clicking a damaged own unit → repair it.
    if (!e.ctrlKey) {
      const targetUnitId = this.ownDamagedUnitAt(e.global);
      if (targetUnitId !== null) {
        const repairers = unitIds.filter(
          (id) => byId.get(id)?.type === 'REPAIR' && id !== targetUnitId,
        );
        if (repairers.length > 0) {
          this.send({
            type: 'REPAIR',
            playerId: session.localPlayer,
            unitIds: repairers,
            targetId: targetUnitId,
          });
          const rest = unitIds.filter((id) => byId.get(id)?.type !== 'REPAIR');
          if (rest.length > 0) {
            this.send({ type: 'MOVE', playerId: session.localPlayer, unitIds: rest, cx, cy });
          }
          return;
        }
      }
    }

    // Right-clicking another own unit → armed units escort it (ground, sea
    // and hovering helicopters — jets keep their sortie model).
    if (!e.ctrlKey) {
      const wardId = this.ownUnitAt(e.global);
      if (wardId !== null) {
        const escorts = unitIds.filter((id) => {
          const u = byId.get(id);
          if (!u || u.id === wardId) return false;
          const rule = unitRule(u.type);
          return rule.weapon !== null && (rule.air !== true || rule.hover === true);
        });
        if (escorts.length > 0) {
          this.send({ type: 'ESCORT', playerId: session.localPlayer, unitIds: escorts, targetId: wardId });
          const rest = unitIds.filter((id) => !escorts.includes(id));
          if (rest.length > 0) {
            this.send({ type: 'MOVE', playerId: session.localPlayer, unitIds: rest, cx, cy });
          }
          return;
        }
      }
    }

    // Repair vehicle right-clicking an own building → repair it.
    if (!e.ctrlKey) {
      const structId = this.state.structures[cellIndex(this.state, cx, cy)]!;
      const building = structId !== 0 ? this.state.buildings.find((b) => b.id === structId) : undefined;
      if (building && building.owner === session.localPlayer) {
        const repairers = unitIds.filter((id) => byId.get(id)?.type === 'REPAIR');
        if (repairers.length > 0) {
          this.send({
            type: 'REPAIR',
            playerId: session.localPlayer,
            unitIds: repairers,
            targetId: building.id,
          });
          const rest = unitIds.filter((id) => byId.get(id)?.type !== 'REPAIR');
          if (rest.length > 0) {
            this.send({ type: 'MOVE', playerId: session.localPlayer, unitIds: rest, cx, cy });
          }
          return;
        }
      }
    }

    if (!e.ctrlKey && this.state.ore[cellIndex(this.state, cx, cy)]! > 0) {
      const harvesters = unitIds.filter((id) => byId.get(id)?.type === 'HARVESTER');
      const rest = unitIds.filter((id) => byId.get(id)?.type !== 'HARVESTER');
      if (harvesters.length > 0) {
        this.send({ type: 'HARVEST', playerId: session.localPlayer, unitIds: harvesters, cx, cy });
        if (rest.length > 0) {
          this.send({ type: 'MOVE', playerId: session.localPlayer, unitIds: rest, cx, cy });
        }
        return;
      }
    }

    this.send({
      type: e.ctrlKey ? 'ATTACK_MOVE' : 'MOVE',
      playerId: session.localPlayer,
      unitIds,
      cx,
      cy,
    });
  }
}
