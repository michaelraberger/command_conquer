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
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minY: number;
  private readonly maxY: number;

  constructor(state: GameState) {
    // Iso map bounding diamond in world-screen coords.
    this.minX = (-state.mapHeight * TILE_W) / 2;
    this.maxX = (state.mapWidth * TILE_W) / 2;
    this.minY = 0;
    this.maxY = ((state.mapWidth + state.mapHeight) * TILE_H) / 2;
    const [sx, sy] = PLAYER_SPAWNS[session.localPlayer] ?? PLAYER_SPAWNS[0]!;
    const spawn = cellToScreen(sx, sy);
    this.x = spawn.x;
    this.y = spawn.y;
  }

  attach(canvas: HTMLCanvasElement): void {
    window.addEventListener('keydown', (e) => {
      if (e.key in PAN_KEYS || e.key.toLowerCase() in PAN_KEYS) {
        this.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointermove', (e) => {
      this.pointer = { x: e.offsetX, y: e.offsetY };
    });
    canvas.addEventListener('pointerleave', () => {
      this.pointer = null;
    });
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

    if (this.pointer) {
      const p = this.pointer;
      if (p.x < EDGE_MARGIN) this.x -= EDGE_SPEED * dtMs;
      if (p.x > viewW - EDGE_MARGIN) this.x += EDGE_SPEED * dtMs;
      if (p.y < EDGE_MARGIN) this.y -= EDGE_SPEED * dtMs;
      if (p.y > viewH - EDGE_MARGIN) this.y += EDGE_SPEED * dtMs;
    }

    this.x = Math.min(this.maxX, Math.max(this.minX, this.x));
    this.y = Math.min(this.maxY, Math.max(this.minY, this.y));
  }

  apply(world: Container, viewW: number, viewH: number): void {
    world.position.set(Math.round(viewW / 2 - this.x), Math.round(viewH / 2 - this.y));
  }
}
