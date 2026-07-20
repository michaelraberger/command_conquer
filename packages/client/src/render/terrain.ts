import {
  SUBCELL,
  TERRAIN_BRIDGE,
  TERRAIN_BRIDGE_WRECK,
  TERRAIN_DIRT,
  TERRAIN_GRASS,
  TERRAIN_ICE,
  TERRAIN_ROCK,
  TERRAIN_SAND,
  TERRAIN_TREE,
  TERRAIN_WATER,
  cellCenter,
  cellIndex,
  type GameState,
} from '@cac/sim';
import { Container, MeshSimple, Sprite, Texture } from 'pixi.js';
import { heightAtWorld, slopeShade } from './height.js';
import { cellToScreen, depthOf, TILE_H, TILE_W } from './iso.js';
import { BRIDGE_PAD_X, BRIDGE_PAD_Y, CLIFF_H, type GameTextures } from './placeholders.js';

/** Deterministic 0..1 hash of a cell (render flavour only, never sim input). */
function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Large-scale value noise over cells — soft bright/dark ground patches. */
function macroNoise(cx: number, cy: number): number {
  const gx = cx / 5;
  const gy = cy / 5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const a = hash01(x0, y0);
  const b = hash01(x0 + 1, y0);
  const c = hash01(x0, y0 + 1);
  const d = hash01(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function terrainAt(state: GameState, cx: number, cy: number, fallback: number): number {
  if (cx < 0 || cy < 0 || cx >= state.mapWidth || cy >= state.mapHeight) return fallback;
  return state.terrain[cellIndex(state, cx, cy)]!;
}

const N8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

/** Cells per chunk-mesh side. Every legal map size is a multiple of 16, but
 *  the builders clamp anyway so odd sizes would merely get a smaller edge
 *  chunk instead of breaking. */
const CHUNK = 16;

/** Screen position of grid CORNER (cx,cy), lifted by the height field. */
function cornerScreen(cx: number, cy: number): { x: number; y: number } {
  return {
    x: (cx - cy) * (TILE_W / 2),
    y: (cx + cy) * (TILE_H / 2) - heightAtWorld(cx * SUBCELL, cy * SUBCELL),
  };
}

/**
 * The vertex lattice of one chunk: per cell 5 vertices (4 corners on the
 * shared height lattice + a centre) and 4 triangles, so sloped terrain stays
 * seamless across cells while the centre vertex keeps the hill crowns from
 * flattening. `linearUvs` are plain map-space coordinates (u = gx / mapW) —
 * the shading and fog overlays sample a 1-px-per-cell canvas texture with
 * them, which bilinear filtering turns into smooth gradients.
 */
interface ChunkGeometry {
  vertices: Float32Array;
  linearUvs: Float32Array;
  indices: Uint32Array;
  /** Cell range covered (x0/y0 inclusive, x1/y1 exclusive). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function buildChunkGeometries(state: GameState): ChunkGeometry[] {
  const chunks: ChunkGeometry[] = [];
  const mapW = state.mapWidth;
  const mapH = state.mapHeight;
  for (let y0 = 0; y0 < mapH; y0 += CHUNK) {
    for (let x0 = 0; x0 < mapW; x0 += CHUNK) {
      const x1 = Math.min(x0 + CHUNK, mapW);
      const y1 = Math.min(y0 + CHUNK, mapH);
      const cells = (x1 - x0) * (y1 - y0);
      const vertices = new Float32Array(cells * 10);
      const linearUvs = new Float32Array(cells * 10);
      const indices = new Uint32Array(cells * 12);
      let cell = 0;
      for (let cy = y0; cy < y1; cy++) {
        for (let cx = x0; cx < x1; cx++) {
          const top = cornerScreen(cx, cy);
          const right = cornerScreen(cx + 1, cy);
          const bottom = cornerScreen(cx + 1, cy + 1);
          const left = cornerScreen(cx, cy + 1);
          const centreY =
            (cx + cy + 1) * (TILE_H / 2) -
            heightAtWorld((cx + 0.5) * SUBCELL, (cy + 0.5) * SUBCELL);
          const v = cell * 10;
          vertices[v] = top.x;
          vertices[v + 1] = top.y;
          vertices[v + 2] = right.x;
          vertices[v + 3] = right.y;
          vertices[v + 4] = bottom.x;
          vertices[v + 5] = bottom.y;
          vertices[v + 6] = left.x;
          vertices[v + 7] = left.y;
          vertices[v + 8] = (top.x + bottom.x) / 2;
          vertices[v + 9] = centreY;
          // Corner UVs sit on the canvas texel boundaries, so bilinear
          // sampling blends the 4 cells sharing that lattice corner.
          linearUvs[v] = cx / mapW;
          linearUvs[v + 1] = cy / mapH;
          linearUvs[v + 2] = (cx + 1) / mapW;
          linearUvs[v + 3] = cy / mapH;
          linearUvs[v + 4] = (cx + 1) / mapW;
          linearUvs[v + 5] = (cy + 1) / mapH;
          linearUvs[v + 6] = cx / mapW;
          linearUvs[v + 7] = (cy + 1) / mapH;
          linearUvs[v + 8] = (cx + 0.5) / mapW;
          linearUvs[v + 9] = (cy + 0.5) / mapH;
          const base = cell * 5;
          const t = cell * 12;
          indices[t] = base;
          indices[t + 1] = base + 1;
          indices[t + 2] = base + 4;
          indices[t + 3] = base + 1;
          indices[t + 4] = base + 2;
          indices[t + 5] = base + 4;
          indices[t + 6] = base + 2;
          indices[t + 7] = base + 3;
          indices[t + 8] = base + 4;
          indices[t + 9] = base + 3;
          indices[t + 10] = base;
          indices[t + 11] = base + 4;
          cell++;
        }
      }
      chunks.push({ vertices, linearUvs, indices, x0, y0, x1, y1 });
    }
  }
  return chunks;
}

/**
 * Chunk meshes spanning the whole map on the height lattice, sampling the
 * given texture with linear map-space UVs. Both the terrain shading overlay
 * and the fog of war render this way: a canvas with one pixel per cell,
 * stretched over the terrain relief.
 */
export function buildOverlayChunkMeshes(state: GameState, texture: Texture): MeshSimple[] {
  return buildChunkGeometries(state).map((chunk) => {
    const mesh = new MeshSimple({
      texture,
      vertices: chunk.vertices,
      uvs: chunk.linearUvs,
      indices: chunk.indices,
    });
    mesh.cullable = true;
    return mesh;
  });
}

/** The terrain layer plus the hooks the loop uses when a bridge span falls
 *  or an engineer rebuilds one. */
export interface TerrainView {
  layer: Container;
  /** Swap the deck sprite at (cx,cy) for collapsed-bridge debris. */
  collapseBridge(cx: number, cy: number): void;
  /** Swap the debris at (cx,cy) back for a deck sprite (engineer repair). */
  restoreBridge(cx: number, cy: number): void;
}

/** Water in every form — used for shore shading around bridge cells too. */
function isWaterKind(t: number): boolean {
  return t === TERRAIN_WATER || t === TERRAIN_BRIDGE || t === TERRAIN_BRIDGE_WRECK;
}

/** Atlas tile key for a cell (bridge cells render as water; deck on top). */
function groundKey(t: number, variant: number): string {
  if (isWaterKind(t)) return 'water';
  if (t === TERRAIN_ICE) return 'ice';
  if (t === TERRAIN_GRASS) return `grass${variant}`;
  if (t === TERRAIN_SAND) return `sand${variant}`;
  return `dirt${variant}`;
}

/**
 * Per-cell brightness factor (≤ 1): soft macro patches + ambient occlusion at
 * hard edges + slope lighting from the height field; open water darkens away
 * from the shore. Exactly the factors the old per-mesh tint applied.
 */
function shadeFactor(state: GameState, cx: number, cy: number): number {
  const t = state.terrain[cellIndex(state, cx, cy)]!;
  if (isWaterKind(t)) {
    let open = 0;
    for (const [dx, dy] of N8) {
      if (isWaterKind(terrainAt(state, cx + dx, cy + dy, TERRAIN_WATER))) open++;
    }
    return 1 - open * 0.022;
  }
  if (t === TERRAIN_ICE) return 1;
  let occl = 0;
  for (const [dx, dy] of N8) {
    const n = terrainAt(state, cx + dx, cy + dy, t);
    if (n === TERRAIN_ROCK || n === TERRAIN_TREE) occl++;
  }
  const ao = 1 - Math.min(0.16, occl * 0.045);
  const macro = 0.88 + 0.12 * macroNoise(cx, cy);
  // The factor stays below 1 on purpose — lit east slopes then genuinely
  // read brighter than level ground.
  return Math.max(0.68, Math.min(1, macro * ao * slopeShade(cx, cy) * 0.94));
}

/**
 * The static shading overlay: since every factor only darkens (≤ 1), it is
 * baked as BLACK with alpha = 1 − factor on a 1-px-per-cell canvas and drawn
 * with normal blending — visually identical to a multiply tint, but fully
 * batchable, and bilinear sampling makes the shading smoother than the old
 * per-cell tint ever was.
 */
function buildShadingTexture(state: GameState): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = state.mapWidth;
  canvas.height = state.mapHeight;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(state.mapWidth, state.mapHeight);
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const i = (cy * state.mapWidth + cx) * 4;
      img.data[i + 3] = Math.round((1 - shadeFactor(state, cx, cy)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(canvas);
}

/**
 * Builds the static ground layer: chunk meshes (16×16 cells each) over the
 * ground-tile atlas, corners on the shared height lattice, then a canvas-based
 * shading overlay, ridge-cast shadow bands and tiny detail sprinkles on top.
 * All flavour derives from the cell coordinates — deterministic and purely
 * presentational. Bridge cells render as water with a raised deck sprite on
 * top; `collapseBridge` swaps a deck for wreck debris when the sim reports a
 * span collapse.
 */
export function buildTerrainLayer(state: GameState, tex: GameTextures): TerrainView {
  const layer = new Container();
  layer.interactiveChildren = false;
  const atlas = tex.groundAtlas;

  // Ground: one mesh per chunk, per-cell UVs into the atlas slot.
  for (const chunk of buildChunkGeometries(state)) {
    const uvs = new Float32Array(chunk.linearUvs.length);
    let cell = 0;
    for (let cy = chunk.y0; cy < chunk.y1; cy++) {
      for (let cx = chunk.x0; cx < chunk.x1; cx++) {
        const t = state.terrain[cellIndex(state, cx, cy)]!;
        const variant = Math.floor(hash01(cx * 3 + 1, cy * 5 + 2) * 5) % 5;
        const [u0, v0, u1, v1] = atlas.uv[groundKey(t, variant)]!;
        const uMid = (u0 + u1) / 2;
        const vMid = (v0 + v1) / 2;
        const v = cell * 10;
        uvs[v] = uMid;
        uvs[v + 1] = v0;
        uvs[v + 2] = u1;
        uvs[v + 3] = vMid;
        uvs[v + 4] = uMid;
        uvs[v + 5] = v1;
        uvs[v + 6] = u0;
        uvs[v + 7] = vMid;
        uvs[v + 8] = uMid;
        uvs[v + 9] = vMid;
        cell++;
      }
    }
    const mesh = new MeshSimple({
      texture: atlas.texture,
      vertices: chunk.vertices,
      uvs,
      indices: chunk.indices,
    });
    mesh.cullable = true;
    layer.addChild(mesh);
  }

  // Static shading overlay above the ground, below shadows and sprinkles.
  for (const mesh of buildOverlayChunkMeshes(state, buildShadingTexture(state))) {
    layer.addChild(mesh);
  }

  // Ridge-cast shade: ground cells whose upper-right neighbour (-cy) is rock
  // sit in the shadow of that cliff wall (light comes from the east).
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      if (t === TERRAIN_ROCK || t === TERRAIN_WATER) continue;
      if (terrainAt(state, cx, cy - 1, t!) !== TERRAIN_ROCK) continue;
      const shadow = new Sprite(tex.cliffShadow);
      shadow.anchor.set(0.5);
      const { x, y } = cellToScreen(cx, cy);
      shadow.position.set(x, y);
      layer.addChild(shadow);
    }
  }

  // Detail sprinkles: pebbles on dirt/sand, tufts on grass (~1 cell in 12).
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      const roll = hash01(cx * 7 + 3, cy * 11 + 4);
      if (roll > 0.085) continue;
      let texture;
      if (t === TERRAIN_GRASS) texture = tex.tufts[(cx + cy) % tex.tufts.length]!;
      else if (t === TERRAIN_DIRT || t === TERRAIN_SAND) {
        texture = tex.pebbles[(cx + cy) % tex.pebbles.length]!;
      } else continue;
      const sprinkle = new Sprite(texture);
      sprinkle.anchor.set(0.5);
      const { x, y } = cellToScreen(cx, cy);
      sprinkle.position.set(
        x + (hash01(cx, cy * 2) - 0.5) * (TILE_W * 0.4),
        y + (hash01(cx * 2, cy) - 0.5) * (TILE_H * 0.4),
      );
      layer.addChild(sprinkle);
    }
  }

  // Bridge decks and (loaded-save) wrecks over the water they span. Axis
  // follows the neighbouring span cells so a run of cells reads as one bridge.
  const decks = new Map<number, Sprite>();
  const wrecks = new Map<number, Sprite>();
  const spanAt = (nx: number, ny: number): boolean => {
    const t = terrainAt(state, nx, ny, TERRAIN_WATER);
    return t === TERRAIN_BRIDGE || t === TERRAIN_BRIDGE_WRECK;
  };
  const bridgeSpritePos = (cx: number, cy: number): { x: number; y: number } => {
    const { x, y } = cellToScreen(cx, cy);
    return { x: x - TILE_W / 2 - BRIDGE_PAD_X, y: y - TILE_H / 2 - BRIDGE_PAD_Y };
  };
  const deckTexture = (cx: number, cy: number): Texture =>
    spanAt(cx - 1, cy) || spanAt(cx + 1, cy) ? tex.bridgeCx : tex.bridgeCy;
  const addBridgeSprite = (cx: number, cy: number, isDeck: boolean): void => {
    const sprite = new Sprite(isDeck ? deckTexture(cx, cy) : tex.bridgeWreck);
    const p = bridgeSpritePos(cx, cy);
    sprite.position.set(p.x, p.y);
    layer.addChild(sprite);
    (isDeck ? decks : wrecks).set(cellIndex(state, cx, cy), sprite);
  };
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      if (t !== TERRAIN_BRIDGE && t !== TERRAIN_BRIDGE_WRECK) continue;
      addBridgeSprite(cx, cy, t === TERRAIN_BRIDGE);
    }
  }
  const swapBridgeSprite = (cx: number, cy: number, toDeck: boolean): void => {
    const idx = cellIndex(state, cx, cy);
    const old = (toDeck ? wrecks : decks).get(idx);
    if (old) {
      old.destroy();
      (toDeck ? wrecks : decks).delete(idx);
    }
    addBridgeSprite(cx, cy, toDeck);
  };

  return {
    layer,
    collapseBridge: (cx, cy) => swapBridgeSprite(cx, cy, false),
    restoreBridge: (cx, cy) => swapBridgeSprite(cx, cy, true),
  };
}

