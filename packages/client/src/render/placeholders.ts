import {
  BUILDING_RULES,
  FACING_COUNT,
  FACING_VECTORS,
  buildingRule,
  type BuildingType,
} from '@cac/sim';
import { Container, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import { TILE_H, TILE_W } from './iso.js';

/**
 * Procedural placeholder art in the classic C&C badlands style, baked into
 * textures at startup. Units are drawn in neutral grays so they can be
 * faction-tinted at render time. Real sprite sheets can replace all of this
 * later — game code only ever consumes Texture objects from this registry.
 */
export interface BuildingSprite {
  texture: Texture;
  /** Normalized anchor so the sprite sits on its footprint's top-left corner. */
  anchorX: number;
  anchorY: number;
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
  tank: Texture[];
  mammoth: Texture[];
  artillery: Texture[];
  rifleman: Texture[];
  harvester: Texture[];
  repair: Texture[];
  rocketeer: Texture[];
  scout: Texture[];
  lighttank: Texture[];
  flamer: Texture[];
  dog: Texture[];
  teslatank: Texture[];
  flak: Texture[];
  heli: Texture[];
  jet: Texture[];
  gunboat: Texture[];
  destroyer: Texture[];
  sub: Texture[];
  transport: Texture[];
  projectile: Texture;
  selectSmall: Texture;
  selectLarge: Texture;
  buildings: Record<BuildingType, BuildingSprite>;
  /** Wall sprites per upgrade tier (level 1..3). */
  walls: BuildingSprite[];
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
  accent: number;
  draw: (g: Graphics, w: number, h: number, accent: number) => void;
}

function roofAccent(g: Graphics, w: number, h: number, e: number, accent: number): void {
  const c = iso(w / 2, h / 2);
  g.poly([c.x, c.y - e - 5, c.x + 11, c.y - e, c.x, c.y - e + 5, c.x - 11, c.y - e]).fill(accent);
}

const BUILDING_ART: Record<BuildingType, BuildingArt> = {
  CONYARD: {
    frameTop: 52,
    accent: 0xf2f2f2,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.25, 0.25, 2.5, 2.5, 24, 0xb5ac99);
      prismAt(g, 1.7, 0.35, 0.85, 0.85, 44, 0xc4bba8); // crane tower
      const tip = iso(2.1, 0.8);
      g.rect(tip.x - 26, tip.y - 50, 28, 4).fill(0xd8b13c); // crane arm
      roofAccent(g, 1.4, 1.4, 24, accent);
    },
  },
  POWER: {
    frameTop: 46,
    accent: 0xffd94d,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 14, 0xb0a794);
      const t1 = iso(0.65, 1.0);
      const t2 = iso(1.45, 1.0);
      cylinder(g, t1.x, t1.y - 8, 9, 26, 0xc9c0ad);
      cylinder(g, t2.x, t2.y - 8, 9, 26, 0xc9c0ad);
      roofAccent(g, 1, 1.75, 10, accent);
    },
  },
  REFINERY: {
    frameTop: 40,
    accent: 0xffb02e,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 1.5, 1.5, 18, 0xb0a794);
      const silo = iso(2.3, 0.8);
      cylinder(g, silo.x, silo.y, 11, 24, 0xc9b06a);
      // Dock ramp toward the unload cell south of the footprint.
      const r0 = iso(1, h);
      g.poly([r0.x - 18, r0.y - 4, r0.x + 18, r0.y - 4, r0.x + 26, r0.y + 10, r0.x - 26, r0.y + 10])
        .fill(0x857c68);
      roofAccent(g, 0.95, 0.95, 18, accent);
    },
  },
  BARRACKS: {
    frameTop: 30,
    accent: 0x9fd66b,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.1, 13, 0xb0a794);
      prismAt(g, 0.35, 1.25, 1.3, 0.55, 8, 0xa39a87); // annex
      roofAccent(g, 1, 0.7, 13, accent);
    },
  },
  FACTORY: {
    frameTop: 50,
    accent: 0xff8c42,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 2.6, 2.0, 28, 0xb5ac99);
      // Big vehicle door on the SE face.
      const d0 = iso(2.8, 1.35);
      g.poly([d0.x, d0.y - 22, d0.x - 26, d0.y - 9, d0.x - 26, d0.y + 7, d0.x, d0.y - 6]).fill(0x4a443a);
      prismAt(g, 0.4, 2.25, 2.0, 0.55, 8, 0xa39a87); // apron
      const v1 = iso(0.9, 0.8);
      cylinder(g, v1.x, v1.y - 26, 4, 10, 0x8f8775);
      roofAccent(g, 1.5, 1.2, 28, accent);
    },
  },
  WERKSTATT: {
    frameTop: 42,
    accent: 0x6db4d6,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.4, 1.7, 10, 0xb0a794);
      // Open repair platform with a gantry crane.
      const a = iso(2.2, 0.35);
      const b = iso(2.2, 1.65);
      g.rect(a.x - 2, a.y - 34, 4, 34).fill(0x8f8775);
      g.rect(b.x - 2, b.y - 34, 4, 34).fill(0x8f8775);
      g.rect(Math.min(a.x, b.x) - 2, Math.min(a.y, b.y) - 36, Math.abs(b.x - a.x) + 4, 5).fill(0xd8b13c);
      // Wrench glyph on the flat roof.
      const c = iso(0.85, 1.0);
      g.circle(c.x - 5, c.y - 14, 4).stroke({ width: 2.5, color: accent });
      g.rect(c.x - 3, c.y - 13, 12, 3).fill(accent);
    },
  },
  TESLA: {
    frameTop: 52,
    accent: 0x7fd4ff,
    draw: (g, _w, _h, accent) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      prismAt(g, 0.3, 0.3, 0.4, 0.4, 6, 0x8f8775);
      g.rect(c.x - 2.5, c.y - 42, 5, 38).fill(0x6f675a); // pole
      g.rect(c.x - 6, c.y - 26, 12, 3).fill(0x6f675a);
      g.rect(c.x - 5, c.y - 34, 10, 3).fill(0x6f675a);
      g.circle(c.x, c.y - 44, 7).fill(0x4a5560).stroke({ width: 1, color: 0x2b333c });
      g.circle(c.x, c.y - 44, 3.5).fill(accent);
      g.circle(c.x, c.y - 44, 9).stroke({ width: 1, color: accent, alpha: 0.5 });
    },
  },
  PILLBOX: {
    frameTop: 26,
    accent: 0xcfd6dc,
    draw: (g, _w, _h, accent) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      g.ellipse(c.x, c.y - 6, 19, 12).fill(0xa8a08c).stroke({ width: 1, color: 0x4a443a });
      g.ellipse(c.x, c.y - 10, 13, 8).fill(0xbdb5a4);
      g.rect(c.x - 9, c.y - 9, 18, 3.5).fill(0x3a352c); // firing slit
      g.circle(c.x, c.y - 15, 2).fill(accent);
    },
  },
  HELIPAD: {
    frameTop: 22,
    accent: 0x6db4d6,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      const c = iso(1.5, 1.5);
      // Tarmac landing circle with a yellow rim and an "H" marking.
      g.ellipse(c.x, c.y, 46, 24).fill(0x4a463d).stroke({ width: 2, color: 0xd8b13c });
      g.rect(c.x - 11, c.y - 8, 3.5, 16).fill(accent);
      g.rect(c.x + 7.5, c.y - 8, 3.5, 16).fill(accent);
      g.rect(c.x - 11, c.y - 2, 22, 3.5).fill(accent);
      prismAt(g, 0.1, 0.1, 0.7, 0.7, 14, 0xb0a794); // control shack
    },
  },
  FLAKTOWER: {
    frameTop: 28,
    accent: 0xcfd6dc,
    draw: (g, _w, _h, accent) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      prismAt(g, 0.28, 0.28, 0.44, 0.44, 8, 0x8f8775); // turret base
      g.circle(c.x, c.y - 12, 5).fill(0x9aa0a6).stroke({ width: 1, color: 0x4a4a4a }); // hub
      for (const ox of [-6, -2, 2, 6]) {
        g.rect(c.x + ox, c.y - 23, 1.8, 12).fill(0x6f6f6f); // AA barrels pointing up
      }
      g.circle(c.x, c.y - 12, 2).fill(accent);
    },
  },
  NUKESILO: {
    frameTop: 34,
    accent: 0xff4d4d,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 14, 0xa8a08c);
      const c = iso(1, 1);
      // Silo hatch with warning ring and peeking warhead tip.
      g.ellipse(c.x, c.y - 14, 13, 7).fill(0x3a352c).stroke({ width: 2, color: accent });
      g.ellipse(c.x, c.y - 15, 6, 3.5).fill(0x55534c);
      g.poly([c.x, c.y - 24, c.x + 4, c.y - 16, c.x - 4, c.y - 16]).fill(0xd6d6d6);
      g.circle(c.x + 10, c.y - 20, 1.5).fill(accent); // warning light
    },
  },
  WEATHER: {
    frameTop: 44,
    accent: 0x7fd4ff,
    draw: (g, w, h, accent) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 12, 0xa8a08c);
      const c = iso(1, 1);
      // Storm dome with orbiting ring and antenna.
      g.ellipse(c.x, c.y - 18, 14, 11).fill(0x4a6a7d).stroke({ width: 1, color: 0x2b3f4c });
      g.ellipse(c.x - 4, c.y - 22, 5, 3.5).fill({ color: 0xbfeaff, alpha: 0.8 });
      g.ellipse(c.x, c.y - 16, 18, 5).stroke({ width: 1.5, color: accent, alpha: 0.7 });
      g.rect(c.x + 10, c.y - 38, 2, 18).fill(0x6f675a);
      g.circle(c.x + 11, c.y - 39, 2.5).fill(accent);
    },
  },
  SHIPYARD: {
    frameTop: 30,
    accent: 0x6db4d6,
    draw: (g, w, h, accent) => {
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
      g.circle(cb.x, cb.y - 36, 2.5).fill(accent);
    },
  },
  WALL: {
    // Level 1 sandbags — levels 2/3 get their own bake below.
    frameTop: 18,
    accent: 0xc9b06a,
    draw: (g) => {
      const c = iso(0.5, 0.5);
      for (const [dx, dy] of [[-9, 2], [0, 6], [9, 2], [-4.5, -2], [4.5, -2], [0, -6]] as const) {
        g.ellipse(c.x + dx, c.y - 4 + dy * 0.5, 7, 4).fill(0xc2a368).stroke({ width: 1, color: 0x8a743f });
      }
    },
  },
};

