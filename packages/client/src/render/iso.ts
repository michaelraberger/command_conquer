import { SUBCELL, cellCenter } from '@cac/sim';
import { heightAtWorld } from './height.js';

/** Classic 2:1 isometric diamond tile, in screen pixels. */
export const TILE_W = 64;
export const TILE_H = 32;
const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

/**
 * Projects fixed-point world coordinates (sub-cells) to world-screen pixels.
 * The terrain height field lifts the whole scene per position (hills, shores,
 * ridge pedestals) — render-only, the sim never sees any of this.
 * Floats are fine here — projection is never fed back into sim.
 */
export function worldToScreen(fx: number, fy: number): { x: number; y: number } {
  const tx = fx / SUBCELL;
  const ty = fy / SUBCELL;
  return { x: (tx - ty) * HALF_W, y: (tx + ty) * HALF_H - heightAtWorld(fx, fy) };
}

export function cellToScreen(cx: number, cy: number): { x: number; y: number } {
  return worldToScreen(cellCenter(cx), cellCenter(cy));
}

/**
 * Inverse projection: world-screen pixels back to fixed-point world coords.
 * With elevation the inverse has no closed form; a few fixed-point iterations
 * converge fast because slopes are gentle (relaxed lattice).
 */
export function screenToWorld(sx: number, sy: number): { fx: number; fy: number } {
  let fx = 0;
  let fy = 0;
  let lift = 0;
  for (let i = 0; i < 3; i++) {
    const tx = (sx / HALF_W + (sy + lift) / HALF_H) / 2;
    const ty = ((sy + lift) / HALF_H - sx / HALF_W) / 2;
    fx = tx * SUBCELL;
    fy = ty * SUBCELL;
    lift = heightAtWorld(fx, fy);
  }
  return { fx, fy };
}

export function screenToCell(sx: number, sy: number): { cx: number; cy: number } {
  const { fx, fy } = screenToWorld(sx, sy);
  return { cx: Math.floor(fx / SUBCELL), cy: Math.floor(fy / SUBCELL) };
}

/** Iso depth used for z-sorting sprites (higher = drawn in front). */
export function depthOf(fx: number, fy: number): number {
  return fx + fy;
}
