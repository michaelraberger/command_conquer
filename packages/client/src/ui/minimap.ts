import { FOG_EXPLORED, FOG_HIDDEN, type GameState } from '@cac/sim';
import { cellToScreen } from '../render/iso.js';
import { colorCss, resourceCss, terrainRgb } from '../render/palette.js';
import { session } from '../session.js';
import type { Camera } from '../input/camera.js';

/**
 * Top-down minimap on a plain 2D canvas: terrain baked once, ore/buildings/
 * units repainted on sync, fog burned in last. Clicking centers the camera.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;

  constructor(
    private state: GameState,
    camera: Camera,
  ) {
    this.canvas = document.getElementById('minimap') as HTMLCanvasElement;
    this.canvas.width = state.mapWidth;
    this.canvas.height = state.mapHeight;
    this.ctx = this.canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = state.mapWidth;
    this.base.height = state.mapHeight;
    this.bakeTerrain();

    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const cx = Math.floor(((e.clientX - rect.left) / rect.width) * state.mapWidth);
      const cy = Math.floor(((e.clientY - rect.top) / rect.height) * state.mapHeight);
      const { x, y } = cellToScreen(cx, cy);
      camera.x = x;
      camera.y = y;
    });
  }

  private bakeTerrain(): void {
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(this.state.mapWidth, this.state.mapHeight);
    for (let i = 0; i < this.state.terrain.length; i++) {
      const [r, g, b] = terrainRgb(this.state.terrain[i]!);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  sync(ping?: { cx: number; cy: number } | null): void {
    const { ctx, state } = this;
    const w = state.mapWidth;
    ctx.drawImage(this.base, 0, 0);

    for (let i = 0; i < state.ore.length; i++) {
      if (state.ore[i]! === 0) continue;
      ctx.fillStyle = resourceCss(state.resourceKind[i]!);
      ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
    }
    // Team colors follow the faction (Allies blue, Soviets red); neutral
    // structures (Erz-Bohrturm, owner -1) show as gray.
    for (const b of state.buildings) {
      const owner = state.players[b.owner];
      ctx.fillStyle = owner ? colorCss(owner.color) : '#9aa0a6';
      ctx.fillRect(b.cx, b.cy, 2, 2);
    }
    for (const u of state.units) {
      ctx.fillStyle = colorCss(lighten(state.players[u.owner]!.color));
      const cx = u.cell % w;
      ctx.fillRect(cx, Math.floor((u.cell - cx) / w), 1, 1);
    }

    // Fog on top.
    const fog = state.fogs[session.localPlayer]!;
    for (let i = 0; i < fog.length; i++) {
      const f = fog[i]!;
      if (f === FOG_HIDDEN) {
        ctx.fillStyle = 'rgba(4,6,8,1)';
      } else if (f === FOG_EXPLORED) {
        ctx.fillStyle = 'rgba(4,6,8,0.45)';
      } else {
        continue;
      }
      ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
    }

    // Attack ping: a red ring at the spot where own units/buildings are hit.
    if (ping) {
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 1;
      for (const r of [2, 4]) {
        ctx.beginPath();
        ctx.arc(ping.cx + 0.5, ping.cy + 0.5, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

/** Lightens a color toward white so unit dots read brighter than buildings. */
function lighten(color: number): number {
  const mix = (c: number): number => Math.round(c + (255 - c) * 0.4);
  return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}
