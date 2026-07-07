import { FOG_EXPLORED, FOG_VISIBLE, cellIndex, type GameState } from '@cac/sim';
import { Container, Sprite } from 'pixi.js';
import { cellToScreen } from './iso.js';
import type { GameTextures } from './placeholders.js';

const ALPHA_HIDDEN = 1;
const ALPHA_EXPLORED = 0.45;

/** Fog-of-war overlay: one black diamond per cell, alpha by fog state. */
export class FogRenderer {
  readonly layer = new Container();
  private sprites: Sprite[] = [];

  constructor(state: GameState, tex: GameTextures) {
    this.layer.interactiveChildren = false;
    for (let cy = 0; cy < state.mapHeight; cy++) {
      for (let cx = 0; cx < state.mapWidth; cx++) {
        const sprite = new Sprite(tex.fogTile);
        sprite.anchor.set(0.5);
        const { x, y } = cellToScreen(cx, cy);
        sprite.position.set(x, y);
        sprite.alpha = ALPHA_HIDDEN;
        this.layer.addChild(sprite);
        this.sprites.push(sprite);
      }
    }
  }

  sync(state: GameState, playerId: number): void {
    const fog = state.fogs[playerId]!;
    for (let i = 0; i < fog.length; i++) {
      const f = fog[i]!;
      this.sprites[i]!.alpha =
        f === FOG_VISIBLE ? 0 : f === FOG_EXPLORED ? ALPHA_EXPLORED : ALPHA_HIDDEN;
    }
  }

  /** True when the local player currently sees this cell. */
  isVisible(state: GameState, playerId: number, cx: number, cy: number): boolean {
    return state.fogs[playerId]![cellIndex(state, cx, cy)] === FOG_VISIBLE;
  }
}
