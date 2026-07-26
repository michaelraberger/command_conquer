import type { GameState } from './state.js';

/** FNV-1a over a string, returns uint32. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Continues FNV-1a over the four bytes of every int32 in a numeric array. */
function fnv1aInts(h: number, arr: ArrayLike<number>): number {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]! | 0;
    h = Math.imul(h ^ (v & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ (v >>> 24), 0x01000193);
  }
  return h;
}

/**
 * Order-stable hash of the full game state, e.g. "a03f19c2".
 *
 * Entities and scalars hash via their (small) JSON; the map grids are walked
 * raw. Same coverage as hashing serialize(), but without building the
 * multi-MB JSON string — the lockstep desync check runs this synchronously in
 * the tick loop every ~10 s, and the string detour cost ~5 ms per call on
 * 144² maps (a visible frame hitch). Hashes are only ever compared between
 * clients of the same build, so the algorithm may change freely.
 */
export function hashState(state: GameState): string {
  const { terrain, ore, resourceKind, occupancy, structures, gateOwner, fogs, ...rest } = state;
  let h = fnv1a(JSON.stringify(rest));
  h = fnv1aInts(h, terrain);
  h = fnv1aInts(h, ore);
  h = fnv1aInts(h, resourceKind);
  h = fnv1aInts(h, occupancy);
  h = fnv1aInts(h, structures);
  h = fnv1aInts(h, gateOwner);
  for (const fog of fogs) h = fnv1aInts(h, fog);
  return (h >>> 0).toString(16).padStart(8, '0');
}
