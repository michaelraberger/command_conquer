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

/** All ground tiles in one texture so the terrain chunk meshes batch into a
 *  handful of draw calls. `uv` maps a tile key ("dirt0"…"dirt4", "grass0"…,
 *  "sand0"…, "water", "ice") to the normalized inner rect [x0, y0, x1, y1]
 *  of its slot (the gutter padding around each slot is excluded). */
export interface GroundAtlas {
  texture: Texture;
  uv: Record<string, readonly [number, number, number, number]>;
}

export interface GameTextures {
  groundAtlas: GroundAtlas;
  /** Bridge deck sprites, one per span axis: `bridgeCx` runs toward the lower
   *  right (+cx), `bridgeCy` toward the lower left (+cy). */
  bridgeCx: Texture;
  bridgeCy: Texture;
  /** Collapsed-span debris drawn on TERRAIN_BRIDGE_WRECK cells. */
  bridgeWreck: Texture;
  /** Trampled-ground patches under buildings, tinted per underlying terrain. */
  wornPatch: Texture[];
  /** 3D rock outcrop variants, drawn in the entity layer like trees. */
  rocks: Texture[];
  /** Raised cliff plateaus for ROCK cells, indexed by open-edge bitmask
   *  (bit0 +cx wall, bit1 +cy wall, bit2 -cx rim, bit3 -cy rim). */
  cliffs: Texture[];
  /** Soft shade a ridge casts onto the ground cell left-below it (+cy). */
  cliffShadow: Texture;
  /** Generic soft round drop shadow (ground units, buildings). */
  softShadow: Texture;
  /** Tiny scatter details: grey pebble clusters and grass tufts. */
  pebbles: Texture[];
  tufts: Texture[];
  ore: Texture;
  gems: Texture;
  tree: Texture;
  /** Collectible goodie crate (iso wooden box). */
  crate: Texture;
  /** Veterancy rank badges: [veteran (one chevron), elite (two chevrons)]. */
  chevrons: [Texture, Texture];
  tank: UnitSprite[];
  mammoth: UnitSprite[];
  artillery: UnitSprite[];
  v3: UnitSprite[];
  rifleman: UnitSprite[];
  ingenieur: UnitSprite[];
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
  paraplane: UnitSprite[];
  gunboat: UnitSprite[];
  destroyer: UnitSprite[];
  sub: UnitSprite[];
  missilesub: UnitSprite[];
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

/** Diamond grown past the frame edge: ground tiles are sampled by terrain
 *  MESHES whose UVs touch the diamond border — transparent bake margins
 *  would bleed in as bright seams between cells. */
function overshootDiamondPath(): number[] {
  return [TILE_W / 2, -3, TILE_W + 5, TILE_H / 2, TILE_W / 2, TILE_H + 3, -5, TILE_H / 2];
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

/** Inside-the-diamond test for speckle positions. */
function inDiamond(x: number, y: number, margin = 0.85): boolean {
  const dx = Math.abs(x - TILE_W / 2) / (TILE_W / 2);
  const dy = Math.abs(y - TILE_H / 2) / (TILE_H / 2);
  return dx + dy <= margin;
}

/** Mottled ground diamond: dark + light speckles over soft blotches, so the
 *  terrain reads busy like classic C&C ground instead of flat colour. */
function groundTileGraphics(base: number, seedOff: number): Graphics {
  const g = new Graphics().poly(overshootDiamondPath()).fill(base);
  // Big soft blotches first (slight value variation across the tile).
  for (let i = 0; i < 3; i++) {
    const p = speckle(i * 3 + seedOff + 51);
    if (!inDiamond(p.x, p.y, 0.6)) continue;
    g.ellipse(p.x, p.y, 7 + (i % 3) * 3, 4 + (i % 2) * 2).fill({
      color: shade(base, i % 2 === 0 ? 0.92 : 1.06),
      alpha: 0.35,
    });
  }
  // Fine grain: dark and light speckles.
  for (let i = 0; i < 9; i++) {
    const p = speckle(i + seedOff);
    if (!inDiamond(p.x, p.y)) continue;
    g.circle(p.x, p.y, 1 + (i % 2)).fill({ color: shade(base, 0.72), alpha: 0.55 });
  }
  for (let i = 0; i < 6; i++) {
    const p = speckle(i * 7 + seedOff + 29);
    if (!inDiamond(p.x, p.y)) continue;
    g.circle(p.x, p.y, 1).fill({ color: shade(base, 1.22), alpha: 0.5 });
  }
  // No outline stroke: on terrain meshes any edge line renders as a seam.
  return g;
}

/* ---------------------------- ground atlas ------------------------------- */

/** Gutter around each atlas slot. The overshoot diamond (±5/±3) stays well
 *  inside it, so bilinear filtering at a slot's inner-rect border never
 *  samples a neighbouring slot or transparency. */
const ATLAS_PAD_X = 8;
const ATLAS_PAD_Y = 6;
const ATLAS_COLS = 6;

/** Bakes every ground tile into one atlas texture (6×3 slot grid). */
function bakeGroundAtlas(
  renderer: Renderer,
  tiles: ReadonlyArray<readonly [string, Graphics]>,
): GroundAtlas {
  const slotW = TILE_W + 2 * ATLAS_PAD_X;
  const slotH = TILE_H + 2 * ATLAS_PAD_Y;
  const rows = Math.ceil(tiles.length / ATLAS_COLS);
  const atlasW = ATLAS_COLS * slotW;
  const atlasH = rows * slotH;

  const root = new Container();
  const uv: Record<string, readonly [number, number, number, number]> = {};
  tiles.forEach(([key, g], i) => {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    g.position.set(col * slotW + ATLAS_PAD_X, row * slotH + ATLAS_PAD_Y);
    root.addChild(g);
    uv[key] = [
      (col * slotW + ATLAS_PAD_X) / atlasW,
      (row * slotH + ATLAS_PAD_Y) / atlasH,
      (col * slotW + ATLAS_PAD_X + TILE_W) / atlasW,
      (row * slotH + ATLAS_PAD_Y + TILE_H) / atlasH,
    ];
  });

  const texture = renderer.generateTexture({
    target: root,
    frame: new Rectangle(0, 0, atlasW, atlasH),
    resolution: 2,
  });
  root.destroy({ children: true });
  return { texture, uv };
}

/* ------------------------------- cliffs --------------------------------- */

/** Screen-pixel height of the raised cliff plateau on ROCK cells. */
export const CLIFF_H = 14;
const CLIFF_TOP = 0x968b74;

/**
 * One cliff cell as a raised plateau. `mask` says which grid sides border
 * non-rock: bit0 = +cx (camera-facing SE wall), bit1 = +cy (SW wall, darkest),
 * bit2 = -cx (back rim), bit3 = -cy (back rim). Adjacent rock cells share
 * their plateau edges seamlessly because every top sits at the same height.
 */
function bakeCliff(renderer: Renderer, mask: number): Texture {
  const g = new Graphics();
  const top: [number, number] = [TILE_W / 2, 0];
  const right: [number, number] = [TILE_W, TILE_H / 2];
  const bottom: [number, number] = [TILE_W / 2, TILE_H];
  const left: [number, number] = [0, TILE_H / 2];
  const lift = (p: [number, number]): [number, number] => [p[0], p[1] - CLIFF_H];

  // Camera-facing walls down to ground level.
  if (mask & 1) {
    // +cx side: right→bottom edge, mid shade with vertical striations.
    const [r, b] = [right, bottom];
    g.poly([...lift(r), ...lift(b), ...b, ...r]).fill(shade(CLIFF_TOP, 0.6));
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const x = r[0] + (b[0] - r[0]) * t;
      const y = r[1] + (b[1] - r[1]) * t;
      g.moveTo(x, y - CLIFF_H + 2).lineTo(x + 1, y - 1).stroke({ width: 1, color: shade(CLIFF_TOP, 0.45), alpha: 0.8 });
    }
  }
  if (mask & 2) {
    // +cy side: bottom→left edge, in deep shadow.
    const [b, l] = [bottom, left];
    g.poly([...lift(b), ...lift(l), ...l, ...b]).fill(shade(CLIFF_TOP, 0.38));
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const x = b[0] + (l[0] - b[0]) * t;
      const y = b[1] + (l[1] - b[1]) * t;
      g.moveTo(x, y - CLIFF_H + 2).lineTo(x - 1, y - 1).stroke({ width: 1, color: shade(CLIFF_TOP, 0.28), alpha: 0.8 });
    }
  }

