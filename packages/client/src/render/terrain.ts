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
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
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

/** Grey multiply tint from a 0..1 brightness factor. */
function greyTint(f: number): number {
  const v = Math.max(0, Math.min(255, Math.round(255 * f)));
  return (v << 16) | (v << 8) | v;
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

/** Screen position of grid CORNER (cx,cy), lifted by the height field. */
function cornerScreen(cx: number, cy: number): { x: number; y: number } {
  return {
    x: (cx - cy) * (TILE_W / 2),
    y: (cx + cy) * (TILE_H / 2) - heightAtWorld(cx * SUBCELL, cy * SUBCELL),
  };
}

/**
 * One ground cell as a 4-triangle mesh whose corners sit on the height
 * lattice — adjacent cells share corners, so sloped terrain stays seamless
 * (plain shifted sprites would tear gaps open on every slope).
 */
function groundMesh(texture: Texture, cx: number, cy: number): MeshSimple {
  const top = cornerScreen(cx, cy);
  const right = cornerScreen(cx + 1, cy);
  const bottom = cornerScreen(cx + 1, cy + 1);
  const left = cornerScreen(cx, cy + 1);
  const centre = {
    x: (top.x + bottom.x) / 2,
    y:
      (cx + cy + 1) * (TILE_H / 2) -
      heightAtWorld((cx + 0.5) * SUBCELL, (cy + 0.5) * SUBCELL),
  };
  const vertices = new Float32Array([
    top.x, top.y,
    right.x, right.y,
    bottom.x, bottom.y,
    left.x, left.y,
    centre.x, centre.y,
  ]);
  // The diamond's corners in the rectangular tile texture.
  const uvs = new Float32Array([0.5, 0, 1, 0.5, 0.5, 1, 0, 0.5, 0.5, 0.5]);
  const indices = new Uint32Array([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
  return new MeshSimple({ texture, vertices, uvs, indices });
}

/** The terrain layer plus the hook the loop uses when a bridge span falls. */
export interface TerrainView {
  layer: Container;
  /** Swap the deck sprite at (cx,cy) for collapsed-bridge debris. */
  collapseBridge(cx: number, cy: number): void;
}

/** Water in every form — used for shore shading around bridge cells too. */
function isWaterKind(t: number): boolean {
  return t === TERRAIN_WATER || t === TERRAIN_BRIDGE || t === TERRAIN_BRIDGE_WRECK;
}

/**
 * Builds the static ground layer: one diamond sprite per map cell, tinted by
 * large-scale brightness noise plus edge shading (cells hugging cliffs and
 * woods darken, open water darkens away from the shore), then ridge-cast
 * shadow bands and tiny detail sprinkles on top. All flavour derives from the
 * cell coordinates — deterministic and purely presentational. Bridge cells
 * render as water with a raised deck sprite on top; `collapseBridge` swaps a
 * deck for wreck debris when the sim reports a span collapse.
 */
export function buildTerrainLayer(state: GameState, tex: GameTextures): TerrainView {
  const layer = new Container();
  layer.interactiveChildren = false;
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      const variant = Math.floor(hash01(cx * 3 + 1, cy * 5 + 2) * 5) % 5;
      const texture = isWaterKind(t!)
        ? tex.water
        : t === TERRAIN_ICE
          ? tex.ice
          : t === TERRAIN_GRASS
            ? tex.grass[variant % tex.grass.length]!
            : t === TERRAIN_SAND
              ? tex.sand[variant % tex.sand.length]!
              : tex.dirt[variant % tex.dirt.length]!;
      const mesh = groundMesh(texture, cx, cy);

      // Brightness: soft macro patches + ambient occlusion at hard edges +
      // slope lighting from the height field (east faces lit, west in shade).
      if (isWaterKind(t!)) {
        let open = 0;
        for (const [dx, dy] of N8) {
          if (isWaterKind(terrainAt(state, cx + dx, cy + dy, TERRAIN_WATER))) open++;
        }
        // Deep water (fully surrounded) darker, shoreline stays bright.
        mesh.tint = greyTint(1 - open * 0.022);
      } else if (t !== TERRAIN_ICE) {
        let occl = 0;
        for (const [dx, dy] of N8) {
          const n = terrainAt(state, cx + dx, cy + dy, t!);
          if (n === TERRAIN_ROCK || n === TERRAIN_TREE) occl++;
        }
        const ao = 1 - Math.min(0.16, occl * 0.045);
        const macro = 0.88 + 0.12 * macroNoise(cx, cy);
        // Tints only darken, so the baseline sits below 1 — lit east slopes
        // then genuinely read brighter than level ground.
        mesh.tint = greyTint(Math.max(0.68, Math.min(1, macro * ao * slopeShade(cx, cy) * 0.94)));
      }
      layer.addChild(mesh);
    }
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
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      if (t !== TERRAIN_BRIDGE && t !== TERRAIN_BRIDGE_WRECK) continue;
      const sprite = new Sprite(t === TERRAIN_BRIDGE ? deckTexture(cx, cy) : tex.bridgeWreck);
      const p = bridgeSpritePos(cx, cy);
      sprite.position.set(p.x, p.y);
      layer.addChild(sprite);
      if (t === TERRAIN_BRIDGE) decks.set(cellIndex(state, cx, cy), sprite);
    }
  }

  return {
    layer,
    collapseBridge(cx: number, cy: number): void {
      const idx = cellIndex(state, cx, cy);
      const deck = decks.get(idx);
      if (deck) {
        deck.destroy();
        decks.delete(idx);
      }
      const wreck = new Sprite(tex.bridgeWreck);
      const p = bridgeSpritePos(cx, cy);
      wreck.position.set(p.x, p.y);
      layer.addChild(wreck);
    },
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
