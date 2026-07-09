import {
  BUILDING_RULES,
  FACING_COUNT,
  FACING_VECTORS,
  buildingRule,
  type BuildingType,
} from '@cac/sim';
import { Container, Graphics, Rectangle, Text, Texture, type Renderer } from 'pixi.js';
import { TILE_H, TILE_W } from './iso.js';

/**
 * Procedural placeholder art in the classic C&C badlands style, baked into
 * textures at startup. Units are drawn in neutral grays so they can be
 * faction-tinted at render time. Real sprite sheets can replace all of this
 * later — game code only ever consumes Texture objects from this registry.
 */
export interface BuildingSprite {
  /** Neutral, faction-independent structure. */
  texture: Texture;
  /** White faction accent, tinted to the owner's colour at render time. */
  team: Texture;
  /** Normalized anchor so the sprite sits on its footprint's top-left corner. */
  anchorX: number;
  anchorY: number;
}

/**
 * A unit's art in two layers per facing: a neutral, faction-independent body
 * and a white team mask that the renderer tints to the owner's colour. Lets
 * every unit keep its own detailed grey shape (readable at a glance) while the
 * faction shows only as a small coloured accent (turret hatch, stripe, …).
 */
export interface UnitSprite {
  body: Texture;
  team: Texture;
}

export interface GameTextures {
  dirt: Texture[];
  grass: Texture[];
  water: Texture;
  /** 3D rock outcrop variants, drawn in the entity layer like trees. */
  rocks: Texture[];
  ore: Texture;
  gems: Texture;
  tree: Texture;
  fogTile: Texture;
  tank: UnitSprite[];
  mammoth: UnitSprite[];
  artillery: UnitSprite[];
  rifleman: UnitSprite[];
  harvester: UnitSprite[];
  repair: UnitSprite[];
  rocketeer: UnitSprite[];
  sniper: UnitSprite[];
  spion: UnitSprite[];
  mcv: UnitSprite[];
  scout: UnitSprite[];
  lighttank: UnitSprite[];
  flamer: UnitSprite[];
  dog: UnitSprite[];
  teslatank: UnitSprite[];
  flak: UnitSprite[];
  heli: UnitSprite[];
  jet: UnitSprite[];
  strikejet: UnitSprite[];
  airlift: UnitSprite[];
  gunboat: UnitSprite[];
  destroyer: UnitSprite[];
  sub: UnitSprite[];
  transport: UnitSprite[];
  projectile: Texture;
  selectSmall: Texture;
  selectLarge: Texture;
  /** Small control-group number badges, indexed by digit (1–9; [0] unused). */
  digits: Texture[];
  buildings: Record<BuildingType, BuildingSprite>;
  /** Wall sprites per upgrade tier (level 1..3). */
  walls: BuildingSprite[];
  /** Open-gate sprite (swapped in when a friendly unit is near). */
  gateOpen: BuildingSprite;
}

/* ------------------------------- helpers -------------------------------- */

function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

/** Projects cell-space coordinates (fractions allowed) to local iso pixels. */
function iso(cx: number, cy: number): { x: number; y: number } {
  return { x: (cx - cy) * (TILE_W / 2), y: (cx + cy) * (TILE_H / 2) };
}

function diamondPath(): number[] {
  return [TILE_W / 2, 0, TILE_W, TILE_H / 2, TILE_W / 2, TILE_H, 0, TILE_H / 2];
}

function bakeTile(renderer: Renderer, g: Graphics): Texture {
  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, 0, TILE_W, TILE_H),
    resolution: 2,
  });
}

/** Deterministic pseudo-random speckle positions (pure function of i). */
function speckle(i: number): { x: number; y: number } {
  const x = 8 + ((i * 37) % 48);
  const y = 6 + ((i * 23 + (i % 5) * 11) % 20);
  return { x, y };
}

function groundTile(renderer: Renderer, base: number, dots: number, dotColor: number, seedOff: number): Texture {
  const g = new Graphics().poly(diamondPath()).fill(base);
  for (let i = 0; i < dots; i++) {
    const p = speckle(i + seedOff);
    // Keep speckles inside the diamond.
    const dx = Math.abs(p.x - TILE_W / 2) / (TILE_W / 2);
    const dy = Math.abs(p.y - TILE_H / 2) / (TILE_H / 2);
    if (dx + dy > 0.85) continue;
    g.circle(p.x, p.y, 1 + (i % 2)).fill({ color: dotColor, alpha: 0.5 });
  }
  g.poly(diamondPath()).stroke({ width: 1, color: shade(base, 0.8), alpha: 0.35 });
  return bakeTile(renderer, g);
}

/** Extruded iso box; origin (0,0) is the projected top-left footprint corner. */
function prismAt(
  g: Graphics,
  ox: number,
  oy: number,
  w: number,
  h: number,
  e: number,
  base: number,
): void {
  const p00 = iso(ox, oy);
  const pw0 = iso(ox + w, oy);
  const pwh = iso(ox + w, oy + h);
  const p0h = iso(ox, oy + h);
  g.poly([p0h.x, p0h.y - e, pwh.x, pwh.y - e, pwh.x, pwh.y, p0h.x, p0h.y]).fill(shade(base, 0.72));
  g.poly([pwh.x, pwh.y - e, pw0.x, pw0.y - e, pw0.x, pw0.y, pwh.x, pwh.y]).fill(shade(base, 0.5));
  g.poly([p00.x, p00.y - e, pw0.x, pw0.y - e, pwh.x, pwh.y - e, p0h.x, p0h.y - e])
    .fill(base)
    .stroke({ width: 1, color: 0x37322a, alpha: 0.9 });
}

/** Simple upright cylinder (cooling tower, silo). */
function cylinder(g: Graphics, x: number, yBase: number, r: number, h: number, base: number): void {
  g.rect(x - r, yBase - h, r * 2, h).fill(shade(base, 0.78));
  g.rect(x - r, yBase - h, r, h).fill(shade(base, 0.92));
  g.ellipse(x, yBase - h, r, r * 0.45).fill(base).stroke({ width: 1, color: 0x37322a, alpha: 0.8 });
  g.ellipse(x, yBase - h, r * 0.55, r * 0.25).fill(shade(base, 0.6));
}

function concretePlate(g: Graphics, w: number, h: number): void {
  const p00 = iso(0, 0);
  const pw0 = iso(w, 0);
  const pwh = iso(w, h);
  const p0h = iso(0, h);
  g.poly([p00.x, p00.y, pw0.x, pw0.y, pwh.x, pwh.y, p0h.x, p0h.y])
    .fill(0x9a927f)
    .stroke({ width: 1, color: 0x5d574a });
}

/* ------------------------------ buildings ------------------------------- */

interface BuildingArt {
  frameTop: number;
  /** Fixed detail / effect colour (never faction-tinted). */
  fx: number;
  /** Neutral structure + fx details. */
  body: (g: Graphics, w: number, h: number, fx: number) => void;
  /** Faction accent, drawn in white and tinted per owner at render time. */
  team: (g: Graphics, w: number, h: number) => void;
}

/** Faction accent diamond on the roof, at pixel height `e` above roof centre. */
function teamMark(g: Graphics, w: number, h: number, e: number): void {
  const c = iso(w / 2, h / 2);
  g.poly([c.x, c.y - e - 6, c.x + 13, c.y - e, c.x, c.y - e + 6, c.x - 13, c.y - e]).fill(0xffffff);
}