  // Raised rocky top.
  const topPoly = [...lift(top), ...lift(right), ...lift(bottom), ...lift(left)];
  g.poly(topPoly).fill(CLIFF_TOP);
  for (let i = 0; i < 8; i++) {
    const p = speckle(i * 5 + mask * 17);
    if (!inDiamond(p.x, p.y, 0.7)) continue;
    g.circle(p.x, p.y - CLIFF_H, 1 + (i % 2)).fill({
      color: shade(CLIFF_TOP, i % 2 === 0 ? 0.7 : 1.2),
      alpha: 0.6,
    });
  }
  // Cracks across the plateau.
  g.moveTo(20, TILE_H / 2 - CLIFF_H + 2).lineTo(30, TILE_H / 2 - CLIFF_H - 3).lineTo(40, TILE_H / 2 - CLIFF_H + 4)
    .stroke({ width: 1, color: shade(CLIFF_TOP, 0.6), alpha: 0.6 });

  // Sunlit rim along open back edges, shadow lip along open front edges.
  if (mask & 4) g.moveTo(...lift(left)).lineTo(...lift(top)).stroke({ width: 2, color: shade(CLIFF_TOP, 1.35), alpha: 0.9 });
  if (mask & 8) g.moveTo(...lift(top)).lineTo(...lift(right)).stroke({ width: 2, color: shade(CLIFF_TOP, 1.3), alpha: 0.9 });
  if (mask & 1) g.moveTo(...lift(right)).lineTo(...lift(bottom)).stroke({ width: 1.5, color: shade(CLIFF_TOP, 0.5), alpha: 0.9 });
  if (mask & 2) g.moveTo(...lift(bottom)).lineTo(...lift(left)).stroke({ width: 1.5, color: shade(CLIFF_TOP, 0.4), alpha: 0.9 });

  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(0, -CLIFF_H - 2, TILE_W, TILE_H + CLIFF_H + 4),
    resolution: 2,
  });
}

/** Shade band a ridge throws onto the ground tile on its shadow side: hugs
 *  the tile's upper-right edge (which faces the rock) and fades inward. */
function bakeCliffShadow(renderer: Renderer): Texture {
  const g = new Graphics();
  const top: [number, number] = [TILE_W / 2, 0];
  const right: [number, number] = [TILE_W, TILE_H / 2];
  // Inward normal of that edge (unit ≈ (-1,2)/√5), stepped in 3px bands.
  const nx = -1.34;
  const ny = 2.68;
  const alphas = [0.26, 0.17, 0.1, 0.05];
  for (let k = 0; k < alphas.length; k++) {
    g.poly([
      top[0] + nx * k, top[1] + ny * k,
      right[0] + nx * k, right[1] + ny * k,
      right[0] + nx * (k + 1), right[1] + ny * (k + 1),
      top[0] + nx * (k + 1), top[1] + ny * (k + 1),
    ]).fill({ color: 0x000000, alpha: alphas[k]! });
  }
  return bakeTile(renderer, g);
}

/** Soft radial drop shadow (scaled per user: units small, buildings big). */
function bakeSoftShadow(renderer: Renderer): Texture {
  const g = new Graphics();
  for (let i = 5; i >= 1; i--) {
    g.ellipse(0, 0, (i / 5) * 30, (i / 5) * 15).fill({ color: 0x000000, alpha: 0.09 });
  }
  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(-32, -17, 64, 34),
    resolution: 2,
  });
}

/** Tiny detail sprinkles: pebble clusters and grass tufts. */
function bakePebble(renderer: Renderer, seed: number): Texture {
  const g = new Graphics();
  for (let i = 0; i < 3 + (seed % 2); i++) {
    const a = ((seed * 7 + i * 5) % 8) / 8;
    const x = Math.cos(a * Math.PI * 2) * (2 + (i % 3));
    const y = Math.sin(a * Math.PI * 2) * (1 + (i % 2));
    g.ellipse(x, y, 2 + (i % 2), 1.4).fill(shade(0x8d8676, 0.85 + (i % 3) * 0.12));
  }
  return renderer.generateTexture({ target: g, frame: new Rectangle(-7, -5, 14, 10), resolution: 2 });
}

function bakeTuft(renderer: Renderer, seed: number): Texture {
  const g = new Graphics();
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 2 + ((seed + i) % 2);
    g.moveTo(x, 2).lineTo(x + ((i % 2) * 2 - 1), -3 - (i % 3))
      .stroke({ width: 1, color: i % 2 === 0 ? 0x6f9c4a : 0x5c8a42, alpha: 0.9 });
  }
  return renderer.generateTexture({ target: g, frame: new Rectangle(-6, -7, 12, 11), resolution: 2 });
}

/* ------------------------------- bridges -------------------------------- */

/** Bake-frame overhang of bridge deck/wreck sprites around the tile rect:
 *  place them at cellTopLeft - (BRIDGE_PAD_X, BRIDGE_PAD_Y). */
export const BRIDGE_PAD_X = 6;
export const BRIDGE_PAD_Y = 14;

const bridgeFrame = (): Rectangle =>
  new Rectangle(-BRIDGE_PAD_X, -BRIDGE_PAD_Y, TILE_W + BRIDGE_PAD_X * 2, TILE_H + BRIDGE_PAD_Y + 8);