function bakeBuilding(renderer: Renderer, type: BuildingType): BuildingSprite {
  const rule = buildingRule(type);
  const art = BUILDING_ART[type];
  const g = new Graphics();
  art.draw(g, rule.width, rule.height, art.accent);
  return bakeFootprint(renderer, g, rule.width, rule.height, art.frameTop);
}

function bakeFootprint(
  renderer: Renderer,
  g: Graphics,
  w: number,
  h: number,
  frameTop: number,
): BuildingSprite {
  const frame = new Rectangle(-h * 32 - 4, -frameTop, (w + h) * 32 + 8, (w + h) * 16 + frameTop + 6);
  const texture = renderer.generateTexture({ target: g, frame, resolution: 2 });
  return { texture, anchorX: (h * 32 + 4) / frame.width, anchorY: frameTop / frame.height };
}

function bakeWallLevel(renderer: Renderer, level: number): BuildingSprite {
  const g = new Graphics();
  const c = iso(0.5, 0.5);
  if (level === 1) {
    BUILDING_ART.WALL.draw(g, 1, 1, BUILDING_ART.WALL.accent);
  } else if (level === 2) {
    prismAt(g, 0.12, 0.12, 0.76, 0.76, 12, 0xaaa398); // concrete block
    g.rect(c.x - 12, c.y - 14, 24, 2).fill({ color: 0x6e675c, alpha: 0.8 });
  } else {
    prismAt(g, 0.08, 0.08, 0.84, 0.84, 16, 0x7d8791); // reinforced steel
    for (const dx of [-10, 0, 10]) g.circle(c.x + dx, c.y - 17, 1.5).fill(0xcfd6dc);
    g.rect(c.x - 13, c.y - 12, 26, 2).fill(0x59636d);
  }
  return bakeFootprint(renderer, g, 1, 1, 22);
}

