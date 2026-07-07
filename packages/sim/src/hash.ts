import { serialize, type GameState } from './state.js';

/** FNV-1a over a string, returns uint32. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Order-stable hash of the full game state, e.g. "a03f19c2". */
export function hashState(state: GameState): string {
  return fnv1a(serialize(state)).toString(16).padStart(8, '0');
}