const BUILDING_ART: Record<BuildingType, BuildingArt> = {
  CONYARD: {
    frameTop: 52,
    fx: 0xf2f2f2,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.25, 0.25, 2.5, 2.5, 24, 0xb5ac99);
      prismAt(g, 1.7, 0.35, 0.85, 0.85, 44, 0xc4bba8); // crane tower
      const tip = iso(2.1, 0.8);
      g.rect(tip.x - 26, tip.y - 50, 28, 4).fill(0xd8b13c); // crane arm
    },
    team: (g) => teamMark(g, 1.4, 1.4, 24),
  },
  POWER: {
    frameTop: 46,
    fx: 0xffd94d,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 14, 0xb0a794);
      const t1 = iso(0.65, 1.0);
      const t2 = iso(1.45, 1.0);
      cylinder(g, t1.x, t1.y - 8, 9, 26, 0xc9c0ad);
      cylinder(g, t2.x, t2.y - 8, 9, 26, 0xc9c0ad);
    },
    team: (g) => teamMark(g, 1, 1.75, 12),
  },
  REFINERY: {
    frameTop: 40,
    fx: 0xffb02e,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 1.5, 1.5, 18, 0xb0a794);
      const silo = iso(2.3, 0.8);
      cylinder(g, silo.x, silo.y, 11, 24, 0xc9b06a);
      // Dock ramp toward the unload cell south of the footprint.
      const r0 = iso(1, h);
      g.poly([r0.x - 18, r0.y - 4, r0.x + 18, r0.y - 4, r0.x + 26, r0.y + 10, r0.x - 26, r0.y + 10])
        .fill(0x857c68);
    },
    team: (g) => teamMark(g, 0.95, 0.95, 18),
  },
  SILO: {
    frameTop: 38,
    fx: 0xdba832, // ore amber
    body: (g, w, h) => {
      concretePlate(g, w, h);
      const a = iso(0.7, 0.95);
      const b = iso(1.45, 1.2);
      cylinder(g, a.x, a.y - 4, 13, 30, 0xc9b06a); // main ore tank
      cylinder(g, b.x, b.y - 2, 8, 20, 0xb8a05e); // small tank
      g.ellipse(a.x, a.y - 34, 10, 4.5).fill(0xdba832); // ore heap on top (fx)
    },
    team: (g) => teamMark(g, 1, 1, 20),
  },
  BARRACKS: {
    frameTop: 30,
    fx: 0x9fd66b,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.1, 13, 0xb0a794);
      prismAt(g, 0.35, 1.25, 1.3, 0.55, 8, 0xa39a87); // annex
    },
    team: (g) => teamMark(g, 1, 0.7, 13),
  },
  FACTORY: {
    frameTop: 50,
    fx: 0xff8c42,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 2.6, 2.0, 28, 0xb5ac99);
      // Big vehicle door on the SE face.
      const d0 = iso(2.8, 1.35);
      g.poly([d0.x, d0.y - 22, d0.x - 26, d0.y - 9, d0.x - 26, d0.y + 7, d0.x, d0.y - 6]).fill(0x4a443a);
      prismAt(g, 0.4, 2.25, 2.0, 0.55, 8, 0xa39a87); // apron
      const v1 = iso(0.9, 0.8);
      cylinder(g, v1.x, v1.y - 26, 4, 10, 0x8f8775);
    },
    team: (g) => teamMark(g, 1.5, 1.2, 28),
  },
  WERKSTATT: {
    frameTop: 42,
    fx: 0x6db4d6,
    body: (g, w, h) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.4, 1.7, 10, 0xb0a794);
      // Open repair platform with a gantry crane.
      const a = iso(2.2, 0.35);
      const b = iso(2.2, 1.65);
      g.rect(a.x - 2, a.y - 34, 4, 34).fill(0x8f8775);
      g.rect(b.x - 2, b.y - 34, 4, 34).fill(0x8f8775);
      g.rect(Math.min(a.x, b.x) - 2, Math.min(a.y, b.y) - 36, Math.abs(b.x - a.x) + 4, 5).fill(0xd8b13c);
      // Schraubenschlüssel (open-end wrench) laid flat on the roof.
      const c = iso(0.85, 1.05);
      const wx = c.x, wy = c.y - 15;
      const steel = 0xd7dde3;
      const edge = 0x50565e;
      g.roundRect(wx - 1.7, wy - 2, 3.4, 15, 1.4).fill(steel).stroke({ width: 1, color: edge }); // handle
      g.roundRect(wx - 4.6, wy - 8, 9.2, 5.6, 1.6).fill(steel).stroke({ width: 1, color: edge }); // jaw head
      g.rect(wx - 1.5, wy - 8.8, 3, 3.6).fill(0x2a2f36); // slot (the open jaw)
    },
    team: (g) => teamMark(g, 0.7, 1.7, 12),
  },
  TECHCENTER: {
    frameTop: 48,
    fx: 0x7fd4ff, // tech blue
    body: (g, w, h) => {
      concretePlate(g, w, h);
      const c = iso(w / 2, h / 2);
      g.roundRect(c.x - 16, c.y - 26, 32, 26, 4).fill(0xb5ac99).stroke({ width: 1.2, color: OUTLINE });
      g.rect(c.x - 16, c.y - 26, 32, 6).fill(0xc4bba8); // roof highlight
      g.circle(c.x, c.y - 26, 11).fill(0xcfd6dc).stroke({ width: 1, color: 0x5a6068 }); // observation dome
      g.circle(c.x - 3, c.y - 29, 4).fill(0xe8edf2); // dome glint
      g.rect(c.x + 8, c.y - 46, 2, 20).fill(0x8f8775); // antenna mast
      g.circle(c.x + 9, c.y - 47, 3).fill(0x7fd4ff); // signal node (fx)
    },
    team: (g) => teamMark(g, 1, 1, 22),
  },
  TESLA: {
    frameTop: 52,
    fx: 0x7fd4ff,
    body: (g, _w, _h, fx) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      prismAt(g, 0.3, 0.3, 0.4, 0.4, 6, 0x8f8775);
      g.rect(c.x - 2.5, c.y - 42, 5, 38).fill(0x6f675a); // pole
      g.rect(c.x - 6, c.y - 26, 12, 3).fill(0x6f675a);
      g.rect(c.x - 5, c.y - 34, 10, 3).fill(0x6f675a);
      g.circle(c.x, c.y - 44, 7).fill(0x4a5560).stroke({ width: 1, color: 0x2b333c });
      g.circle(c.x, c.y - 44, 3.5).fill(fx);
      g.circle(c.x, c.y - 44, 9).stroke({ width: 1, color: fx, alpha: 0.5 });
    },
    team: (g) => teamMark(g, 0.5, 0.5, 7),
  },
  PILLBOX: {
    frameTop: 26,
    fx: 0xcfd6dc,
    body: (g, _w, _h) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      g.ellipse(c.x, c.y - 6, 19, 12).fill(0xa8a08c).stroke({ width: 1, color: 0x4a443a });
      g.ellipse(c.x, c.y - 10, 13, 8).fill(0xbdb5a4);
      g.rect(c.x - 9, c.y - 9, 18, 3.5).fill(0x3a352c); // firing slit
    },
    team: (g) => teamMark(g, 0.5, 0.5, 15),
  },
  HELIPAD: {
    frameTop: 22,
    fx: 0xcfd6dc,
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      const c = iso(1.5, 1.5);
      // Tarmac landing circle with a yellow rim and an "H" marking.
      g.ellipse(c.x, c.y, 46, 24).fill(0x4a463d).stroke({ width: 2, color: 0xd8b13c });
      g.rect(c.x - 11, c.y - 8, 3.5, 16).fill(fx);
      g.rect(c.x + 7.5, c.y - 8, 3.5, 16).fill(fx);
      g.rect(c.x - 11, c.y - 2, 22, 3.5).fill(fx);
      prismAt(g, 0.1, 0.1, 0.7, 0.7, 14, 0xb0a794); // control shack
    },
    team: (g) => teamMark(g, 0.4, 0.4, 16),
  },
  FLAKTOWER: {
    frameTop: 28,
    fx: 0xcfd6dc,
    body: (g, _w, _h, fx) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      prismAt(g, 0.28, 0.28, 0.44, 0.44, 8, 0x8f8775); // turret base
      g.circle(c.x, c.y - 12, 5).fill(0x9aa0a6).stroke({ width: 1, color: 0x4a4a4a }); // hub
      for (const ox of [-6, -2, 2, 6]) {
        g.rect(c.x + ox, c.y - 23, 1.8, 12).fill(0x6f6f6f); // AA barrels pointing up
      }
      g.circle(c.x, c.y - 12, 2).fill(fx);
    },
    team: (g) => teamMark(g, 0.5, 0.5, 5),
  },
  NUKESILO: {
    frameTop: 34,
    fx: 0xff4d4d,
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 14, 0xa8a08c);
      const c = iso(1, 1);
      // Silo hatch with warning ring and peeking warhead tip.
      g.ellipse(c.x, c.y - 14, 13, 7).fill(0x3a352c).stroke({ width: 2, color: fx });
      g.ellipse(c.x, c.y - 15, 6, 3.5).fill(0x55534c);
      g.poly([c.x, c.y - 24, c.x + 4, c.y - 16, c.x - 4, c.y - 16]).fill(0xd6d6d6);
      g.circle(c.x + 10, c.y - 20, 1.5).fill(fx); // warning light
    },
    team: (g) => teamMark(g, 1, 1, 18),
  },
  WEATHER: {
    frameTop: 44,
    fx: 0x7fd4ff,
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 12, 0xa8a08c);
      const c = iso(1, 1);
      // Storm dome with orbiting ring and antenna.
      g.ellipse(c.x, c.y - 18, 14, 11).fill(0x4a6a7d).stroke({ width: 1, color: 0x2b3f4c });
      g.ellipse(c.x - 4, c.y - 22, 5, 3.5).fill({ color: 0xbfeaff, alpha: 0.8 });
      g.ellipse(c.x, c.y - 16, 18, 5).stroke({ width: 1.5, color: fx, alpha: 0.7 });
      g.rect(c.x + 10, c.y - 38, 2, 18).fill(0x6f675a);
      g.circle(c.x + 11, c.y - 39, 2.5).fill(fx);
    },
    team: (g) => teamMark(g, 1, 1, 20),
  },
  SHIPYARD: {
    frameTop: 30,
    fx: 0x6db4d6,
    body: (g, w, h) => {
      // Dock platform floating on the water with a slipway and a crane.
      const p00 = iso(0.1, 0.1);
      const pw0 = iso(w - 0.1, 0.1);
      const pwh = iso(w - 0.1, h - 0.1);
      const p0h = iso(0.1, h - 0.1);
      g.poly([p00.x, p00.y, pw0.x, pw0.y, pwh.x, pwh.y, p0h.x, p0h.y]).fill(0x8a7f6a);
      g.poly([p00.x, p00.y, pw0.x, pw0.y, pwh.x, pwh.y, p0h.x, p0h.y])
        .stroke({ width: 2, color: 0x5d5546 });
      // Open wet slipway in the middle where hulls are launched.
      const s0 = iso(0.9, 1.1);
      const s1 = iso(2.1, 1.1);
      const s2 = iso(2.1, 2.6);
      const s3 = iso(0.9, 2.6);
      g.poly([s0.x, s0.y, s1.x, s1.y, s2.x, s2.y, s3.x, s3.y]).fill(0x2b5d8a);
      g.poly([s0.x, s0.y, s1.x, s1.y, s2.x, s2.y, s3.x, s3.y])
        .stroke({ width: 1.5, color: 0x1d3f5e });
      // Half-built hull sitting in the slip.
      const hc = iso(1.5, 1.85);
      g.ellipse(hc.x, hc.y, 16, 6).fill(0x9aa0a6).stroke({ width: 1, color: 0x4a4a4a });
      prismAt(g, 0.2, 0.2, 0.9, 0.7, 16, 0xb0a794); // workshop hall
      // Crane over the slipway.
      const cb = iso(2.55, 0.5);
      g.rect(cb.x - 2, cb.y - 34, 4, 32).fill(0x6f675a);
      g.rect(cb.x - 26, cb.y - 34, 30, 3).fill(0x6f675a);
      g.moveTo(cb.x - 24, cb.y - 31).lineTo(cb.x - 24, cb.y - 16).stroke({ width: 1, color: 0x4a443a });
    },
    team: (g) => teamMark(g, 0.55, 0.55, 18),
  },
  WALL: {
    // Level 1 sandbags — levels 2/3 get their own bake below.
    frameTop: 18,
    fx: 0xc9b06a,
    body: (g) => {
      const c = iso(0.5, 0.5);
      for (const [dx, dy] of [[-9, 2], [0, 6], [9, 2], [-4.5, -2], [4.5, -2], [0, -6]] as const) {
        g.ellipse(c.x + dx, c.y - 4 + dy * 0.5, 7, 4).fill(0xc2a368).stroke({ width: 1, color: 0x8a743f });
      }
    },
    team: (g) => {
      const c = iso(0.5, 0.5);
      g.rect(c.x - 3, c.y - 9, 6, 3).fill(0xffffff); // small faction chip
    },
  },
  GATE: {
    frameTop: 22,
    fx: 0xb7bec4,
    body: (g) => {
      const c = iso(0.5, 0.5);
      g.rect(c.x - 13, c.y - 16, 4, 20).fill(0x8f8775).stroke({ width: 1, color: OUTLINE }); // left post
      g.rect(c.x + 9, c.y - 16, 4, 20).fill(0x8f8775).stroke({ width: 1, color: OUTLINE }); // right post
      g.rect(c.x - 10, c.y - 13, 20, 3).fill(0xb7bec4).stroke({ width: 1, color: OUTLINE }); // barrier (closed)
      g.rect(c.x - 10, c.y - 7, 20, 3).fill(0xb7bec4).stroke({ width: 1, color: OUTLINE });
    },
    team: (g) => {
      const c = iso(0.5, 0.5);
      g.rect(c.x - 3, c.y - 20, 6, 3).fill(0xffffff);
    },
  },
};