/* -------------------------------- units --------------------------------- */

function facingAngle(facing: number): number {
  const [vx, vy] = FACING_VECTORS[facing]!;
  return Math.atan2(vx + vy, 2 * (vx - vy));
}

function bakeVehicle(
  renderer: Renderer,
  facing: number,
  size: number,
  draw: (g: Graphics) => void,
): Texture {
  const root = new Container();
  root.addChild(
    new Graphics().ellipse(0, 5, size * 0.62, size * 0.34).fill({ color: 0x000000, alpha: 0.32 }),
  );
  const body = new Graphics();
  draw(body);
  body.rotation = facingAngle(facing);
  root.addChild(body);
  return renderer.generateTexture({
    target: root,
    frame: new Rectangle(-size, -size, size * 2, size * 2),
    resolution: 2,
  });
}

function drawTank(g: Graphics): void {
  g.rect(-16, -13, 32, 6).fill(0x62615e);
  g.rect(-16, 7, 32, 6).fill(0x62615e);
  g.poly([-15, -9, 10, -9, 16, 0, 10, 9, -15, 9]).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c });
  g.circle(0, 0, 7).fill(0xe2e2e2).stroke({ width: 1, color: 0x4a4a4a });
  g.rect(6, -2, 18, 4).fill(0x8f8f8f);
  g.rect(21, -2.5, 3, 5).fill(0x6f6f6f); // muzzle
}

