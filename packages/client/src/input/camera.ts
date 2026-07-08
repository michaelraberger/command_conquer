import { PLAYER_SPAWNS, type GameState } from '@cac/sim';
import type { Container } from 'pixi.js';
import { cellToScreen, TILE_H, TILE_W } from '../render/iso.js';
import { session } from '../session.js';

const KEY_SPEED = 0.9; // px per ms
const EDGE_MARGIN = 24; // px from canvas border that triggers edge scrolling
const EDGE_SPEED = 0.9;

const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
};

/** Screen-space camera: (x, y) is the world-screen point at viewport center. */
export class Camera {
  x = 0;
  y = 0;
  private keys = new Set<string>();
  private pointer: { x: number; y: number } | null = null;
  /** Space held → grab-to-pan mode (suppresses selection in Controls). */
  private spaceDown = false;
  /** Active grab-drag: last pointer position for delta panning. */
  private dragLast: { x: number; y: number } | null = null;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minY: number;
  private readonly maxY: number;

  /** True while the player holds space to pan with the mouse. */
  get spaceHeld(): boolean {
    return this.spaceDown;
  }

  constructor(state: GameState) {
    // Iso map bounding diamond in world-screen coords.
    this.minX = (-state.mapHeight * TILE_W) / 2;
    this.maxX = (state.mapWidth * TILE_W) / 2;
    this.minY = 0;
    this.maxY = ((state.mapWidth + state.mapHeight) * TILE_H) / 2;
    const [sx, sy] = state.spawns[session.localPlayer] ?? PLAYER_SPAWNS[0]!;
    const spawn = cellToScreen(sx, sy);
    this.x = spawn.x;
    this.y = spawn.y;
  }

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing, not panning
      if (e.code === 'Space') {
        this.spaceDown = true;
        if (!this.dragLast) canvas.style.cursor = 'grab';
        e.preventDefault(); // stop the page from scrolling on space
        return;
      }
      if (e.key in PAN_KEYS || e.key.toLowerCase() in PAN_KEYS) {
        this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.endGrab(canvas, true);
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.endGrab(canvas, true);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.spaceDown) return; // normal clicks belong to Controls
      this.dragLast = { x: e.clientX, y: e.clientY };
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.offsetX, y: e.offsetY };
      if (!this.dragLast) return;
      // Grab-pan: drag the world under the cursor (move camera opposite).
      this.x -= e.clientX - this.dragLast.x;
      this.y -= e.clientY - this.dragLast.y;
      this.dragLast = { x: e.clientX, y: e.clientY };
      this.clamp();
    });
    window.addEventListener('pointerup', () => {
      if (this.dragLast) {
        this.dragLast = null;
        canvas.style.cursor = this.spaceDown ? 'grab' : '';
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
  }

  /** Ends grab-pan; `dropSpace` also releases the space-held state. */
  private endGrab(canvas: HTMLCanvasElement, dropSpace: boolean): void {
    if (dropSpace) this.spaceDown = false;
    this.dragLast = null;
    canvas.style.cursor = this.spaceDown ? 'grab' : '';
  }

  private clamp(): void {
    this.x = Math.min(this.maxX, Math.max(this.minX, this.x));
    this.y = Math.min(this.maxY, Math.max(this.minY, this.y));
  }

  update(dtMs: number, viewW: number, viewH: number): void {
    let dx = 0;
    let dy = 0;
    for (const key of this.keys) {
      const dir = PAN_KEYS[key];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    this.x += dx * KEY_SPEED * dtMs;
    this.y += dy * KEY_SPEED * dtMs;

    // Edge scrolling — but not while grab-panning (the drag already moves us).
    if (this.pointer && !this.dragLast) {
      const p = this.pointer;
      if (p.x < EDGE_MARGIN) this.x -= EDGE_SPEED * dtMs;
      if (p.x > viewW - EDGE_MARGIN) this.x += EDGE_SPEED * dtMs;
      if (p.y < EDGE_MARGIN) this.y -= EDGE_SPEED * dtMs;
      if (p.y > viewH - EDGE_MARGIN) this.y += EDGE_SPEED * dtMs;
    }

    this.clamp();
  }

  apply(world: Container, viewW: number, viewH: number): void {
    world.position.set(Math.round(viewW / 2 - this.x), Math.round(viewH / 2 - this.y));
  }
}