function bakeBuilding(renderer: Renderer, type: BuildingType): BuildingSprite {
  const rule = buildingRule(type);
  const art = BUILDING_ART[type];
  const gb = new Graphics();
  art.body(gb, rule.width, rule.height, art.fx);
  const gt = new Graphics();
  art.team(gt, rule.width, rule.height);
  return bakeFootprint(renderer, gb, gt, rule.width, rule.height, art.frameTop);
}

function bakeFootprint(
  renderer: Renderer,
  gBody: Graphics,
  gTeam: Graphics,
  w: number,
  h: number,
  frameTop: number,
): BuildingSprite {
  const frame = new Rectangle(-h * 32 - 4, -frameTop, (w + h) * 32 + 8, (w + h) * 16 + frameTop + 6);
  return {
    texture: renderer.generateTexture({ target: gBody, frame, resolution: 2 }),
    team: renderer.generateTexture({ target: gTeam, frame, resolution: 2 }),
    anchorX: (h * 32 + 4) / frame.width,
    anchorY: frameTop / frame.height,
  };
}

function bakeWallLevel(renderer: Renderer, level: number): BuildingSprite {
  const g = new Graphics();
  const c = iso(0.5, 0.5);
  if (level === 1) {
    BUILDING_ART.WALL.body(g, 1, 1, BUILDING_ART.WALL.fx);
  } else if (level === 2) {
    prismAt(g, 0.12, 0.12, 0.76, 0.76, 12, 0xaaa398); // concrete block
    g.rect(c.x - 12, c.y - 14, 24, 2).fill({ color: 0x6e675c, alpha: 0.8 });
  } else {
    prismAt(g, 0.08, 0.08, 0.84, 0.84, 16, 0x7d8791); // reinforced steel
    for (const dx of [-10, 0, 10]) g.circle(c.x + dx, c.y - 17, 1.5).fill(0xcfd6dc);
    g.rect(c.x - 13, c.y - 12, 26, 2).fill(0x59636d);
  }
  const team = new Graphics();
  BUILDING_ART.WALL.team(team, 1, 1);
  return bakeFootprint(renderer, g, team, 1, 1, 22);
}

