import { FOG_EXPLORED, FOG_VISIBLE, cellIndex, type GameState } from '@cac/sim';
import { Container, Texture } from 'pixi.js';
import { buildOverlayChunkMeshes } from './terrain.js';

const ALPHA_HIDDEN = 255;
const ALPHA_EXPLORED = 115; // ≈ 0.45
/** Fog colour (near-black with a cold blue cast, like the old fog tiles). */
const FOG_R = 6;
const FOG_G = 8;
const FOG_B = 10;

/**
 * Fog-of-war overlay: a canvas with one pixel per cell (alpha by fog state),
 * stretched over the terrain relief by chunk meshes on the same height
 * lattice as the ground. Bilinear sampling gives soft fog borders for free,
 * and the whole map costs a handful of draw calls instead of one sprite per
 * cell. The canvas re-uploads on the loop's slow-sync cadence.
 */
export class FogRenderer {
  readonly layer = new Container();
  /** The 1-px-per-cell fog canvas — the minimap composites it directly. */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly texture: Texture;

  constructor(state: GameState) {
    this.layer.interactiveChildren = false;
    this.canvas = document.createElement('canvas');
    this.canvas.width = state.mapWidth;
    this.canvas.height = state.mapHeight;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(state.mapWidth, state.mapHeight);
    // Everything starts hidden.
    for (let i = 0; i < this.img.data.length; i += 4) {
      this.img.data[i] = FOG_R;
      this.img.data[i + 1] = FOG_G;
      this.img.data[i + 2] = FOG_B;
      this.img.data[i + 3] = ALPHA_HIDDEN;
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.texture = Texture.from(this.canvas);
    for (const mesh of buildOverlayChunkMeshes(state, this.texture)) {
      this.layer.addChild(mesh);
    }
  }

  sync(state: GameState, playerId: number): void {
    const fog = state.fogs[playerId]!;
    const data = this.img.data;
    for (let i = 0; i < fog.length; i++) {
      const f = fog[i]!;
      data[i * 4 + 3] = f === FOG_VISIBLE ? 0 : f === FOG_EXPLORED ? ALPHA_EXPLORED : ALPHA_HIDDEN;
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }

  /** True when the local player currently sees this cell. */
  isVisible(state: GameState, playerId: number, cx: number, cy: number): boolean {
    return state.fogs[playerId]![cellIndex(state, cx, cy)] === FOG_VISIBLE;
  }
}