function drawMammoth(g: Graphics): void {
  g.rect(-21, -17, 42, 8).fill(0x57565a);
  g.rect(-21, 9, 42, 8).fill(0x57565a);
  g.roundRect(-20, -12, 40, 24, 4).fill(0xbfbfbf).stroke({ width: 1, color: 0x3c3c3c });
  g.roundRect(-8, -8, 18, 16, 3).fill(0xd6d6d6).stroke({ width: 1, color: 0x4a4a4a });
  g.rect(8, -7, 20, 4.5).fill(0x8f8f8f); // twin barrels
  g.rect(8, 2.5, 20, 4.5).fill(0x8f8f8f);
  g.rect(25, -7.5, 4, 5.5).fill(0x6f6f6f);
  g.rect(25, 2, 4, 5.5).fill(0x6f6f6f);
}

function drawArtillery(g: Graphics): void {
  g.rect(-14, -11, 28, 5).fill(0x62615e);
  g.rect(-14, 6, 28, 5).fill(0x62615e);
  g.roundRect(-13, -8, 24, 16, 3).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c });
  g.poly([-2, -7, 6, -7, 6, 7, -2, 7]).fill(0xa8a8a8); // gun shield
  g.rect(4, -2, 26, 4).fill(0x8f8f8f); // long barrel
  g.rect(27, -3, 4, 6).fill(0x6f6f6f);
}

function drawHarvester(g: Graphics): void {
  g.rect(-18, -14, 36, 6).fill(0x62615e);
  g.rect(-18, 8, 36, 6).fill(0x62615e);
  g.roundRect(-17, -10, 34, 20, 3).fill(0xbfbfbf).stroke({ width: 1, color: 0x3c3c3c });
  g.roundRect(-15, -8, 18, 16, 2).fill(0x8f8f8f);
  g.circle(10, 0, 6).fill(0xdedede).stroke({ width: 1, color: 0x4a4a4a });
}

function drawRepair(g: Graphics): void {
  g.rect(-15, -12, 30, 5).fill(0x62615e);
  g.rect(-15, 7, 30, 5).fill(0x62615e);
  g.roundRect(-14, -9, 28, 18, 3).fill(0xe0c14a).stroke({ width: 1, color: 0x3c3c3c }); // yellow service body
  g.roundRect(-12, -7, 12, 14, 2).fill(0xf0d878); // cab
  // Wrench glyph on the flatbed.
  g.circle(6, -3, 3).stroke({ width: 2, color: 0x4a4a4a });
  g.rect(7, -3, 8, 2.4).fill(0x4a4a4a);
}

/** Generic foot-soldier bake: shadow + a body drawn pointing +x, then rotated. */
function bakeInfantry(renderer: Renderer, facing: number, draw: (g: Graphics) => void): Texture {
  const root = new Container();
  root.addChild(new Graphics().ellipse(0, 3, 8, 5).fill({ color: 0x000000, alpha: 0.32 }));
  const body = new Graphics();
  draw(body);
  body.rotation = facingAngle(facing);
  root.addChild(body);
  return renderer.generateTexture({
    target: root,
    frame: new Rectangle(-16, -16, 32, 32),
    resolution: 2,
  });
}