/* -------------------------------- units --------------------------------- */

function facingAngle(facing: number): number {
  const [vx, vy] = FACING_VECTORS[facing]!;
  return Math.atan2(vx + vy, 2 * (vx - vy));
}

/* Neutral steel palette — units read by shape/shading; faction shows via the
   white team layer that the renderer tints. */
const HULL = 0x9aa0a6;
const HULL_HI = 0xc5cad0;
const HULL_LO = 0x686f77;
const OUTLINE = 0x24272c;
const TREAD = 0x33363b;
const METAL = 0x7c828a;
const METAL_DK = 0x50555b;
const GLASS = 0x86a7bf;
/** Infantry olive-drab palette. */
const UNIFORM = 0x8d8a72;
const UNIFORM_HI = 0xb1ad91;
const GEAR = 0x33332c;

/** Bakes one layer (body or team mask) at a facing into a texture. */
function bakeUnitLayer(
  renderer: Renderer,
  size: number,
  facing: number,
  draw: (g: Graphics) => void,
  withShadow: boolean,
): Texture {
  const root = new Container();
  if (withShadow) {
    root.addChild(
      new Graphics().ellipse(0, 5, size * 0.62, size * 0.34).fill({ color: 0x000000, alpha: 0.32 }),
    );
  }
  const g = new Graphics();
  draw(g);
  g.rotation = facingAngle(facing);
  root.addChild(g);
  return renderer.generateTexture({
    target: root,
    frame: new Rectangle(-size, -size, size * 2, size * 2),
    resolution: 2,
  });
}

/** Two-layer vehicle sprite: neutral body (with drop shadow) + white team mask. */
function bakeVehicle(
  renderer: Renderer,
  facing: number,
  size: number,
  drawBody: (g: Graphics) => void,
  drawTeam: (g: Graphics) => void,
): UnitSprite {
  return {
    body: bakeUnitLayer(renderer, size, facing, drawBody, true),
    team: bakeUnitLayer(renderer, size, facing, drawTeam, false),
  };
}

// ── Medium tank: tracked hull, round turret, single cannon ──
function drawTank(g: Graphics): void {
  g.rect(-15, -13, 30, 5).fill(TREAD);
  g.rect(-15, 8, 30, 5).fill(TREAD);
  g.roundRect(-15, -9, 30, 18, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-15, -9, 30, 4).fill(HULL_HI);
  g.circle(-1, 0, 8).fill(HULL_HI).stroke({ width: 1.2, color: OUTLINE });
  g.rect(6, -2.2, 19, 4.4).fill(METAL);
  g.rect(23, -2.6, 4, 5.2).fill(METAL_DK); // muzzle
}
function teamTank(g: Graphics): void {
  g.circle(-1, 0, 3.2).fill(0xffffff); // turret hatch
}

// ── Mammoth: huge, wide, twin barrels, boxy turret ──
function drawMammoth(g: Graphics): void {
  g.rect(-20, -17, 40, 6).fill(TREAD);
  g.rect(-20, 11, 40, 6).fill(TREAD);
  g.roundRect(-20, -13, 40, 26, 4).fill(HULL).stroke({ width: 1.4, color: OUTLINE });
  g.rect(-20, -13, 40, 5).fill(HULL_HI);
  g.roundRect(-9, -9, 20, 18, 3).fill(HULL_HI).stroke({ width: 1.2, color: OUTLINE });
  g.rect(8, -7, 22, 4.5).fill(METAL);
  g.rect(8, 2.5, 22, 4.5).fill(METAL);
  g.rect(28, -7.6, 4, 5).fill(METAL_DK);
  g.rect(28, 2.2, 4, 5).fill(METAL_DK);
}
function teamMammoth(g: Graphics): void {
  g.roundRect(-6, -4, 11, 8, 2).fill(0xffffff); // turret roof
}

// ── Artillery: open darker chassis, gun shield, very long thin barrel ──
function drawArtillery(g: Graphics): void {
  g.rect(-14, -11, 26, 5).fill(TREAD);
  g.rect(-14, 6, 26, 5).fill(TREAD);
  g.roundRect(-14, -8, 22, 16, 2).fill(HULL_LO).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-14, -8, 22, 3).fill(HULL);
  g.poly([-2, -8, 6, -8, 6, 8, -2, 8]).fill(HULL).stroke({ width: 1, color: OUTLINE }); // shield
  g.rect(2, -1.6, 30, 3.2).fill(METAL); // long barrel
  g.rect(30, -2.2, 4, 4.4).fill(METAL_DK);
}
function teamArtillery(g: Graphics): void {
  g.rect(-12, -3, 6, 6).fill(0xffffff); // rear crew box
}

// ── Harvester: bulky, ore bin, front scoop with teeth ──
function drawHarvester(g: Graphics): void {
  g.rect(-17, -14, 34, 6).fill(TREAD);
  g.rect(-17, 8, 34, 6).fill(TREAD);
  g.roundRect(-17, -10, 30, 20, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-17, -10, 30, 5).fill(HULL_HI);
  g.roundRect(-14, -7, 12, 14, 2).fill(HULL_LO); // ore bin
  g.poly([13, -8, 22, -4, 22, 4, 13, 8]).fill(METAL).stroke({ width: 1, color: OUTLINE }); // scoop
  for (const oy of [-5, -1, 3]) g.rect(19, oy, 4, 1.6).fill(METAL_DK); // teeth
}
function teamHarvester(g: Graphics): void {
  g.rect(-12, -4, 8, 8).fill(0xffffff); // bin lid
}

