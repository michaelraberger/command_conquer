import { RESOURCE_GEMS, type GameState } from '@cac/sim';
import { Container, Sprite } from 'pixi.js';
import { cellToScreen } from './iso.js';
import type { GameTextures } from './placeholders.js';

/**
 * Ore overlay sprites on top of the terrain. Synced from the ore grid after
 * sim ticks; sprite alpha reflects how much is left in the cell.
 */
export class OreRenderer {
  readonly layer = new Container();
  private sprites = new Map<number, Sprite>();

  constructor(private tex: GameTextures) {
    this.layer.interactiveChildren = false;
  }

  sync(state: GameState): void {
    for (let idx = 0; idx < state.ore.length; idx++) {
      const amount = state.ore[idx]!;
      const existing = this.sprites.get(idx);
      if (amount <= 0) {
        if (existing) {
          existing.destroy();
          this.sprites.delete(idx);
        }
        continue;
      }
      let sprite = existing;
      if (!sprite) {
        sprite = new Sprite(
          state.resourceKind[idx] === RESOURCE_GEMS ? this.tex.gems : this.tex.ore,
        );
        sprite.anchor.set(0.5);
        const cx = idx % state.mapWidth;
        const cy = (idx - cx) / state.mapWidth;
        const { x, y } = cellToScreen(cx, cy);
        sprite.position.set(x, y);
        this.layer.addChild(sprite);
        this.sprites.set(idx, sprite);
      }
      sprite.alpha = 0.45 + Math.min(0.55, amount / 700);
    }
  }
}
