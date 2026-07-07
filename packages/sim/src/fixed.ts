/** Fixed-point world units per map cell. All sim positions are integers. */
export const SUBCELL = 256;

/** Fixed-point world coordinate of the center of cell coordinate `c`. */
export function cellCenter(c: number): number {
  return c * SUBCELL + SUBCELL / 2;
}

/** Cell coordinate containing fixed-point world coordinate `f` (f >= 0). */
export function toCell(f: number): number {
  return f >> 8;
}

/** Integer square root: largest n with n*n <= v. */
export function isqrt(v: number): number {
  if (v < 0) throw new Error(`isqrt of negative: ${v}`);
  if (v < 2) return v;
  let x = v;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(v / x)) / 2);
  }
  return x;
}

export function distSq(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}

/**
 * 16 discrete unit facings (index k = k * 22.5°), as integer direction
 * vectors scaled by 256. Facing 0 points toward +x, facing 4 toward +y.
 * Precomputed so the sim never calls Math.sin/cos.
 */
export const FACING_COUNT = 16;
export const FACING_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [256, 0],
  [237, 98],
  [181, 181],
  [98, 237],
  [0, 256],
  [-98, 237],
  [-181, 181],
  [-237, 98],
  [-256, 0],
  [-237, -98],
  [-181, -181],
  [-98, -237],
  [0, -256],
  [98, -237],
  [181, -181],
  [237, -98],
];

/** Closest of the 16 facings for a movement delta (integer dot products). */
export function facingFromDelta(dx: number, dy: number): number {
  let best = 0;
  let bestDot = dx * FACING_VECTORS[0]![0] + dy * FACING_VECTORS[0]![1];
  for (let k = 1; k < FACING_COUNT; k++) {
    const v = FACING_VECTORS[k]!;
    const dot = dx * v[0] + dy * v[1];
    if (dot > bestDot) {
      best = k;
      bestDot = dot;
    }
  }
  return best;
}