// ── Repair vehicle: service body + forward crane boom & hook ──
function drawRepair(g: Graphics): void {
  g.rect(-14, -11, 26, 5).fill(TREAD);
  g.rect(-14, 7, 26, 5).fill(TREAD);
  g.roundRect(-14, -8, 20, 16, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.roundRect(-13, -6, 9, 12, 2).fill(HULL_HI); // cab
  g.circle(-2, 0, 2.6).fill(METAL_DK); // crane pivot
  g.rect(-2, -1, 16, 2.4).fill(METAL); // boom
  g.rect(13, -3, 2.4, 6).fill(METAL_DK); // hook head
  // Red service cross on the cab roof (fixed colour, never faction-tinted).
  g.roundRect(-10, -0.6, 5.2, 1.6, 0.5).fill(0xffffff);
  g.roundRect(-8.2, -2.4, 1.6, 5.2, 0.5).fill(0xffffff);
  g.roundRect(-9.7, -0.3, 4.6, 1, 0.5).fill(0xe23b32);
  g.roundRect(-7.9, -2.1, 1, 4.6, 0.5).fill(0xe23b32);
}
function teamRepair(g: Graphics): void {
  g.roundRect(1, -3.5, 4.5, 7, 1.5).fill(0xffffff); // accent panel on the service body
}

/** Two-layer foot-soldier sprite: neutral olive body + white helmet/gear mask. */
function bakeInfantry(
  renderer: Renderer,
  facing: number,
  drawBody: (g: Graphics) => void,
  drawTeam: (g: Graphics) => void,
): UnitSprite {
  const frame = new Rectangle(-16, -16, 32, 32);
  const bodyRoot = new Container();
  bodyRoot.addChild(new Graphics().ellipse(0, 3, 8, 5).fill({ color: 0x000000, alpha: 0.32 }));
  const gb = new Graphics();
  drawBody(gb);
  gb.rotation = facingAngle(facing);
  bodyRoot.addChild(gb);
  const gt = new Graphics();
  drawTeam(gt);
  gt.rotation = facingAngle(facing);
  return {
    body: renderer.generateTexture({ target: bodyRoot, frame, resolution: 2 }),
    team: renderer.generateTexture({ target: gt, frame, resolution: 2 }),
  };
}

// Infantry team accent sits at the centre (helmet), so it stays put as the
// figure rotates. Weapons/props point +x and give each type its silhouette.
function teamHelmet(g: Graphics): void {
  g.circle(0, 0, 2.3).fill(0xffffff);
}

function drawRifleman(body: Graphics): void {
  body.rect(2, -0.9, 10, 1.9).fill(GEAR); // rifle
  body.circle(0, 0, 5).fill(UNIFORM).stroke({ width: 1, color: 0x2a2a24 });
  body.circle(-1.4, -1.4, 2).fill(UNIFORM_HI); // shoulder highlight
}

function drawRocketeer(body: Graphics): void {
  body.rect(1, -2.6, 13, 3.6).fill(0x4a4a42); // launcher tube
  body.circle(14, -0.8, 1.9).fill(0xc0673a); // warhead tip
  body.circle(0, 0, 5).fill(UNIFORM).stroke({ width: 1, color: 0x2a2a24 });
  body.circle(-1.4, 1.4, 1.8).fill(UNIFORM_HI);
}

function drawSniper(body: Graphics): void {
  body.rect(2, -0.7, 16, 1.4).fill(GEAR); // very long rifle barrel
  body.rect(17, -1, 3, 2).fill(METAL_DK); // muzzle
  body.circle(0, 0, 5).fill(UNIFORM).stroke({ width: 1, color: 0x2a2a24 });
  body.rect(4, -1.8, 4, 1.3).fill(0x2a2a24); // scope
  body.circle(-1.4, 1.4, 1.8).fill(UNIFORM_HI); // shoulder highlight
}

function drawFlamer(body: Graphics): void {
  body.roundRect(-6.5, -3, 5, 6, 1.5).fill(0x5f5f52).stroke({ width: 1, color: 0x2a2a24 }); // twin tanks
  body.circle(0, 0, 5).fill(UNIFORM).stroke({ width: 1, color: 0x2a2a24 });
  body.rect(3, -1.4, 12, 2.8).fill(GEAR); // nozzle
  body.circle(15, 0, 2).fill(0xff8a3a); // pilot flame
}

function drawDog(body: Graphics): void {
  body.ellipse(-1, 0, 6.5, 3.2).fill(0x8f8878).stroke({ width: 1, color: 0x2a2a24 }); // body
  body.poly([-7.5, -0.6, -11, -1.8, -11, 1.4, -7.5, 0.8]).fill(0x7a7466); // tail
  body.circle(6, 0, 2.8).fill(0xa39c88).stroke({ width: 1, color: 0x2a2a24 }); // head
  body.poly([8, -1.5, 12, -2, 10, 0.6]).fill(0x8f8878); // snout
  for (const [lx, ly] of [[-4, 2.6], [3, 2.6], [-4, -4], [3, -4]] as const) {
    body.rect(lx, ly, 1.4, 2).fill(0x5f5a4f); // legs
  }
}
function teamDog(g: Graphics): void {
  g.rect(1, -2.4, 3, 4.8).fill(0xffffff); // collar/harness across the neck
}

// ── MCV: bulky construction rig with a folded frame on the flatbed ──
function drawMcv(g: Graphics): void {
  g.rect(-16, -14, 32, 5).fill(TREAD);
  g.rect(-16, 9, 32, 5).fill(TREAD);
  g.roundRect(-16, -10, 32, 20, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-16, -10, 32, 4).fill(HULL_HI);
  g.roundRect(-11, -7, 18, 14, 2).fill(HULL_LO); // flatbed with the folded structure
  for (const oy of [-5, -1, 3]) g.rect(-9, oy, 15, 2).fill(METAL);
  g.roundRect(9, -6, 6, 12, 2).fill(GLASS); // cab
}
function teamMcv(g: Graphics): void {
  g.roundRect(-7, -4, 8, 8, 2).fill(0xffffff); // frame panel
}

// ── Spy: dark trench coat + fedora + briefcase of loot, no weapon ──
function drawSpion(body: Graphics): void {
  body.circle(0, 0, 5).fill(0x3b414a).stroke({ width: 1, color: 0x22252b }); // trench coat
  body.circle(0, 0, 4.2).fill(0x2b3038); // fedora crown (dark, no weapon rod)
  body.roundRect(4, 1.6, 5, 3.4, 1).fill(0xcaa64a).stroke({ width: 1, color: 0x22252b }); // briefcase
}

// ── Scout: light wheeled recon car (visible wheels), open-top MG ──
function drawScout(g: Graphics): void {
  for (const ox of [-8, 0, 8]) {
    g.circle(ox, -7.5, 3).fill(TREAD);
    g.circle(ox, 7.5, 3).fill(TREAD);
  }
  g.roundRect(-11, -6, 22, 12, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-11, -6, 22, 4).fill(HULL_HI);
  g.roundRect(-4, -4, 9, 8, 2).fill(GLASS); // windshield/cabin
  g.rect(5, -1, 10, 2).fill(METAL); // pintle MG
}
function teamScout(g: Graphics): void {
  g.rect(-9, -3, 6, 6).fill(0xffffff); // rear plate
}

// ── Light tank: small angular wedge hull, small turret ──
function drawLightTank(g: Graphics): void {
  g.rect(-12, -10, 24, 4.5).fill(TREAD);
  g.rect(-12, 6, 24, 4.5).fill(TREAD);
  g.poly([-12, -8, 8, -8, 13, 0, 8, 8, -12, 8]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.poly([-12, -8, 8, -8, 9, -5, -12, -5]).fill(HULL_HI);
  g.circle(-2, 0, 6).fill(HULL_HI).stroke({ width: 1.2, color: OUTLINE });
  g.rect(4, -1.6, 16, 3.2).fill(METAL);
  g.rect(18, -2, 3.5, 4).fill(METAL_DK);
}
function teamLightTank(g: Graphics): void {
  g.circle(-2, 0, 2.6).fill(0xffffff);
}

// ── Tesla tank: tracked hull crowned by a glowing coil ──
function drawTeslaTank(g: Graphics): void {
  g.rect(-15, -12, 30, 5).fill(TREAD);
  g.rect(-15, 7, 30, 5).fill(TREAD);
  g.roundRect(-15, -9, 30, 18, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-15, -9, 30, 4).fill(HULL_HI);
  g.circle(2, 0, 6).fill(0x5a636d).stroke({ width: 1.2, color: OUTLINE }); // coil base
  g.circle(2, 0, 3).fill(0xdff2ff); // energy node
  g.circle(2, 0, 8).stroke({ width: 1.2, color: 0xbfeaff, alpha: 0.7 }); // arc ring
}
function teamTeslaTank(g: Graphics): void {
  g.rect(-13, -3, 6, 6).fill(0xffffff); // rear hull plate
}

// ── Flak: light chassis, quad barrels raised forward ──
function drawFlak(g: Graphics): void {
  g.rect(-12, -10, 24, 4.5).fill(TREAD);
  g.rect(-12, 6, 24, 4.5).fill(TREAD);
  g.roundRect(-12, -8, 24, 16, 3).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-12, -8, 24, 4).fill(HULL_HI);
  g.circle(-2, 0, 5).fill(HULL_HI).stroke({ width: 1.2, color: OUTLINE }); // turret ring
  for (const oy of [-3.6, -1.2, 1.2, 3.6]) {
    g.rect(2, oy - 0.6, 17, 1.6).fill(METAL);
    g.rect(18, oy - 0.7, 2, 1.8).fill(METAL_DK);
  }
}
function teamFlak(g: Graphics): void {
  g.circle(-2, 0, 2.4).fill(0xffffff);
}

// ── Attack helicopter: fuselage + tail boom + faint rotor disc ──
function drawHeli(g: Graphics): void {
  g.ellipse(-16, 0, 8, 2.5).fill(HULL_LO); // tail boom
  g.rect(-24, -4, 4, 8).fill(METAL); // tail fin
  g.roundRect(-8, -6, 22, 12, 5).fill(HULL).stroke({ width: 1.2, color: OUTLINE }); // fuselage
  g.rect(-8, -6, 22, 4).fill(HULL_HI);
  g.roundRect(6, -4, 8, 8, 3).fill(GLASS); // cockpit
  g.rect(2, -9, 3, 18).fill(METAL_DK); // weapon pylons
  g.circle(0, 0, 22).fill({ color: 0xe8edf2, alpha: 0.15 }); // rotor disc
  g.circle(0, 0, 22).stroke({ width: 1, color: 0xffffff, alpha: 0.22 });
}
function teamHeli(g: Graphics): void {
  g.rect(-6, -3, 8, 6).fill(0xffffff); // fuselage panel
}

// ── Jet: pointed fuselage, swept wings, tailplanes ──
function drawJet(g: Graphics): void {
  g.poly([22, 0, 6, -4, -16, -3, -16, 3, 6, 4]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.poly([-2, -3, -10, -18, -16, -18, -8, -3]).fill(HULL_LO); // left wing
  g.poly([-2, 3, -10, 18, -16, 18, -8, 3]).fill(HULL_LO); // right wing
  g.poly([-13, -2, -20, -8, -20, -2]).fill(METAL); // tailplane L
  g.poly([-13, 2, -20, 8, -20, 2]).fill(METAL); // tailplane R
  g.circle(10, 0, 2.4).fill(GLASS); // canopy
  g.circle(-16, 0, 2.4).fill(0xff8a3a); // exhaust glow
}
function teamJet(g: Graphics): void {
  g.rect(-8, -1.6, 10, 3.2).fill(0xffffff); // spine stripe
}

// ── Allied strike jet: slender fuselage, delta wings, twin exhausts ──
function drawStrikeJet(g: Graphics): void {
  g.poly([24, 0, 8, -3, -16, -2.5, -16, 2.5, 8, 3]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.poly([4, -2.5, -14, -16, -16, -3]).fill(HULL_LO); // left delta wing
  g.poly([4, 2.5, -14, 16, -16, 3]).fill(HULL_LO); // right delta wing
  g.poly([-12, -1.5, -19, -6, -19, -1.5]).fill(METAL); // tailplane L
  g.poly([-12, 1.5, -19, 6, -19, 1.5]).fill(METAL); // tailplane R
  g.circle(12, 0, 2.2).fill(GLASS); // canopy
  g.circle(-16, -1.5, 1.7).fill(0xff8a3a); // twin exhausts
  g.circle(-16, 1.5, 1.7).fill(0xff8a3a);
}
function teamStrikeJet(g: Graphics): void {
  g.poly([3, 0, -6, -2.8, -6, 2.8]).fill(0xffffff); // nose chevron
}

// ── Cargo helicopter: long boxy fuselage, tandem twin rotor discs, rear ramp ──
function drawAirlift(g: Graphics): void {
  g.roundRect(-18, -7, 36, 14, 4).fill(HULL).stroke({ width: 1.2, color: OUTLINE }); // fuselage
  g.rect(-18, -7, 36, 4).fill(HULL_HI); // top highlight
  g.roundRect(10, -5, 8, 10, 3).fill(GLASS); // cockpit
  g.rect(-18, -5, 5, 10).fill(METAL_DK); // rear loading ramp
  g.roundRect(-8, -6, 14, 12, 2).fill(HULL_LO); // cargo bay
  g.rect(-2, -3, 3, 6).fill(METAL); // rotor mast strut
  // Tandem rotor hubs + faint discs — the twin-rotor silhouette sets it apart.
  for (const hx of [11, -11]) {
    g.circle(hx, 0, 15).fill({ color: 0xe8edf2, alpha: 0.13 });
    g.circle(hx, 0, 15).stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
    g.circle(hx, 0, 3).fill(METAL);
  }
}
function teamAirlift(g: Graphics): void {
  g.rect(-5, -3.5, 11, 7).fill(0xffffff); // fuselage panel
}

/* Ships face +x like vehicles; bakeVehicle's drop shadow reads as their wake. */

// ── Patrol gunboat: small pointed hull, cabin, deck MG ──
function drawGunboat(g: Graphics): void {
  g.poly([18, 0, 10, -5, -14, -5, -17, 0, -14, 5, 10, 5]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.poly([18, 0, 10, -5, 10, 5]).fill(HULL_HI); // bow deck
  g.roundRect(-10, -3, 12, 6, 2).fill(HULL_LO); // cabin
  g.circle(4, 0, 3).fill(METAL).stroke({ width: 1, color: OUTLINE }); // MG mount
  g.rect(6, -0.8, 9, 1.6).fill(METAL_DK);
  g.rect(-16, -1, 3, 2).fill(METAL_DK); // stern
}
function teamGunboat(g: Graphics): void {
  g.roundRect(-9, -2, 8, 4, 1).fill(0xffffff); // cabin roof
}

// ── Destroyer: long hull, two turrets, radar mast ──
function drawDestroyer(g: Graphics): void {
  g.poly([26, 0, 16, -6, -20, -6, -25, 0, -20, 6, 16, 6]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.poly([26, 0, 16, -6, 16, 6]).fill(HULL_HI); // bow
  g.roundRect(-12, -4, 16, 8, 2).fill(HULL_LO); // superstructure
  g.rect(-2, -10, 2, 8).fill(METAL_DK); // mast
  g.circle(-1, -11, 2).fill(0xcfd6dc); // radar
  for (const ox of [10, -18]) {
    g.circle(ox, 0, 3.5).fill(HULL_HI).stroke({ width: 1, color: OUTLINE }); // turret
    g.rect(ox + 2, -1, 9, 2).fill(METAL); // barrel
  }
}
function teamDestroyer(g: Graphics): void {
  g.roundRect(-11, -3, 14, 6, 1).fill(0xffffff); // superstructure roof
}

// ── Submarine: slender teardrop hull + conning tower (rendered dimmed) ──
function drawSub(g: Graphics): void {
  g.ellipse(0, 0, 22, 5.5).fill(HULL_LO).stroke({ width: 1, color: OUTLINE }); // hull
  g.ellipse(8, 0, 8, 3).fill(HULL); // fore deck
  g.roundRect(-6, -3, 10, 6, 2.5).fill(0x4b545d).stroke({ width: 1, color: OUTLINE }); // tower
  g.rect(-2, -6, 1.6, 4).fill(METAL_DK); // periscope
  g.ellipse(-19, 0, 4, 2.2).fill(0x4b545d); // stern planes
}
function teamSub(g: Graphics): void {
  g.roundRect(-5, -2, 8, 4, 1).fill(0xffffff); // tower top
}

// ── Transport: broad hull, cargo well, bow loading ramp ──
function drawTransportShip(g: Graphics): void {
  g.poly([20, 0, 14, -8, -18, -8, -22, 0, -18, 8, 14, 8]).fill(HULL).stroke({ width: 1.2, color: OUTLINE });
  g.roundRect(-16, -6, 28, 12, 2).fill(HULL_LO); // cargo well
  for (const ox of [-10, -2, 6]) g.rect(ox, -6, 1, 12).fill(METAL_DK); // deck ribs
  g.poly([20, 0, 14, -8, 14, 8]).fill(HULL_HI); // bow ramp
  g.roundRect(-21, -3, 5, 6, 1.5).fill(HULL_LO); // pilot house
}
function teamTransportShip(g: Graphics): void {
  g.roundRect(-20, -2, 4, 4, 1).fill(0xffffff); // pilot house roof
}

/**
 * Craggy 3D rock outcrop: irregular silhouette with a sun-lit north-west
 * face, a mid-tone top and a shaded south-east face — same light direction
 * as the building prisms. Variants keep ridges from looking cloned.
 */
function bakeRock(renderer: Renderer, variant: number): Texture {
  const g = new Graphics();
  g.ellipse(0, 5, 24, 10).fill({ color: 0x000000, alpha: 0.28 });

  if (variant === 0) {
    // Tall crag with two peaks.
    g.poly([-24, 2, -14, -14, -4, -30, 0, -4, -10, 8]).fill(0xa39e90); // lit NW face
    g.poly([-4, -30, 4, -22, 12, -14, 8, 2, 0, -4]).fill(0x87837a); // top ridge
    g.poly([12, -14, 24, -2, 16, 8, 8, 2]).fill(0x615e56); // shaded SE face
    g.poly([0, -4, 8, 2, 16, 8, 2, 10, -10, 8]).fill(0x716e65); // foot
    g.moveTo(-14, -14).lineTo(-8, -2).stroke({ width: 1, color: 0x4f4d47, alpha: 0.6 });
    g.moveTo(4, -22).lineTo(6, -8).stroke({ width: 1, color: 0x4f4d47, alpha: 0.6 });
  } else if (variant === 1) {
    // Broad ridge, single blunt peak.
    g.poly([-26, 4, -16, -10, -2, -18, 2, -2, -12, 9]).fill(0x9d988a);
    g.poly([-2, -18, 10, -12, 18, -4, 8, 4, 2, -2]).fill(0x7d7a72);
    g.poly([18, -4, 26, 4, 14, 10, 8, 4]).fill(0x5f5d56);
    g.poly([2, -2, 8, 4, 14, 10, -2, 12, -12, 9]).fill(0x6e6b63);
    g.moveTo(-16, -10).lineTo(-6, 0).stroke({ width: 1, color: 0x4f4d47, alpha: 0.5 });
  } else {
    // Boulder pile.
    g.ellipse(-9, -4, 12, 9).fill(0x94907f).stroke({ width: 1, color: 0x55534c, alpha: 0.7 });
    g.ellipse(8, -2, 10, 8).fill(0x7d7a72).stroke({ width: 1, color: 0x4f4d47, alpha: 0.7 });
    g.ellipse(0, -12, 9, 7).fill(0xa39e90).stroke({ width: 1, color: 0x55534c, alpha: 0.7 });
    g.ellipse(-12, -7, 4, 3).fill(0xb0ab9c); // highlights
    g.ellipse(-3, -15, 3, 2).fill(0xbdb8a9);
  }
  // Scattered pebbles at the base.
  g.circle(-18, 6, 1.5).fill(0x7d7a72);
  g.circle(16, 8, 1.5).fill(0x716e65);
  g.circle(4, 11, 1.2).fill(0x87837a);

  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(-28, -34, 56, 48),
    resolution: 2,
  });
}

/** C&C-style white corner brackets around a box. */
function bakeBrackets(renderer: Renderer, w: number, h: number): Texture {
  const g = new Graphics();
  const l = 6;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  for (const [cx, cy, sx, sy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    g.moveTo(cx, cy).lineTo(cx + l * sx, cy).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
    g.moveTo(cx, cy).lineTo(cx, cy + l * sy).stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
  }
  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(x0 - 2, y0 - 2, w + 4, h + 4),
    resolution: 2,
  });
}

/** Small rounded badge with a white control-group digit, for the unit overlay. */
function bakeDigit(renderer: Renderer, digit: number): Texture {
  const root = new Container();
  root.addChild(
    new Graphics()
      .roundRect(-8, -8, 16, 16, 4)
      .fill({ color: 0x101418, alpha: 0.85 })
      .stroke({ width: 1, color: 0x8aff8a, alpha: 0.9 }),
  );
  const label = new Text({
    text: String(digit),
    style: { fontFamily: 'Menlo, Consolas, monospace', fontSize: 13, fontWeight: '700', fill: 0xffffff },
  });
  label.anchor.set(0.5);
  label.position.set(0, 0);
  root.addChild(label);
  return renderer.generateTexture({
    target: root,
    frame: new Rectangle(-9, -9, 18, 18),
    resolution: 2,
  });
}

/* ------------------------------- registry ------------------------------- */

export function createTextures(renderer: Renderer): GameTextures {
  const tank: UnitSprite[] = [];
  const mammoth: UnitSprite[] = [];
  const artillery: UnitSprite[] = [];
  const rifleman: UnitSprite[] = [];
  const harvester: UnitSprite[] = [];
  const repair: UnitSprite[] = [];
  const rocketeer: UnitSprite[] = [];
  const sniper: UnitSprite[] = [];
  const spion: UnitSprite[] = [];
  const mcv: UnitSprite[] = [];
  const scout: UnitSprite[] = [];
  const lighttank: UnitSprite[] = [];
  const flamer: UnitSprite[] = [];
  const dog: UnitSprite[] = [];
  const teslatank: UnitSprite[] = [];
  const flak: UnitSprite[] = [];
  const heli: UnitSprite[] = [];
  const jet: UnitSprite[] = [];
  const strikejet: UnitSprite[] = [];
  const airlift: UnitSprite[] = [];
  const gunboat: UnitSprite[] = [];
  const destroyer: UnitSprite[] = [];
  const sub: UnitSprite[] = [];
  const transport: UnitSprite[] = [];
  for (let f = 0; f < FACING_COUNT; f++) {
    tank.push(bakeVehicle(renderer, f, 28, drawTank, teamTank));
    mammoth.push(bakeVehicle(renderer, f, 34, drawMammoth, teamMammoth));
    artillery.push(bakeVehicle(renderer, f, 32, drawArtillery, teamArtillery));
    harvester.push(bakeVehicle(renderer, f, 30, drawHarvester, teamHarvester));
    repair.push(bakeVehicle(renderer, f, 28, drawRepair, teamRepair));
    scout.push(bakeVehicle(renderer, f, 24, drawScout, teamScout));
    lighttank.push(bakeVehicle(renderer, f, 26, drawLightTank, teamLightTank));
    teslatank.push(bakeVehicle(renderer, f, 30, drawTeslaTank, teamTeslaTank));
    flak.push(bakeVehicle(renderer, f, 26, drawFlak, teamFlak));
    heli.push(bakeVehicle(renderer, f, 30, drawHeli, teamHeli));
    jet.push(bakeVehicle(renderer, f, 30, drawJet, teamJet));
    strikejet.push(bakeVehicle(renderer, f, 30, drawStrikeJet, teamStrikeJet));
    airlift.push(bakeVehicle(renderer, f, 34, drawAirlift, teamAirlift));
    gunboat.push(bakeVehicle(renderer, f, 24, drawGunboat, teamGunboat));
    destroyer.push(bakeVehicle(renderer, f, 32, drawDestroyer, teamDestroyer));
    sub.push(bakeVehicle(renderer, f, 28, drawSub, teamSub));
    transport.push(bakeVehicle(renderer, f, 28, drawTransportShip, teamTransportShip));
    rifleman.push(bakeInfantry(renderer, f, drawRifleman, teamHelmet));
    rocketeer.push(bakeInfantry(renderer, f, drawRocketeer, teamHelmet));
    sniper.push(bakeInfantry(renderer, f, drawSniper, teamHelmet));
    spion.push(bakeInfantry(renderer, f, drawSpion, teamHelmet));
    mcv.push(bakeVehicle(renderer, f, 30, drawMcv, teamMcv));
    flamer.push(bakeInfantry(renderer, f, drawFlamer, teamHelmet));
    dog.push(bakeInfantry(renderer, f, drawDog, teamDog));
  }

  const buildings = Object.fromEntries(
    (Object.keys(BUILDING_RULES) as BuildingType[]).map((t) => [t, bakeBuilding(renderer, t)]),
  ) as Record<BuildingType, BuildingSprite>;

  const walls = [1, 2, 3].map((lvl) => bakeWallLevel(renderer, lvl));
  buildings.WALL = walls[0]!;

  // Open-gate variant: same posts, barrier folded aside.
  const gob = new Graphics();
  {
    const c = iso(0.5, 0.5);
    gob.rect(c.x - 13, c.y - 16, 4, 20).fill(0x8f8775).stroke({ width: 1, color: OUTLINE });
    gob.rect(c.x + 9, c.y - 16, 4, 20).fill(0x8f8775).stroke({ width: 1, color: OUTLINE });
    gob.rect(c.x - 12, c.y - 13, 3, 10).fill(0xb7bec4).stroke({ width: 1, color: OUTLINE }); // barrier folded left
    gob.rect(c.x + 9, c.y - 13, 3, 10).fill(0xb7bec4).stroke({ width: 1, color: OUTLINE }); // folded right
  }
  const got = new Graphics();
  {
    const c = iso(0.5, 0.5);
    got.rect(c.x - 3, c.y - 20, 6, 3).fill(0xffffff);
  }
  const gateOpen = bakeFootprint(renderer, gob, got, 1, 1, 22);

  const oreOverlay = new Graphics();
  oreOverlay.poly(diamondPath()).fill({ color: 0xc79a2a, alpha: 0.22 });
  for (const [x, y, r] of [
    [32, 16, 3], [22, 12, 2], [42, 20, 2], [27, 22, 2], [40, 10, 2], [17, 17, 2], [47, 14, 2],
  ] as const) {
    oreOverlay.poly([x, y - r - 1, x + r, y, x, y + r + 1, x - r, y]).fill(0xdba832);
    oreOverlay.poly([x, y - r - 1, x + r, y, x, y]).fill(0xf0cd6d);
  }

  // Gems ("Edelsteine"): taller violet crystals with bright facets.
  const gemOverlay = new Graphics();
  gemOverlay.poly(diamondPath()).fill({ color: 0x6a4dc7, alpha: 0.2 });
  for (const [x, y, r] of [
    [32, 15, 4], [23, 20, 3], [42, 19, 3], [27, 11, 2], [39, 11, 2], [18, 15, 2], [46, 15, 2],
  ] as const) {
    gemOverlay
      .poly([x, y - r - 3, x + r, y, x, y + r + 1, x - r, y])
      .fill(0x9d7bff)
      .stroke({ width: 0.8, color: 0x5a3fb0 });
    gemOverlay.poly([x, y - r - 3, x + r, y, x, y]).fill(0xd3c2ff);
  }

  const tree = new Graphics();
  tree.ellipse(0, 2, 12, 6).fill({ color: 0x000000, alpha: 0.3 });
  tree.rect(-2, -8, 4, 10).fill(0x5d4326);
  tree.circle(0, -16, 10).fill(0x2e4a1e).stroke({ width: 1, color: 0x1d3013, alpha: 0.8 });
  tree.circle(-6, -10, 7).fill(0x3a5c27);
  tree.circle(6, -11, 7).fill(0x35541f);
  tree.circle(0, -24, 7).fill(0x3f6329);

  const shell = new Graphics().circle(0, 0, 3).fill(0xffe08a).stroke({ width: 1, color: 0xffb347 });

  const fog = new Graphics().poly([TILE_W / 2, -1, TILE_W + 1, TILE_H / 2, TILE_W / 2, TILE_H + 1, -1, TILE_H / 2]).fill(0x06080a);

  const water = new Graphics().poly(diamondPath()).fill(0x2b5d8a);
  water.moveTo(18, 14).quadraticCurveTo(26, 11, 34, 14).stroke({ width: 1.5, color: 0x4a83b3, alpha: 0.8 });
  water.moveTo(30, 21).quadraticCurveTo(38, 18, 46, 21).stroke({ width: 1.5, color: 0x4a83b3, alpha: 0.6 });
  water.poly(diamondPath()).stroke({ width: 1, color: 0x1d4266, alpha: 0.5 });

  return {
    dirt: [
      groundTile(renderer, 0x8a6f4d, 7, 0x6e5539, 0),
      groundTile(renderer, 0x84693f + 0x030303, 6, 0x6e5539, 13),
    ],
    grass: [
      groundTile(renderer, 0x4d7a35, 6, 0x3a5c27, 5),
      groundTile(renderer, 0x487233, 7, 0x5c8a42, 17),
    ],
    water: bakeTile(renderer, water),
    rocks: [bakeRock(renderer, 0), bakeRock(renderer, 1), bakeRock(renderer, 2)],
    ore: bakeTile(renderer, oreOverlay),
    gems: bakeTile(renderer, gemOverlay),
    tree: renderer.generateTexture({
      target: tree,
      frame: new Rectangle(-16, -36, 32, 44),
      resolution: 2,
    }),
    fogTile: renderer.generateTexture({
      target: fog,
      frame: new Rectangle(-1, -1, TILE_W + 2, TILE_H + 2),
      resolution: 1,
    }),
    tank,
    mammoth,
    artillery,
    rifleman,
    sniper,
    spion,
    mcv,
    harvester,
    repair,
    rocketeer,
    scout,
    lighttank,
    flamer,
    dog,
    teslatank,
    flak,
    heli,
    jet,
    strikejet,
    airlift,
    gunboat,
    destroyer,
    sub,
    transport,
    projectile: renderer.generateTexture({
      target: shell,
      frame: new Rectangle(-5, -5, 10, 10),
      resolution: 2,
    }),
    selectSmall: bakeBrackets(renderer, 26, 20),
    selectLarge: bakeBrackets(renderer, 42, 30),
    digits: [Texture.EMPTY, ...Array.from({ length: 9 }, (_, i) => bakeDigit(renderer, i + 1))],
    buildings,
    walls,
    gateOpen,
  };
}