/**
 * One bridge deck cell in the classic C&C style: a raised STONE span with
 * weathered paving, low stone parapets along both edges and a dark masonry
 * side wall, running along `axis` (+cx = toward the lower right of the
 * screen, +cy = toward the lower left). Adjacent deck cells share their
 * raised edges, so spans tile seamlessly.
 */
function bakeBridgeDeck(renderer: Renderer, axis: 'cx' | 'cy'): Texture {
  const g = new Graphics();
  const e = 5; // deck lift above the water line
  const top = { x: TILE_W / 2, y: 0 };
  const right = { x: TILE_W, y: TILE_H / 2 };
  const bottom = { x: TILE_W / 2, y: TILE_H };
  const left = { x: 0, y: TILE_H / 2 };
  // Long edges run along the axis; entry corners overhang backwards, exit
  // corners forwards, so consecutive cells overlap without hairline seams.
  const [backA, backB, frontA, frontB] =
    axis === 'cx' ? [top, right, left, bottom] : [top, left, right, bottom];
  const dir =
    axis === 'cx'
      ? { x: 2 / Math.sqrt(5), y: 1 / Math.sqrt(5) }
      : { x: -2 / Math.sqrt(5), y: 1 / Math.sqrt(5) };
  const o = 2.4;
  const raise = (p: { x: number; y: number }, sgn: number): { x: number; y: number } => ({
    x: p.x + dir.x * o * sgn,
    y: p.y + dir.y * o * sgn - e,
  });
  const bA = raise(backA, -1);
  const bB = raise(backB, 1);
  const fA = raise(frontA, -1);
  const fB = raise(frontB, 1);
  // Soft shadow the raised deck throws onto the water below.
  g.poly([
    bA.x - 4, bA.y + e + 4,
    bB.x - 4, bB.y + e + 4,
    fB.x - 4, fB.y + e + 4,
    fA.x - 4, fA.y + e + 4,
  ]).fill({ color: 0x000000, alpha: 0.18 });
  // Dark masonry side wall under the camera-facing long edge.
  g.poly([fA.x, fA.y, fB.x, fB.y, fB.x, fB.y + e, fA.x, fA.y + e]).fill(0x57514a);
  g.moveTo(fA.x, fA.y + e - 1).lineTo(fB.x, fB.y + e - 1)
    .stroke({ width: 1, color: 0x3d3831, alpha: 0.85 });
  // Weathered stone paving with a dusty worn track down the middle.
  g.poly([bA.x, bA.y, bB.x, bB.y, fB.x, fB.y, fA.x, fA.y]).fill(0x9b9384);
  const m0 = lerp(bA, fA, 0.3);
  const m1 = lerp(bB, fB, 0.3);
  const m2 = lerp(bB, fB, 0.7);
  const m3 = lerp(bA, fA, 0.7);
  g.poly([m0.x, m0.y, m1.x, m1.y, m2.x, m2.y, m3.x, m3.y]).fill({ color: 0xa8a193, alpha: 0.65 });
  // Stone joints across the span + a few weathering blotches.
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const a = lerp(bA, bB, t);
    const b = lerp(fA, fB, t);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: 0x6f6759, alpha: 0.7 });
  }
  for (const [ta, tb, r] of [[0.3, 0.42, 2.4], [0.62, 0.55, 1.8], [0.82, 0.4, 2] ] as const) {
    const p = lerp(lerp(bA, bB, ta), lerp(fA, fB, ta), tb);
    g.circle(p.x, p.y, r).fill({ color: 0x847c6e, alpha: 0.7 });
  }
  // Low stone parapets along both long edges: dark base, light sunlit top,
  // broken into segments like the original's masonry rail.
  for (const [pA, pB, base, topC] of [
    [bA, bB, 0x7d7568, 0xbab2a2],
    [fA, fB, 0x6e6759, 0xa8a092],
  ] as const) {
    for (let i = 0; i < 4; i++) {
      const s = lerp(pA, pB, i / 4 + 0.02);
      const eSeg = lerp(pA, pB, (i + 1) / 4 - 0.02);
      g.poly([s.x, s.y - 3.6, eSeg.x, eSeg.y - 3.6, eSeg.x, eSeg.y, s.x, s.y]).fill(base);
      g.moveTo(s.x, s.y - 3.6).lineTo(eSeg.x, eSeg.y - 3.6)
        .stroke({ width: 1.4, color: topC, alpha: 0.95 });
    }
  }
  return renderer.generateTexture({ target: g, frame: bridgeFrame(), resolution: 2 });
}

/** Collapsed span: jagged stone stubs and masonry rubble in the water. */
function bakeBridgeWreck(renderer: Renderer): Texture {
  const g = new Graphics();
  const cx = TILE_W / 2;
  const cy = TILE_H / 2;
  // Broken masonry stubs poking up at both ends of the former span.
  g.poly([cx - 22, cy - 8, cx - 10, cy - 11, cx - 8, cy - 2, cx - 20, cy + 1]).fill(0x8f887a);
  g.poly([cx - 10, cy - 11, cx - 6, cy - 10, cx - 4, cy - 3, cx - 8, cy - 2]).fill(0x655e52);
  g.poly([cx + 10, cy + 2, cx + 22, cy - 1, cx + 24, cy + 7, cx + 12, cy + 10]).fill(0x8f887a);
  g.poly([cx + 8, cy + 3, cx + 12, cy + 2, cx + 12, cy + 10, cx + 9, cy + 9]).fill(0x655e52);
  // Rubble blocks between the stubs.
  g.rect(cx - 6, cy + 2, 10, 3).fill({ color: 0x9b9384, alpha: 0.95 });
  g.rect(cx - 1, cy - 4, 7, 2.5).fill({ color: 0x7d7568, alpha: 0.95 });
  g.circle(cx + 2, cy + 6, 2.6).fill(0x6f675a);
  g.circle(cx - 9, cy + 7, 2).fill(0x7b7366);
  // Foam where the debris meets the water.
  g.ellipse(cx - 14, cy + 1, 9, 2.6).stroke({ width: 1.2, color: 0x9cc3de, alpha: 0.55 });
  g.ellipse(cx + 16, cy + 8, 10, 2.8).stroke({ width: 1.2, color: 0x9cc3de, alpha: 0.5 });
  g.ellipse(cx, cy + 4, 16, 4).stroke({ width: 1, color: 0x7fa9c9, alpha: 0.35 });
  return renderer.generateTexture({ target: g, frame: bridgeFrame(), resolution: 2 });
}

