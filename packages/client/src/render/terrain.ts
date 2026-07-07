import {
  SUBCELL,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  TERRAIN_TREE,
  TERRAIN_WATER,
  cellCenter,
  cellIndex,
  type GameState,
} from '@cac/sim';
import { Container, Sprite } from 'pixi.js';
import { cellToScreen, depthOf } from './iso.js';
import type { GameTextures } from './placeholders.js';

/**
 * Builds the static ground layer: one diamond sprite per map cell. Trees and
 * rocks get plain dirt here — their 3D sprites live in the entity layer.
 */
export function buildTerrainLayer(state: GameState, tex: GameTextures): Container {
  const layer = new Container();
  layer.interactiveChildren = false;
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      const variant = (cx * 7 + cy * 13) % 2;
      const texture =
        t === TERRAIN_WATER
          ? tex.water
          : t === TERRAIN_GRASS
            ? tex.grass[variant]!
            : tex.dirt[variant]!;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      const { x, y } = cellToScreen(cx, cy);
      sprite.position.set(x, y);
      layer.addChild(sprite);
    }
  }
  return layer;
}

/**
 * Trees and rock outcrops live in the entity layer so they occlude/get
 * occluded correctly — that's what makes them read as 3D.
 */
export function placeDoodads(state: GameState, tex: GameTextures, entityLayer: Container): void {
  for (let cy = 0; cy < state.mapHeight; cy++) {
    for (let cx = 0; cx < state.mapWidth; cx++) {
      const t = state.terrain[cellIndex(state, cx, cy)];
      if (t !== TERRAIN_TREE && t !== TERRAIN_ROCK) continue;
      const { x, y } = cellToScreen(cx, cy);
      let sprite: Sprite;
      if (t === TERRAIN_TREE) {
        sprite = new Sprite(tex.tree);
        sprite.anchor.set(0.5, 0.86);
        sprite.position.set(x, y + 6);
      } else {
        // Deterministic variant + slight mirroring keeps ridges organic.
        sprite = new Sprite(tex.rocks[(cx * 5 + cy * 11) % tex.rocks.length]!);
        sprite.anchor.set(0.5, 0.72);
        sprite.position.set(x, y + 2);
        if ((cx + cy * 3) % 2 === 1) sprite.scale.x = -1;
      }
      sprite.zIndex = depthOf(cellCenter(cx), cellCenter(cy)) + SUBCELL / 2;
      entityLayer.addChild(sprite);
    }
  }
}
