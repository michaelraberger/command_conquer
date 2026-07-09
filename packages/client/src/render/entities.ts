import {
  FOG_HIDDEN,
  FOG_VISIBLE,
  SUBCELL,
  buildingMaxHp,
  buildingRule,
  powerBalance,
  toCell,
  unitRule,
  type Building,
  type GameState,
  type Unit,
} from '@cac/sim';
import { Container, Graphics, Sprite } from 'pixi.js';
import { session } from '../session.js';
import { depthOf, worldToScreen } from './iso.js';
import type { GameTextures, UnitSprite } from './placeholders.js';

interface UnitView {
  root: Container;
  /** Neutral, faction-independent unit art. */
  body: Sprite;
  /** White team mask, tinted to the owner's faction colour. */
  team: Sprite;
  sel: Sprite;
  bar: Graphics;
  /** Control-group number badge above the unit (hidden unless in a marked group). */
  groupLabel: Sprite;
  lastHp: number;
  prevX: number;
  prevY: number;
  /** Aircraft fly at altitude and always draw above ground entities. */
  air: boolean;
}

interface BuildingView {
  root: Container;
  /** Neutral structure. */
  body: Sprite;
  /** White faction accent, tinted to the owner's colour. */
  team: Sprite;
  bar: Graphics;
  lastHp: number;
  lastLevel: number;
  /** The owner's faction colour (applied to the team accent). */
  teamColor: number;
  /** Whether the building currently renders as power-starved (avoids redundant writes). */
  lastStarved: boolean;
  /** Gates only: whether currently drawn open (a friendly unit is near). */
  gateOpen: boolean;
}

interface ProjectileView {
  sprite: Sprite;
  prevX: number;
  prevY: number;
}

const BAR_HEIGHT = 3;
/** Shared empty map so render() has a default when no groups are marked. */
const EMPTY_TAGS: ReadonlyMap<number, number> = new Map();
/** Dark cold tint for own power-consuming buildings during a power deficit. */
const OFFLINE_TINT = 0x424a55;
/** Screen-pixel lift for aircraft (body drawn this far above its ground shadow). */
const AIR_ALTITUDE = 24;
/** zIndex floor for aircraft so they always render above ground entities. */
const AIR_Z = 1_000_000;

/**
 * Presentation layer: keeps one sprite tree per sim entity and interpolates
 * between the previous and current tick positions. The sim never sees any of
 * this. Enemy entities respect the local player's fog of war.
 */
export class EntityRenderer {
  private views = new Map<number, UnitView>();
  private projectileViews = new Map<number, ProjectileView>();
  private buildingViews = new Map<number, BuildingView>();
  private strikeViews = new Map<number, Graphics>();
  private playerColors = new Map<number, number>();

  constructor(
    private layer: Container,
    private tex: GameTextures,
    state: GameState,
  ) {
    for (const p of state.players) this.playerColors.set(p.id, p.color);
  }

  /** Call right before every sim tick so render() can interpolate. */
  snapshotPrev(state: GameState): void {
    for (const unit of state.units) {
      const view = this.views.get(unit.id);
      if (view) {
        view.prevX = unit.x;
        view.prevY = unit.y;
      }
    }
    for (const p of state.projectiles) {
      const view = this.projectileViews.get(p.id);
      if (view) {
        view.prevX = p.x;
        view.prevY = p.y;
      }
    }
  }