function drawRifleman(body: Graphics): void {
  body.rect(2, -1, 9, 2).fill(0x4a4a4a);
  body.circle(0, 0, 5).fill(0xd2d2d2).stroke({ width: 1, color: 0x3c3c3c });
  body.circle(0, 0, 2.5).fill(0x909090);
}

function drawRocketeer(body: Graphics): void {
  body.rect(1, -2.5, 12, 3.5).fill(0x5a5a5a); // rocket tube
  body.circle(13, -0.8, 1.8).fill(0xd06a3a); // warhead tip
  body.circle(0, 0, 5).fill(0xd2d2d2).stroke({ width: 1, color: 0x3c3c3c });
  body.circle(0, 0, 2.5).fill(0x8a8a8a);
}

function drawFlamer(body: Graphics): void {
  body.circle(-4, 0, 3.2).fill(0x7a7a7a).stroke({ width: 1, color: 0x4a4a4a }); // fuel pack
  body.circle(0, 0, 5).fill(0xd2d2d2).stroke({ width: 1, color: 0x3c3c3c });
  body.rect(3, -1.5, 11, 3).fill(0x4a4a4a); // nozzle
  body.circle(14, 0, 1.9).fill(0xff8a3a); // pilot flame
  body.circle(0, 0, 2.5).fill(0x9a9a9a);
}

function drawDog(body: Graphics): void {
  body.ellipse(-1, 0, 6, 3.2).fill(0xc8c8c8).stroke({ width: 1, color: 0x4a4a4a }); // body
  body.rect(-8, -0.7, 4, 1.4).fill(0x9a9a9a); // tail
  body.circle(6, -0.4, 2.7).fill(0xd8d8d8).stroke({ width: 1, color: 0x4a4a4a }); // head
  body.poly([8, -1.4, 11, -2.2, 9, 0]).fill(0xb0b0b0); // snout
  for (const [lx, ly] of [[-4, 2.4], [3, 2.4], [-4, -3.8], [3, -3.8]] as const) {
    body.rect(lx, ly, 1.4, 2).fill(0x8a8a8a);
  }
}

function drawScout(g: Graphics): void {
  g.rect(-11, -8, 22, 4).fill(0x62615e); // wheels
  g.rect(-11, 4, 22, 4).fill(0x62615e);
  g.roundRect(-10, -6, 20, 12, 3).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c }); // hull
  g.roundRect(-3, -4, 9, 8, 2).fill(0x9aa4b0); // cabin
  g.rect(6, -1, 8, 2).fill(0x8f8f8f); // pintle MG
}

function drawLightTank(g: Graphics): void {
  g.rect(-13, -11, 26, 5).fill(0x62615e);
  g.rect(-13, 6, 26, 5).fill(0x62615e);
  g.poly([-12, -7, 8, -7, 13, 0, 8, 7, -12, 7]).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c });
  g.circle(-1, 0, 5.5).fill(0xe2e2e2).stroke({ width: 1, color: 0x4a4a4a });
  g.rect(4, -1.5, 15, 3).fill(0x8f8f8f); // barrel
  g.rect(17, -2, 3, 4).fill(0x6f6f6f);
}

function drawTeslaTank(g: Graphics): void {
  g.rect(-15, -12, 30, 5).fill(0x57565a);
  g.rect(-15, 7, 30, 5).fill(0x57565a);
  g.roundRect(-14, -9, 28, 18, 3).fill(0xbfbfbf).stroke({ width: 1, color: 0x3c3c3c });
  g.circle(0, 0, 5).fill(0x8f8f8f).stroke({ width: 1, color: 0x4a4a4a }); // coil base
  g.circle(0, 0, 2.6).fill(0xdfefff); // energy node
  g.circle(0, 0, 6.5).stroke({ width: 1, color: 0xbfeaff, alpha: 0.6 });
}

