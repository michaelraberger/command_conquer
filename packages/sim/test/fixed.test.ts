import { describe, expect, it } from 'vitest';
import { cellCenter, facingFromDelta, isqrt, toCell } from '../src/fixed.js';

describe('isqrt', () => {
  it('matches floor(sqrt(n)) definition for a dense range', () => {
    for (let n = 0; n <= 20000; n++) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
  });

  it('handles large values (map-diagonal scale and beyond)', () => {
    for (const n of [65535, 65536, 2 ** 26, 2 ** 30, 2 ** 31 - 1, 2 ** 40]) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
  });
});

describe('facingFromDelta', () => {
  it('maps cardinal and diagonal deltas to the expected 16-facing index', () => {
    expect(facingFromDelta(256, 0)).toBe(0);
    expect(facingFromDelta(181, 181)).toBe(2);
    expect(facingFromDelta(0, 256)).toBe(4);
    expect(facingFromDelta(-256, 0)).toBe(8);
    expect(facingFromDelta(0, -256)).toBe(12);
    expect(facingFromDelta(1000, -1000)).toBe(14);
  });
});

describe('cell conversions', () => {
  it('round-trips cell centers', () => {
    for (const c of [0, 1, 17, 63, 127]) {
      expect(toCell(cellCenter(c))).toBe(c);
    }
  });
});