  render(
    state: GameState,
    alpha: number,
    selected: ReadonlySet<number>,
    groupTags: ReadonlyMap<number, number> = EMPTY_TAGS,
  ): void {
    const fog = state.fogs[session.localPlayer]!;
    this.syncBuildings(state, fog);

    const seen = new Set<number>();
    for (const unit of state.units) {
      seen.add(unit.id);
      const view = this.views.get(unit.id) ?? this.createView(unit);
      const fx = view.prevX + (unit.x - view.prevX) * alpha;
      const fy = view.prevY + (unit.y - view.prevY) * alpha;

      // Enemy units are only drawn inside currently visible cells.
      const visible =
        unit.owner === session.localPlayer ||
        fog[toCell(unit.y) * state.mapWidth + toCell(unit.x)] === FOG_VISIBLE;
      view.root.visible = visible;
      if (!visible) continue;

      const { x, y } = worldToScreen(fx, fy);
      view.root.position.set(x, y);
      view.root.zIndex = view.air ? AIR_Z + depthOf(fx, fy) : depthOf(fx, fy);
      const spr = this.spriteFor(unit);
      view.body.texture = spr.body;
      view.team.texture = spr.team;
      view.sel.visible = selected.has(unit.id);
      this.updateUnitBar(unit, view, selected.has(unit.id));

      // Control-group number badge above units of a marked group.
      const tag = groupTags.get(unit.id) ?? 0;
      if (tag > 0) {
        view.groupLabel.texture = this.tex.digits[tag]!;
        view.groupLabel.visible = true;
      } else {
        view.groupLabel.visible = false;
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.views.delete(id);
      }
    }

    seen.clear();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let view = this.projectileViews.get(p.id);
      if (!view) {
        const sprite = new Sprite(this.tex.projectile);
        sprite.anchor.set(0.5);
        this.layer.addChild(sprite);
        view = { sprite, prevX: p.x, prevY: p.y };
        this.projectileViews.set(p.id, view);
      }
      const fx = view.prevX + (p.x - view.prevX) * alpha;
      const fy = view.prevY + (p.y - view.prevY) * alpha;
      view.sprite.visible = fog[toCell(fy) * state.mapWidth + toCell(fx)] !== FOG_HIDDEN;
      const { x, y } = worldToScreen(fx, fy);
      view.sprite.position.set(x, y - 10); // shells fly slightly above ground
      view.sprite.zIndex = depthOf(fx, fy) + 1;
    }
    for (const [id, view] of this.projectileViews) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        this.projectileViews.delete(id);
      }
    }

    this.syncStrikes(state);
  }

  /** Pulsing warning markers where a superweapon is about to land. */
  private syncStrikes(state: GameState): void {
    const seen = new Set<number>();
    for (const strike of state.strikes) {
      seen.add(strike.id);
      let marker = this.strikeViews.get(strike.id);
      if (!marker) {
        marker = new Graphics();
        marker.ellipse(0, 0, 42, 21).stroke({ width: 2, color: 0xff4d4d, alpha: 0.9 });
        marker.ellipse(0, 0, 22, 11).stroke({ width: 1.5, color: 0xff4d4d, alpha: 0.7 });
        marker.moveTo(-10, 0).lineTo(10, 0).stroke({ width: 1.5, color: 0xff4d4d });
        marker.moveTo(0, -5).lineTo(0, 5).stroke({ width: 1.5, color: 0xff4d4d });
        const { x, y } = worldToScreen(strike.x, strike.y);
        marker.position.set(x, y);
        marker.zIndex = 1_000_000; // always on top of the battlefield
        this.layer.addChild(marker);
        this.strikeViews.set(strike.id, marker);
      }
      marker.alpha = 0.55 + 0.45 * Math.abs(((state.tick % 10) / 5) - 1); // pulse
    }
    for (const [id, marker] of this.strikeViews) {
      if (!seen.has(id)) {
        marker.destroy();
        this.strikeViews.delete(id);
      }
    }
  }

  private spriteFor(unit: Unit): UnitSprite {
    const sets: Record<Unit['type'], UnitSprite[]> = {
      TANK: this.tex.tank,
      MAMMOTH: this.tex.mammoth,
      ARTILLERY: this.tex.artillery,
      HARVESTER: this.tex.harvester,
      REPAIR: this.tex.repair,
      RIFLEMAN: this.tex.rifleman,
      ROCKETEER: this.tex.rocketeer,
      SNIPER: this.tex.sniper,
      SPION: this.tex.spion,
      MCV: this.tex.mcv,
      SCOUT: this.tex.scout,
      LIGHTTANK: this.tex.lighttank,
      FLAMER: this.tex.flamer,
      DOG: this.tex.dog,
      TESLATANK: this.tex.teslatank,
      FLAK: this.tex.flak,
      HELI: this.tex.heli,
      JET: this.tex.jet,
      STRIKEJET: this.tex.strikejet,
      AIRLIFT: this.tex.airlift,
      GUNBOAT: this.tex.gunboat,
      DESTROYER: this.tex.destroyer,
      SUB: this.tex.sub,
      TRANSPORT: this.tex.transport,
    };
    return sets[unit.type][unit.facing]!;
  }

  private syncBuildings(state: GameState, fog: Uint8Array): void {
    // Local player's power deficit — same condition as the sim uses, so the
    // "offline" look never disagrees with the actual mechanic.
    const balance = powerBalance(state, session.localPlayer);
    const localDeficit = balance.used > balance.produced;

    const seen = new Set<number>();
    for (const building of state.buildings) {
      seen.add(building.id);
      let view = this.buildingViews.get(building.id);
      if (!view) {
        view = this.createBuildingView(building);
        this.buildingViews.set(building.id, view);
      }
      // Buildings stay visible once explored (they don't move).
      view.root.visible =
        building.owner === session.localPlayer ||
        fog[building.cy * state.mapWidth + building.cx] !== FOG_HIDDEN;
      if (!view.root.visible) continue;
      if (building.type === 'WALL' && building.level !== view.lastLevel) {
        const def = this.tex.walls[building.level - 1]!;
        view.body.texture = def.texture;
        view.body.anchor.set(def.anchorX, def.anchorY);
        view.team.texture = def.team;
        view.team.anchor.set(def.anchorX, def.anchorY);
        view.lastLevel = building.level;
      }
      // Gates open when a friendly unit is within ~2.5 cells (cosmetic only).
      if (building.type === 'GATE') {
        const open = state.units.some((u) => {
          if (u.owner !== building.owner) return false;
          const ucx = u.cell % state.mapWidth;
          const ucy = (u.cell - ucx) / state.mapWidth;
          const dx = ucx - building.cx;
          const dy = ucy - building.cy;
          return dx * dx + dy * dy <= 6;
        });
        if (open !== view.gateOpen) {
          const def = open ? this.tex.gateOpen : this.tex.buildings.GATE;
          view.body.texture = def.texture;
          view.body.anchor.set(def.anchorX, def.anchorY);
          view.team.texture = def.team;
          view.team.anchor.set(def.anchorX, def.anchorY);
          view.gateOpen = open;
        }
      }
      // Own power-consuming buildings darken while starved of power.
      const starved =
        building.owner === session.localPlayer &&
        localDeficit &&
        buildingRule(building.type).power < 0;
      if (starved !== view.lastStarved) {
        view.body.tint = starved ? OFFLINE_TINT : 0xffffff;
        view.team.tint = starved ? OFFLINE_TINT : view.teamColor;
        view.lastStarved = starved;
      }
      this.updateBuildingBar(building, view);
    }
    for (const [id, view] of this.buildingViews) {
      if (!seen.has(id)) {
        view.root.destroy({ children: true });
        this.buildingViews.delete(id);
      }
    }
  }

  private createBuildingView(building: Building): BuildingView {
    const def =
      building.type === 'WALL'
        ? this.tex.walls[building.level - 1]!
        : this.tex.buildings[building.type];
    const root = new Container();
    // Neutral structure stays untinted; the team accent carries the faction.
    const body = new Sprite(def.texture);
    body.anchor.set(def.anchorX, def.anchorY);
    const teamColor = this.playerColors.get(building.owner) ?? 0xffffff;
    const team = new Sprite(def.team);
    team.anchor.set(def.anchorX, def.anchorY);
    team.tint = teamColor;
    const rule = buildingRule(building.type);
    const bar = new Graphics();
    const roof = worldToScreen(
      (building.cx + rule.width / 2) * SUBCELL,
      (building.cy + rule.height / 2) * SUBCELL,
    );
    const corner = worldToScreen(building.cx * SUBCELL, building.cy * SUBCELL);
    bar.position.set(roof.x - corner.x, -18);
    bar.visible = false;
    root.addChild(body, team, bar);
    const { x, y } = worldToScreen(building.cx * SUBCELL, building.cy * SUBCELL);
    root.position.set(x, y);
    root.zIndex = depthOf((building.cx + rule.width) * SUBCELL, (building.cy + rule.height) * SUBCELL);
    this.layer.addChild(root);
    return {
      root,
      body,
      team,
      bar,
      lastHp: -1,
      lastLevel: building.level,
      teamColor,
      lastStarved: false,
      gateOpen: false,
    };
  }

  private updateBuildingBar(building: Building, view: BuildingView): void {
    const maxHp = buildingMaxHp(building);
    const show = building.hp < maxHp;
    view.bar.visible = show;
    if (!show || building.hp === view.lastHp) return;
    view.lastHp = building.hp;
    const rule = buildingRule(building.type);
    const width = 14 + rule.width * 8;
    drawBar(view.bar, width, Math.max(0, building.hp / maxHp));
  }

  private updateUnitBar(unit: Unit, view: UnitView, isSelected: boolean): void {
    const maxHp = unitRule(unit.type).maxHp;
    const show = isSelected || unit.hp < maxHp;
    view.bar.visible = show;
    if (!show || unit.hp === view.lastHp) return;
    view.lastHp = unit.hp;
    drawBar(view.bar, 24, Math.max(0, unit.hp / maxHp));
  }

  private createView(unit: Unit): UnitView {
    const air = unitRule(unit.type).air === true;
    const lift = air ? AIR_ALTITUDE : 0;
    const root = new Container();
    const big = unit.type !== 'RIFLEMAN';
    const sel = new Sprite(big ? this.tex.selectLarge : this.tex.selectSmall);
    sel.anchor.set(0.5);
    sel.position.set(0, (big ? 0 : 2) - lift);
    sel.visible = false;
    const spr = this.spriteFor(unit);
    // Neutral body stays untinted; the team mask carries the faction colour.
    const body = new Sprite(spr.body);
    body.anchor.set(0.5);
    body.position.set(0, -lift);
    const team = new Sprite(spr.team);
    team.anchor.set(0.5);
    team.position.set(0, -lift);
    team.tint = this.playerColors.get(unit.owner) ?? 0xffffff;
    // Submerged submarines shimmer through the water surface (whole sprite).
    if (unitRule(unit.type).submerged === true) root.alpha = 0.55;
    const bar = new Graphics();
    bar.position.set(0, (big ? -24 : -17) - lift);
    bar.visible = false;
    // Control-group number badge, floating just above the health bar.
    const groupLabel = new Sprite();
    groupLabel.anchor.set(0.5);
    groupLabel.position.set(0, (big ? -31 : -24) - lift);
    groupLabel.visible = false;
    if (air) {
      // Ground shadow directly under the aircraft.
      const shadow = new Graphics().ellipse(0, 0, 11, 6).fill({ color: 0x000000, alpha: 0.28 });
      root.addChild(shadow);
    }
    root.addChild(sel, body, team, bar, groupLabel);
    this.layer.addChild(root);
    const view: UnitView = {
      root,
      body,
      team,
      sel,
      bar,
      groupLabel,
      lastHp: -1,
      prevX: unit.x,
      prevY: unit.y,
      air,
    };
    this.views.set(unit.id, view);
    return view;
  }
}

/** C&C-style segmented health bar. */
function drawBar(bar: Graphics, width: number, pct: number): void {
  const color = pct > 0.5 ? 0x53c94f : pct > 0.25 ? 0xe8c33a : 0xe04a3a;
  bar
    .clear()
    .rect(-width / 2 - 1, -1, width + 2, BAR_HEIGHT + 2)
    .fill({ color: 0x101010, alpha: 0.85 })
    .rect(-width / 2, 0, width * pct, BAR_HEIGHT)
    .fill(color);
  for (let x = 4; x < width; x += 4) {
    bar.rect(-width / 2 + x, 0, 1, BAR_HEIGHT).fill({ color: 0x101010, alpha: 0.4 });
  }
}