function drawFlak(g: Graphics): void {
  g.rect(-13, -11, 26, 5).fill(0x62615e);
  g.rect(-13, 6, 26, 5).fill(0x62615e);
  g.roundRect(-12, -8, 24, 16, 3).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c });
  g.circle(-1, 0, 5).fill(0xdedede).stroke({ width: 1, color: 0x4a4a4a }); // turret
  // Quad flak barrels angled forward-up.
  for (const oy of [-3.5, -1.2, 1.2, 3.5]) g.rect(3, oy - 0.6, 16, 1.6).fill(0x8f8f8f);
}

/** Attack helicopter: hull + tail boom + a faint spinning rotor disc. */
function drawHeli(g: Graphics): void {
  g.ellipse(-16, 0, 8, 2.5).fill(0x9a9a9a); // tail boom
  g.rect(-24, -4, 4, 8).fill(0x8f8f8f); // tail fin
  g.roundRect(-8, -6, 22, 12, 5).fill(0xcfcfcf).stroke({ width: 1, color: 0x3c3c3c }); // fuselage
  g.roundRect(6, -4, 8, 8, 3).fill(0x9aa4b0); // cockpit
  g.rect(2, -9, 3, 18).fill(0x6f6f6f); // stub wings / weapon pylons
  g.circle(0, 0, 22).fill({ color: 0xdedede, alpha: 0.18 }); // rotor disc
  g.circle(0, 0, 22).stroke({ width: 1, color: 0xffffff, alpha: 0.25 });
}

/** Jet: pointed fuselage with swept wings and tailplanes. */
function drawJet(g: Graphics): void {
  g.poly([22, 0, 6, -4, -16, -3, -16, 3, 6, 4]).fill(0xcfcfcf).stroke({ width: 1, color: 0x3c3c3c }); // fuselage
  g.poly([-2, -3, -10, -18, -16, -18, -8, -3]).fill(0xb8b8b8); // left wing
  g.poly([-2, 3, -10, 18, -16, 18, -8, 3]).fill(0xb8b8b8); // right wing
  g.poly([-13, -2, -20, -8, -20, -2].map((v) => v)).fill(0xa8a8a8); // tailplane L
  g.poly([-13, 2, -20, 8, -20, 2]).fill(0xa8a8a8); // tailplane R
  g.circle(10, 0, 2.4).fill(0x9aa4b0); // canopy
  g.circle(-16, 0, 2.4).fill(0xff8a3a); // exhaust glow
}

/* Ships face +x like vehicles; bakeVehicle's drop shadow reads as their wake. */

/** Patrol gunboat: small pointed hull with a single deck MG. */
function drawGunboat(g: Graphics): void {
  g.poly([18, 0, 10, -5, -14, -5, -17, 0, -14, 5, 10, 5]).fill(0xc9c9c9).stroke({ width: 1, color: 0x3c3c3c }); // hull
  g.poly([18, 0, 10, -5, 10, 5]).fill(0xdedede); // bow deck
  g.roundRect(-10, -3, 12, 6, 2).fill(0x9aa4b0); // cabin
  g.circle(4, 0, 3).fill(0x8f8f8f).stroke({ width: 1, color: 0x4a4a4a }); // MG mount
  g.rect(6, -0.8, 9, 1.6).fill(0x6f6f6f);
  g.rect(-16, -1, 3, 2).fill(0x6f6f6f); // stern
}

/** Destroyer: long hull, two gun turrets and a radar mast. */
function drawDestroyer(g: Graphics): void {
  g.poly([26, 0, 16, -6, -20, -6, -25, 0, -20, 6, 16, 6]).fill(0xbfbfbf).stroke({ width: 1, color: 0x3c3c3c }); // hull
  g.poly([26, 0, 16, -6, 16, 6]).fill(0xd6d6d6); // bow
  g.roundRect(-12, -4, 16, 8, 2).fill(0x9a9a9a); // superstructure
  g.rect(-2, -10, 2, 8).fill(0x6f6f6f); // mast
  g.circle(-1, -11, 2).fill(0xcfd6dc); // radar
  for (const ox of [10, -18]) {
    g.circle(ox, 0, 3.5).fill(0xdedede).stroke({ width: 1, color: 0x4a4a4a }); // turret
    g.rect(ox + 2, -1, 9, 2).fill(0x8f8f8f); // barrel
  }
}