/**
 * Trees and rock cells live in the entity layer so they occlude/get occluded
 * correctly. Rock cells render as raised cliff plateaus (auto-tiled from
 * their neighbours) with the old boulder sprites scattered on top — that's
 * what makes ridges read as actual elevation.
 */
export function placeDoodads(state: GameState, tex: GameTextures, entityLayer: Container): void {
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      if (t !== TERRAIN_TREE && t !== TERRAIN_ROCK) continue;
      const { x, y } = cellToScreen(cx, cy);
      if (t === TERRAIN_TREE) {
        const sprite = new Sprite(tex.tree);
        sprite.anchor.set(0.5, 0.86);
        sprite.position.set(x, y + 6);
        sprite.zIndex = depthOf(cellCenter(cx), cellCenter(cy)) + SUBCELL / 2;
        entityLayer.addChild(sprite);
        continue;
      }
      // Cliff plateau: open-edge mask from the 4 grid neighbours (map borders
      // count as rock so ridges run cleanly off the edge).
      const rockAt = (nx: number, ny: number): boolean =>
        terrainAt(state, nx, ny, TERRAIN_ROCK) === TERRAIN_ROCK;
      const mask =
        (rockAt(cx + 1, cy) ? 0 : 1) |
        (rockAt(cx, cy + 1) ? 0 : 2) |
        (rockAt(cx - 1, cy) ? 0 : 4) |
        (rockAt(cx, cy - 1) ? 0 : 8);
      const cliff = new Sprite(tex.cliffs[mask]!);
      cliff.position.set(x - TILE_W / 2, y - TILE_H / 2 - CLIFF_H - 2);
      cliff.zIndex = depthOf(cellCenter(cx), cellCenter(cy)) + SUBCELL / 2;
      entityLayer.addChild(cliff);

      // Boulders on the plateau — deterministic variant + slight mirroring.
      const rock = new Sprite(tex.rocks[(cx * 5 + cy * 11) % tex.rocks.length]!);
      rock.anchor.set(0.5, 0.72);
      rock.position.set(x, y + 2 - CLIFF_H);
      if ((cx + cy * 3) % 2 === 1) rock.scale.x = -1;
      rock.zIndex = depthOf(cellCenter(cx), cellCenter(cy)) + SUBCELL / 2 + 1;
      entityLayer.addChild(rock);
    }
  }
}