/** Trampled-ground blob under buildings — baked white, tinted per terrain. */
function bakeWornPatch(renderer: Renderer, seed: number): Texture {
  const g = new Graphics();
  // Irregular iso-flattened blob from overlapping soft ellipses.
  for (let i = 0; i < 7; i++) {
    const a = ((seed * 5 + i * 7) % 12) / 12;
    const rx = 34 - i * 3.4;
    const ry = 17 - i * 1.7;
    const ox = Math.cos(a * Math.PI * 2) * (10 - i);
    const oy = Math.sin(a * Math.PI * 2) * (5 - i * 0.5);
    g.ellipse(ox, oy, rx, ry).fill({ color: 0xffffff, alpha: 0.28 });
  }
  // Fine wear speckles.
  for (let i = 0; i < 14; i++) {
    const p = speckle(i * 3 + seed * 17);
    const x = ((p.x - TILE_W / 2) / (TILE_W / 2)) * 30;
    const y = ((p.y - TILE_H / 2) / (TILE_H / 2)) * 14;
    g.circle(x, y, 1 + (i % 2)).fill({ color: 0xffffff, alpha: 0.35 });
  }
  return renderer.generateTexture({
    target: g,
    frame: new Rectangle(-42, -22, 84, 44),
    resolution: 2,
  });
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

/** Interpolate between two projected points. */
function lerp(
  a: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Canvas ridge tent in the classic C&C style: alternating light/dark panel
 * segments with seam lines, a sun-lit and a shaded slope, and an orange
 * gable end with a dark door opening. Ridge runs along the cx axis.
 */
function tent(
  g: Graphics,
  ox: number,
  oy: number,
  l: number,
  wd: number,
  e: number,
  canvas: number,
  door: number,
): void {
  const p0 = iso(ox, oy);
  const p1 = iso(ox + l, oy);
  const p2 = iso(ox + l, oy + wd);
  const p3 = iso(ox, oy + wd);
  const ra = { x: iso(ox + 0.05, oy + wd / 2).x, y: iso(ox + 0.05, oy + wd / 2).y - e };
  const rb = { x: iso(ox + l - 0.05, oy + wd / 2).x, y: iso(ox + l - 0.05, oy + wd / 2).y - e };
  // Segmented canvas panels — the ribbed look that reads "tent" at a glance.
  const SEG = 4;
  for (let i = 0; i < SEG; i++) {
    const a = i / SEG;
    const b = (i + 1) / SEG;
    const alt = i % 2 === 0;
    const n0 = lerp(p0, p1, a);
    const n1 = lerp(p0, p1, b);
    const s0 = lerp(p3, p2, a);
    const s1 = lerp(p3, p2, b);
    const q0 = lerp(ra, rb, a);
    const q1 = lerp(ra, rb, b);
    g.poly([n0.x, n0.y, n1.x, n1.y, q1.x, q1.y, q0.x, q0.y])
      .fill(shade(canvas, alt ? 1.14 : 1.0));
    g.poly([s0.x, s0.y, s1.x, s1.y, q1.x, q1.y, q0.x, q0.y])
      .fill(shade(canvas, alt ? 0.72 : 0.62));
  }
  // Seam lines between the panels.
  for (let i = 1; i < SEG; i++) {
    const t = i / SEG;
    const n = lerp(p0, p1, t);
    const s = lerp(p3, p2, t);
    const q = lerp(ra, rb, t);
    g.moveTo(n.x, n.y).lineTo(q.x, q.y).lineTo(s.x, s.y)
      .stroke({ width: 1, color: shade(canvas, 0.5), alpha: 0.6 });
  }
  // Orange gable end with the dark door opening (front, +cx).
  g.poly([p1.x, p1.y, p2.x, p2.y, rb.x, rb.y]).fill(door);
  g.poly([p1.x, p1.y, p2.x, p2.y, rb.x, rb.y])
    .stroke({ width: 1, color: shade(door, 0.6), alpha: 0.8 });
  const dm = iso(ox + l, oy + wd / 2);
  g.poly([dm.x, dm.y - e * 0.62, dm.x + 4.5, dm.y + 1.5, dm.x - 4.5, dm.y + 1.5]).fill(0x3a2b20);
  // Ridge highlight + soft ground outline.
  g.moveTo(ra.x, ra.y).lineTo(rb.x, rb.y).stroke({ width: 1.5, color: shade(canvas, 1.35) });
  g.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y])
    .stroke({ width: 1, color: 0x37322a, alpha: 0.55 });
}

/**
 * Small civilian gabled house: box walls plus a ridge roof along the cx axis,
 * with a dark door in the +cx gable. Shared by the village scenery buildings.
 */
function houseAt(
  g: Graphics,
  ox: number,
  oy: number,
  l: number,
  wd: number,
  wallH: number,
  rise: number,
  wall: number,
  roof: number,
): void {
  const p0 = iso(ox, oy);
  const p1 = iso(ox + l, oy);
  const p2 = iso(ox + l, oy + wd);
  const p3 = iso(ox, oy + wd);
  // Walls: the two camera-facing faces.
  g.poly([p3.x, p3.y - wallH, p2.x, p2.y - wallH, p2.x, p2.y, p3.x, p3.y]).fill(shade(wall, 0.8));
  g.poly([p2.x, p2.y - wallH, p1.x, p1.y - wallH, p1.x, p1.y, p2.x, p2.y]).fill(shade(wall, 0.58));
  // Ridge along the cx axis, roof slopes down to the wall tops.
  const raBase = iso(ox, oy + wd / 2);
  const rbBase = iso(ox + l, oy + wd / 2);
  const ra = { x: raBase.x, y: raBase.y - wallH - rise };
  const rb = { x: rbBase.x, y: rbBase.y - wallH - rise };
  g.poly([p0.x, p0.y - wallH, p1.x, p1.y - wallH, rb.x, rb.y, ra.x, ra.y]).fill(shade(roof, 1.08));
  g.poly([p3.x, p3.y - wallH, p2.x, p2.y - wallH, rb.x, rb.y, ra.x, ra.y]).fill(shade(roof, 0.66));
  // +cx gable end with the door.
  g.poly([p1.x, p1.y - wallH, p2.x, p2.y - wallH, rb.x, rb.y]).fill(shade(wall, 0.7));
  const dm = iso(ox + l, oy + wd / 2);
  g.poly([dm.x, dm.y - wallH * 0.9, dm.x + 3, dm.y + 1, dm.x - 3, dm.y + 1]).fill(0x33281f);
  // Ridge highlight + soft ground outline.
  g.moveTo(ra.x, ra.y).lineTo(rb.x, rb.y).stroke({ width: 1.2, color: shade(roof, 1.4) });
  g.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y])
    .stroke({ width: 1, color: 0x37322a, alpha: 0.5 });
}

/** Flag pole (body layer); the flag itself lives in the team layer. */
function flagPole(g: Graphics, px: number, py: number, h: number): void {
  g.rect(px - 0.7, py - h, 1.4, h).fill(0x8f8775);
  g.circle(px, py - h, 1.5).fill(0xc4bba8);
}