/** Submarine: slender teardrop hull with a conning tower (rendered dimmed). */
function drawSub(g: Graphics): void {
  g.ellipse(0, 0, 22, 5.5).fill(0x707a84).stroke({ width: 1, color: 0x2f353b }); // hull
  g.ellipse(8, 0, 8, 3).fill(0x828c96); // fore deck
  g.roundRect(-6, -3, 10, 6, 2.5).fill(0x59636d).stroke({ width: 1, color: 0x2f353b }); // tower
  g.rect(-2, -6, 1.6, 4).fill(0x3f474f); // periscope
  g.ellipse(-19, 0, 4, 2.2).fill(0x59636d); // stern planes
}

/** Transport: broad hull with a flat cargo deck and loading ramp at the bow. */
function drawTransportShip(g: Graphics): void {
  g.poly([20, 0, 14, -8, -18, -8, -22, 0, -18, 8, 14, 8]).fill(0xbfbfbf).stroke({ width: 1, color: 0x3c3c3c }); // hull
  g.roundRect(-16, -6, 28, 12, 2).fill(0x8f8f8f); // cargo well
  g.rect(-16, -6, 28, 12).stroke({ width: 1, color: 0x5f5f5f });
  for (const ox of [-10, -2, 6]) g.rect(ox, -6, 1, 12).fill(0x6f6f6f); // deck ribs
  g.poly([20, 0, 14, -8, 14, 8]).fill(0xa8a8a8); // bow ramp
  g.roundRect(-21, -3, 5, 6, 1.5).fill(0x9aa4b0); // pilot house
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

/* ------------------------------- registry ------------------------------- */

export function createTextures(renderer: Renderer): GameTextures {
  const tank: Texture[] = [];
  const mammoth: Texture[] = [];
  const artillery: Texture[] = [];
  const rifleman: Texture[] = [];
  const harvester: Texture[] = [];
  const repair: Texture[] = [];
  const rocketeer: Texture[] = [];
  const scout: Texture[] = [];
  const lighttank: Texture[] = [];
  const flamer: Texture[] = [];
  const dog: Texture[] = [];
  const teslatank: Texture[] = [];
  const flak: Texture[] = [];
  const heli: Texture[] = [];
  const jet: Texture[] = [];
  const gunboat: Texture[] = [];
  const destroyer: Texture[] = [];
  const sub: Texture[] = [];
  const transport: Texture[] = [];
  for (let f = 0; f < FACING_COUNT; f++) {
    tank.push(bakeVehicle(renderer, f, 28, drawTank));
    mammoth.push(bakeVehicle(renderer, f, 34, drawMammoth));
    artillery.push(bakeVehicle(renderer, f, 32, drawArtillery));
    harvester.push(bakeVehicle(renderer, f, 30, drawHarvester));
    repair.push(bakeVehicle(renderer, f, 28, drawRepair));
    scout.push(bakeVehicle(renderer, f, 24, drawScout));
    lighttank.push(bakeVehicle(renderer, f, 26, drawLightTank));
    teslatank.push(bakeVehicle(renderer, f, 30, drawTeslaTank));
    flak.push(bakeVehicle(renderer, f, 26, drawFlak));
    heli.push(bakeVehicle(renderer, f, 30, drawHeli));
    jet.push(bakeVehicle(renderer, f, 30, drawJet));
    gunboat.push(bakeVehicle(renderer, f, 24, drawGunboat));
    destroyer.push(bakeVehicle(renderer, f, 32, drawDestroyer));
    sub.push(bakeVehicle(renderer, f, 28, drawSub));
    transport.push(bakeVehicle(renderer, f, 28, drawTransportShip));
    rifleman.push(bakeInfantry(renderer, f, drawRifleman));
    rocketeer.push(bakeInfantry(renderer, f, drawRocketeer));
    flamer.push(bakeInfantry(renderer, f, drawFlamer));
    dog.push(bakeInfantry(renderer, f, drawDog));
  }

  const buildings = Object.fromEntries(
    (Object.keys(BUILDING_RULES) as BuildingType[]).map((t) => [t, bakeBuilding(renderer, t)]),
  ) as Record<BuildingType, BuildingSprite>;

  const walls = [1, 2, 3].map((lvl) => bakeWallLevel(renderer, lvl));
  buildings.WALL = walls[0]!;

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
    buildings,
    walls,
  };
}