/** Waving flag at the pole top, white → tinted to the owner's colour. */
function teamFlag(g: Graphics, px: number, py: number, h: number): void {
  const t = py - h;
  g.poly([px + 1, t, px + 13, t + 2, px + 13, t + 9.5, px + 1, t + 7.5]).fill(0xffffff);
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
  ADVPOWER: {
    frameTop: 54,
    fx: 0xffe066,
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.15, 0.15, 1.7, 1.7, 16, 0xb0a794);
      // Three taller turbines + a glowing reactor core (double output).
      const t1 = iso(0.55, 1.05);
      const t2 = iso(1.2, 1.4);
      const t3 = iso(1.55, 0.75);
      cylinder(g, t1.x, t1.y - 10, 9, 32, 0xd0c7b3);
      cylinder(g, t2.x, t2.y - 10, 9, 32, 0xc4bba8);
      cylinder(g, t3.x, t3.y - 10, 9, 32, 0xd0c7b3);
      const core = iso(1.0, 1.0);
      g.circle(core.x, core.y - 30, 6).fill(fx).stroke({ width: 1, color: 0xfff3b0 });
      g.circle(core.x, core.y - 30, 10).stroke({ width: 1, color: fx, alpha: 0.5 });
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
    // Classic C&C tent camp: two green ridge tents side by side on trampled
    // dirt, flag between them in the owner's colour.
    frameTop: 40,
    fx: 0xb4633a, // canvas door orange
    body: (g, w, h, fx) => {
      // Trampled camp ground instead of a concrete plate.
      const c00 = iso(0, 0);
      const cw0 = iso(w, 0);
      const cwh = iso(w, h);
      const c0h = iso(0, h);
      g.poly([c00.x, c00.y, cw0.x, cw0.y, cwh.x, cwh.y, c0h.x, c0h.y])
        .fill(0x8d7c60)
        .stroke({ width: 1, color: 0x5d5344 });
      const b1 = iso(0.7, 1.0);
      const b2 = iso(1.35, 0.95);
      g.ellipse(b1.x, b1.y, 12, 5).fill({ color: 0x7c6c52, alpha: 0.6 });
      g.ellipse(b2.x, b2.y, 9, 4).fill({ color: 0x9c8a6b, alpha: 0.5 });
      tent(g, 0.12, 0.14, 1.75, 0.72, 15, 0x86b45a, fx);
      tent(g, 0.28, 1.12, 1.75, 0.72, 15, 0x7dab52, fx);
      const p = iso(1.5, 1.0);
      flagPole(g, p.x, p.y, 36);
    },
    team: (g) => {
      const p = iso(1.5, 1.0);
      teamFlag(g, p.x, p.y, 36);
    },
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
  RADAR: {
    frameTop: 50,
    fx: 0x8dffa0, // radar-scope green
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 1.2, 1.6, 16, 0xb0a794); // operations block
      const m = iso(1.4, 0.75);
      g.rect(m.x - 2.5, m.y - 44, 5, 40).fill(0x6f675a); // mast
      g.rect(m.x - 6, m.y - 24, 12, 3).fill(0x6f675a); // cross brace
      // Tilted dish bowl with a lit inner face and a feed arm.
      g.ellipse(m.x + 3, m.y - 46, 12, 7).fill(0xcfd6dc).stroke({ width: 1, color: 0x5a6068 });
      g.ellipse(m.x + 1, m.y - 47, 8, 4.5).fill(0xe8edf2);
      g.rect(m.x + 2, m.y - 50, 9, 1.8).fill(0x50565e); // feed arm
      g.circle(m.x + 11, m.y - 49, 2.2).fill(fx); // emitter blip (fx)
      // Radar scope glowing on the block roof.
      const r = iso(0.75, 1.05);
      g.circle(r.x, r.y - 18, 4.5).fill({ color: fx, alpha: 0.85 });
      g.circle(r.x, r.y - 18, 7).stroke({ width: 1, color: fx, alpha: 0.4 });
    },
    team: (g) => teamMark(g, 0.75, 1.7, 14),
  },
  BRIDGE: {
    // Spans render in the terrain layer (deck sprite per cell); the building
    // itself only carries hp and the damage bar — nothing to draw here.
    frameTop: 10,
    fx: 0x9a7648,
    body: (g) => {
      g.rect(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0 });
    },
    team: (g) => {
      g.rect(0, 0, 1, 1).fill({ color: 0x000000, alpha: 0 });
    },
  },
  ERZ_BOHRTURM: {
    frameTop: 58,
    fx: 0xdba832, // ore amber
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      const m = iso(1, 1);
      cylinder(g, m.x, m.y - 2, 12, 12, 0x8d857a); // drill housing base
      // Segmented mast: stacked drill sections, slimmer toward the top.
      cylinder(g, m.x, m.y - 16, 7, 12, 0x6f675a);
      cylinder(g, m.x, m.y - 30, 6, 12, 0x7b7366);
      cylinder(g, m.x, m.y - 43, 5, 11, 0x6f675a);
      g.rect(m.x - 1.5, m.y - 56, 3, 6).fill(0x50565e); // drill tip
      // Ore pile at the foot + status light (fx).
      const p = iso(1.55, 1.4);
      g.ellipse(p.x, p.y - 3, 7, 3.5).fill(fx);
      g.circle(m.x + 8, m.y - 34, 2.2).fill(fx);
    },
    team: (g) => teamMark(g, 1, 1.85, 10),
  },
  HOSPITAL: {
    // Neutral tech building: white clinic block with a fixed red cross —
    // capturable like the Bohrturm, so the team accent stays small.
    frameTop: 40,
    fx: 0xd93b3b, // red cross (never faction-tinted)
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.2, 1.6, 1.6, 20, 0xe8e4dc); // white main block
      prismAt(g, 1.1, 1.05, 0.65, 0.65, 12, 0xd6d1c6); // entrance annex
      // Red cross on the flat roof.
      const c = iso(1, 1);
      g.rect(c.x - 2.5, c.y - 28, 5, 14).fill(fx);
      g.rect(c.x - 7, c.y - 23.5, 14, 5).fill(fx);
      // Dark entrance door on the annex front.
      const d = iso(1.75, 1.4);
      g.poly([d.x, d.y - 8, d.x + 3.5, d.y - 6, d.x + 3.5, d.y + 1, d.x, d.y - 1]).fill(0x3a352c);
    },
    team: (g) => teamMark(g, 1.7, 0.35, 8),
  },
  HAUS1: {
    // Civilian cottage (village scenery, never capturable).
    frameTop: 30,
    fx: 0xc9a86a,
    body: (g) => {
      houseAt(g, 0.12, 0.12, 0.76, 0.76, 9, 8, 0xb8ab93, 0x8a5c40);
    },
    team: (g) => teamMark(g, 0.5, 0.5, 4),
  },
  HAUS2: {
    // Civilian farmhouse: longer body, weathered roof.
    frameTop: 32,
    fx: 0xc9a86a,
    body: (g) => {
      houseAt(g, 0.12, 0.15, 1.76, 0.7, 10, 9, 0xb0a08a, 0x7d6a4f);
      // Small woodpile at the gable end.
      const wp = iso(0.35, 1.0);
      g.rect(wp.x - 6, wp.y - 4, 12, 4).fill(0x6e543a);
      g.circle(wp.x - 3, wp.y - 4, 1.6).fill(0x8a6a48);
      g.circle(wp.x + 2, wp.y - 4, 1.6).fill(0x8a6a48);
    },
    team: (g) => teamMark(g, 1, 0.5, 4),
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
  GUARDTOWER: {
    frameTop: 50,
    fx: 0xcfd6dc,
    body: (g, _w, _h, fx) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      // Four stilt legs carrying the elevated platform.
      g.poly([c.x - 14, c.y + 2, c.x - 11, c.y + 2, c.x - 5, c.y - 30, c.x - 8, c.y - 30]).fill(0x6f675a);
      g.poly([c.x + 11, c.y + 2, c.x + 14, c.y + 2, c.x + 8, c.y - 30, c.x + 5, c.y - 30]).fill(0x5e564b);
      g.poly([c.x - 7, c.y - 4, c.x - 4, c.y - 4, c.x - 2, c.y - 30, c.x - 5, c.y - 30]).fill(0x655d51);
      g.poly([c.x + 4, c.y - 4, c.x + 7, c.y - 4, c.x + 5, c.y - 30, c.x + 2, c.y - 30]).fill(0x554e44);
      g.rect(c.x - 10, c.y - 18, 20, 2).fill(0x5e564b); // cross brace
      // Platform with sandbag parapet and manned MG post.
      g.ellipse(c.x, c.y - 32, 16, 8).fill(0x8f8775).stroke({ width: 1, color: 0x4a443a });
      g.ellipse(c.x, c.y - 35, 12, 6).fill(0xa8a08c);
      g.rect(c.x - 4, c.y - 46, 8, 10).fill(0x7d7568).stroke({ width: 1, color: 0x4a443a }); // cabin
      g.rect(c.x - 3, c.y - 44, 6, 2.5).fill(0x3a352c); // viewing slit
      g.rect(c.x + 3, c.y - 42, 12, 2).fill(0x4a4a4a); // MG barrel
      g.circle(c.x + 15, c.y - 41, 1.4).fill(fx); // muzzle
      g.rect(c.x - 5, c.y - 52, 1.5, 7).fill(0x6f675a); // flag pole
      g.poly([c.x - 3.5, c.y - 52, c.x + 3, c.y - 50.5, c.x - 3.5, c.y - 49]).fill(0xc23b2e);
    },
    team: (g) => teamMark(g, 0.5, 0.5, 12),
  },
  AGT: {
    frameTop: 62,
    fx: 0xffb24a,
    body: (g, _w, _h, fx) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      // Heavy armoured concrete shaft instead of stilts.
      g.poly([c.x - 12, c.y + 2, c.x + 12, c.y + 2, c.x + 9, c.y - 34, c.x - 9, c.y - 34]).fill(0x6b6f73);
      g.poly([c.x - 12, c.y + 2, c.x - 9, c.y - 34, c.x - 2, c.y - 34, c.x - 2, c.y + 2]).fill(0x585c60);
      g.rect(c.x - 10, c.y - 14, 20, 2.5).fill(0x4a4e52); // reinforcing band
      g.rect(c.x - 10, c.y - 26, 20, 2.5).fill(0x4a4e52);
      // Rotating missile turret on top.
      g.ellipse(c.x, c.y - 38, 15, 8).fill(0x7d8288).stroke({ width: 1, color: 0x3a3e42 });
      g.ellipse(c.x, c.y - 42, 11, 6).fill(0x9aa0a6);
      // Twin Tomahawk missile tubes, angled up.
      g.rect(c.x - 8, c.y - 58, 5, 18).fill(0x5a5e62).stroke({ width: 1, color: 0x2b2f33 });
      g.rect(c.x + 3, c.y - 58, 5, 18).fill(0x4a4e52).stroke({ width: 1, color: 0x2b2f33 });
      g.poly([c.x - 8, c.y - 58, c.x - 3, c.y - 58, c.x - 5.5, c.y - 64]).fill(0xc23b2e); // nose cones
      g.poly([c.x + 3, c.y - 58, c.x + 8, c.y - 58, c.x + 5.5, c.y - 64]).fill(0xc23b2e);
      g.circle(c.x, c.y - 42, 2.5).fill(fx); // targeting optic
    },
    team: (g) => teamMark(g, 0.5, 0.5, 11),
  },
  PRISM: {
    frameTop: 54,
    fx: 0xa7f0ff,
    body: (g, _w, _h, fx) => {
      concretePlate(g, 1, 1);
      const c = iso(0.5, 0.5);
      prismAt(g, 0.3, 0.3, 0.4, 0.4, 8, 0xb0a794); // faceted base block
      // Tapered pylon rising to the emitter crystal.
      g.poly([c.x - 5, c.y - 6, c.x + 5, c.y - 6, c.x + 2.5, c.y - 40, c.x - 2.5, c.y - 40]).fill(0x9aa7b0);
      g.poly([c.x - 5, c.y - 6, c.x - 2.5, c.y - 40, c.x, c.y - 40, c.x, c.y - 6]).fill(0x8592a0); // shaded face
      // Glowing prism crystal on top (diamond, never faction-tinted).
      const ey = c.y - 48;
      g.poly([c.x, ey - 10, c.x + 7, ey, c.x, ey + 8, c.x - 7, ey]).fill(fx).stroke({ width: 1, color: 0xe8ffff });
      g.poly([c.x, ey - 10, c.x, ey + 8, c.x - 7, ey]).fill({ color: 0xe8ffff, alpha: 0.55 }); // lit facet
      g.circle(c.x, ey, 11).stroke({ width: 1, color: fx, alpha: 0.5 }); // energy halo
    },
    team: (g) => teamMark(g, 0.5, 0.5, 9),
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
  FLUGFELD: {
    frameTop: 26,
    fx: 0xcfd6dc,
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      // Ground quad in cell coordinates, iso-projected (runway markings).
      const quad = (x0: number, y0: number, x1: number, y1: number, color: number): void => {
        const a = iso(x0, y0);
        const b = iso(x1, y0);
        const c = iso(x1, y1);
        const d = iso(x0, y1);
        g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(color);
      };
      // Dark tarmac runway along the long axis...
      quad(0.3, 1.2, 3.7, 2.1, 0x4a463d);
      // ...with yellow threshold stripes at both ends and a dashed centerline.
      quad(0.42, 1.3, 0.54, 2.0, 0xd8b13c);
      quad(3.46, 1.3, 3.58, 2.0, 0xd8b13c);
      for (let x = 0.85; x <= 3.05; x += 0.45) quad(x, 1.61, x + 0.22, 1.69, fx);
      prismAt(g, 0.15, 0.15, 1.2, 0.8, 16, 0xb0a794); // hangar
      // Windsock beside the runway end.
      const p = iso(3.45, 0.55);
      g.rect(p.x, p.y - 20, 1.5, 20).fill(0x6f6f6f);
      g.poly([p.x + 1.5, p.y - 20, p.x + 11, p.y - 16.5, p.x + 1.5, p.y - 13]).fill(0xe8833a);
    },
    team: (g) => teamMark(g, 1.5, 1.1, 20),
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
  IRONCURTAIN: {
    frameTop: 52,
    fx: 0xff5540, // curtain-energy red
    body: (g, w, h, fx) => {
      concretePlate(g, w, h);
      prismAt(g, 0.2, 0.9, 1.6, 0.9, 12, 0xa8a08c); // generator block
      // Twin pylons with the crackling energy orb suspended between them.
      const a = iso(0.55, 0.6);
      const b = iso(1.55, 0.6);
      for (const p of [a, b]) {
        g.rect(p.x - 2.5, p.y - 40, 5, 36).fill(0x6f675a);
        g.rect(p.x - 4.5, p.y - 42, 9, 4).fill(0x8f8775); // emitter head
      }
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - 40;
      g.moveTo(a.x, my).lineTo(b.x, my).stroke({ width: 1.5, color: fx, alpha: 0.7 }); // arc
      g.circle(mx, my, 7).fill({ color: fx, alpha: 0.9 }); // energy orb
      g.circle(mx - 2, my - 2, 2.5).fill(0xffd0c4); // hot core glint
      g.circle(mx, my, 11).stroke({ width: 1, color: fx, alpha: 0.45 }); // halo
    },
    team: (g) => teamMark(g, 1, 1.7, 10),
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

// ── V3 launcher: flatbed truck, angled launch ramp, one big finned rocket ──
function drawV3(g: Graphics): void {
  g.rect(-14, -11, 26, 5).fill(TREAD);
  g.rect(-14, 6, 26, 5).fill(TREAD);
  g.roundRect(-14, -8, 24, 16, 2).fill(HULL_LO).stroke({ width: 1.2, color: OUTLINE });
  g.rect(-14, -8, 24, 3).fill(HULL);
  g.roundRect(-13, -5.5, 8, 11, 2).fill(HULL_HI); // cab up front
  g.poly([-4, 4, 15, -1.5, 15, 1, -4, 6.5]).fill(METAL_DK); // launch ramp rail
  // The V3 rocket itself, resting on the ramp: pale body, red nose, tail fins.
  g.roundRect(-3, -3.2, 19, 4.4, 2.2).fill(0xd8dde2).stroke({ width: 1, color: OUTLINE });
  g.poly([16, -3.2, 22, -1, 16, 1.2]).fill(0xe23b32);
  g.rect(-4.5, -5, 3, 8).fill(METAL); // fins
}
function teamV3(g: Graphics): void {
  g.rect(-12, -3.5, 5.5, 7).fill(0xffffff); // cab roof
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

function drawIngenieur(body: Graphics): void {
  body.rect(2, -1.6, 6, 4.2).fill(0xc9b06a).stroke({ width: 0.8, color: 0x6e5a2e }); // toolbox
  body.circle(0, 0, 5).fill(UNIFORM).stroke({ width: 1, color: 0x2a2a24 });
  body.circle(-1.4, -1.4, 2).fill(0xe8d9a0); // hard-hat highlight
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

// ── Paradrop plane: long fuselage, straight wings, twin engine nacelles ──
function drawParaplane(g: Graphics): void {
  g.rect(-7, -16, 5, 32).fill(HULL_LO).stroke({ width: 1, color: OUTLINE }); // straight wings
  g.roundRect(-20, -5, 40, 10, 4).fill(HULL).stroke({ width: 1.2, color: OUTLINE }); // fuselage
  g.rect(-20, -5, 40, 3).fill(HULL_HI);
  g.roundRect(14, -3.5, 7, 7, 3).fill(GLASS); // cockpit
  g.poly([-20, -2, -26, -7, -24, 0, -26, 7, -20, 2]).fill(HULL_LO); // tailplane
  for (const wy of [-11, 11]) {
    g.roundRect(-6, wy - 2.5, 10, 5, 2).fill(METAL_DK); // engine nacelles
    g.circle(4, wy, 4).fill({ color: 0xe8edf2, alpha: 0.25 }); // prop disc
  }
}
function teamParaplane(g: Graphics): void {
  g.rect(-3, -3.5, 9, 7).fill(0xffffff); // fuselage band
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

// ── Missile submarine: longer hull, aft tower, missile hatches fore ──
function drawMissileSub(g: Graphics): void {
  g.ellipse(0, 0, 24, 6).fill(HULL_LO).stroke({ width: 1, color: OUTLINE }); // hull
  g.ellipse(10, 0, 9, 3.4).fill(HULL); // fore deck
  g.roundRect(-9, -3.2, 10, 6.4, 2.5).fill(0x4b545d).stroke({ width: 1, color: OUTLINE }); // tower (aft)
  g.rect(-5, -6.5, 1.6, 4).fill(METAL_DK); // periscope
  // Vertical launch hatches on the fore deck.
  for (const ox of [7, 12, 17]) {
    g.circle(ox, -1.8, 1.5).fill(METAL_DK).stroke({ width: 0.8, color: OUTLINE });
    g.circle(ox, 1.8, 1.5).fill(METAL_DK).stroke({ width: 0.8, color: OUTLINE });
  }
  g.ellipse(-21, 0, 4, 2.4).fill(0x4b545d); // stern planes
}
function teamMissileSub(g: Graphics): void {
  g.roundRect(-8, -2, 8, 4, 1).fill(0xffffff); // tower top
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
  const v3: UnitSprite[] = [];
  const rifleman: UnitSprite[] = [];
  const ingenieur: UnitSprite[] = [];
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
  const paraplane: UnitSprite[] = [];
  const gunboat: UnitSprite[] = [];
  const destroyer: UnitSprite[] = [];
  const sub: UnitSprite[] = [];
  const missilesub: UnitSprite[] = [];
  const transport: UnitSprite[] = [];
  for (let f = 0; f < FACING_COUNT; f++) {
    tank.push(bakeVehicle(renderer, f, 28, drawTank, teamTank));
    mammoth.push(bakeVehicle(renderer, f, 34, drawMammoth, teamMammoth));
    artillery.push(bakeVehicle(renderer, f, 32, drawArtillery, teamArtillery));
    v3.push(bakeVehicle(renderer, f, 32, drawV3, teamV3));
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
    paraplane.push(bakeVehicle(renderer, f, 36, drawParaplane, teamParaplane));
    gunboat.push(bakeVehicle(renderer, f, 24, drawGunboat, teamGunboat));
    destroyer.push(bakeVehicle(renderer, f, 32, drawDestroyer, teamDestroyer));
    sub.push(bakeVehicle(renderer, f, 28, drawSub, teamSub));
    missilesub.push(bakeVehicle(renderer, f, 32, drawMissileSub, teamMissileSub));
    transport.push(bakeVehicle(renderer, f, 28, drawTransportShip, teamTransportShip));
    rifleman.push(bakeInfantry(renderer, f, drawRifleman, teamHelmet));
    ingenieur.push(bakeInfantry(renderer, f, drawIngenieur, teamHelmet));
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
  // Shadow thrown left like every other shadow (light from the east).
  tree.ellipse(-6, 2, 12, 6).fill({ color: 0x000000, alpha: 0.3 });
  tree.rect(-2, -8, 4, 10).fill(0x5d4326);
  tree.circle(0, -16, 10).fill(0x2e4a1e).stroke({ width: 1, color: 0x1d3013, alpha: 0.8 });
  tree.circle(-6, -10, 7).fill(0x3a5c27);
  tree.circle(6, -11, 7).fill(0x35541f);
  tree.circle(0, -24, 7).fill(0x3f6329);

  const shell = new Graphics().circle(0, 0, 3).fill(0xffe08a).stroke({ width: 1, color: 0xffb347 });

  // Veterancy chevrons (gold, dark halo): one for veteran, two for elite.
  const bakeChevron = (count: number): Texture => {
    const g = new Graphics();
    for (let i = 0; i < count; i++) {
      const y = -i * 5;
      g.poly([-5, y + 3, 0, y - 2, 5, y + 3, 5, y + 5, 0, y, -5, y + 5])
        .fill(0x1f1a08)
        .stroke({ width: 2, color: 0x1f1a08 });
    }
    for (let i = 0; i < count; i++) {
      const y = -i * 5;
      g.poly([-5, y + 3, 0, y - 2, 5, y + 3, 5, y + 5, 0, y, -5, y + 5]).fill(0xffd94d);
    }
    return renderer.generateTexture({
      target: g,
      frame: new Rectangle(-8, -10, 16, 18),
      resolution: 2,
    });
  };

  // Goodie crate: small iso wooden box with bright edge strapping, sitting on
  // a soft drop shadow so it pops against any ground.
  const crateG = new Graphics();
  {
    const top = 0xc9a35c;
    crateG.ellipse(0, 6, 11, 5).fill({ color: 0x000000, alpha: 0.28 });
    crateG.poly([0, -12, 10, -7, 10, 3, 0, 8, -10, 3, -10, -7]).fill(shade(top, 0.72));
    crateG.poly([0, -12, 10, -7, 0, -2, -10, -7]).fill(top); // lid
    crateG.poly([0, -2, 10, -7, 10, 3, 0, 8]).fill(shade(top, 0.58)); // right face
    crateG.poly([0, -2, -10, -7, -10, 3, 0, 8]).fill(shade(top, 0.82)); // left face
    // Strapping.
    crateG.moveTo(-10, -7).lineTo(0, -2).lineTo(10, -7).stroke({ width: 1.2, color: 0x8a6a3a });
    crateG.moveTo(0, -2).lineTo(0, 8).stroke({ width: 1.2, color: 0x8a6a3a });
    crateG.poly([0, -12, 10, -7, 0, -2, -10, -7]).stroke({ width: 1, color: 0xe8cf96, alpha: 0.9 });
  }

  const water = new Graphics().poly(overshootDiamondPath()).fill(0x2b5d8a);
  water.moveTo(18, 14).quadraticCurveTo(26, 11, 34, 14).stroke({ width: 1.5, color: 0x4a83b3, alpha: 0.8 });
  water.moveTo(30, 21).quadraticCurveTo(38, 18, 46, 21).stroke({ width: 1.5, color: 0x4a83b3, alpha: 0.6 });

  // Bridge decks are baked by bakeBridgeDeck below (raised span with stone
  // side wall and curbs, one texture per axis) — the ground pass renders
  // plain water beneath them.

  // Frozen surface: pale blue sheet with angular cracks and a cool outline.
  const ice = new Graphics().poly(overshootDiamondPath()).fill(0xbcdbe9);
  ice.moveTo(14, 15).lineTo(24, 12).lineTo(31, 16).stroke({ width: 1, color: 0x8fb8cc, alpha: 0.8 });
  ice.moveTo(24, 12).lineTo(27, 8).stroke({ width: 1, color: 0x8fb8cc, alpha: 0.6 });
  ice.moveTo(33, 22).lineTo(42, 19).lineTo(49, 23).stroke({ width: 1, color: 0x9fc4d6, alpha: 0.7 });
  ice.moveTo(20, 20).lineTo(26, 24).stroke({ width: 1, color: 0xdfeef5, alpha: 0.9 });
  ice.poly(diamondPath()).stroke({ width: 1, color: 0x7fa9bf, alpha: 0.5 });

  // Variant BASE tones stay nearly identical — the visual variety comes
  // from the speckle patterns and the macro tint, not from patchwork tiles.
  const groundAtlas = bakeGroundAtlas(renderer, [
    ...[0x8a6f4d, 0x896e4b, 0x8b704e, 0x886d4a, 0x8a6f4c].map(
      (c, i) => [`dirt${i}`, groundTileGraphics(c, i * 13)] as const,
    ),
    ...[0x4d7a35, 0x4c7834, 0x4e7b36, 0x4b7733, 0x4d7935].map(
      (c, i) => [`grass${i}`, groundTileGraphics(c, 5 + i * 11)] as const,
    ),
    ...[0xd6bd82, 0xd4bb80, 0xd7bf84, 0xd3ba7e, 0xd5bc81].map(
      (c, i) => [`sand${i}`, groundTileGraphics(c, 9 + i * 7)] as const,
    ),
    ['water', water] as const,
    ['ice', ice] as const,
  ]);

  return {
    groundAtlas,
    bridgeCx: bakeBridgeDeck(renderer, 'cx'),
    bridgeCy: bakeBridgeDeck(renderer, 'cy'),
    bridgeWreck: bakeBridgeWreck(renderer),
    wornPatch: [bakeWornPatch(renderer, 0), bakeWornPatch(renderer, 1)],
    rocks: [bakeRock(renderer, 0), bakeRock(renderer, 1), bakeRock(renderer, 2)],
    cliffs: Array.from({ length: 16 }, (_, mask) => bakeCliff(renderer, mask)),
    cliffShadow: bakeCliffShadow(renderer),
    softShadow: bakeSoftShadow(renderer),
    pebbles: [bakePebble(renderer, 0), bakePebble(renderer, 1)],
    tufts: [bakeTuft(renderer, 0), bakeTuft(renderer, 1)],
    ore: bakeTile(renderer, oreOverlay),
    gems: bakeTile(renderer, gemOverlay),
    tree: renderer.generateTexture({
      target: tree,
      frame: new Rectangle(-16, -36, 32, 44),
      resolution: 2,
    }),
    crate: renderer.generateTexture({
      target: crateG,
      frame: new Rectangle(-13, -14, 26, 26),
      resolution: 2,
    }),
    chevrons: [bakeChevron(1), bakeChevron(2)],
    tank,
    mammoth,
    artillery,
    v3,
    rifleman,
    ingenieur,
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
    paraplane,
    gunboat,
    destroyer,
    sub,
    missilesub,
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
