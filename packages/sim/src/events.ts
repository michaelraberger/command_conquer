import type { SuperweaponKind, WeaponFx } from './rules.js';

/**
 * Transient per-tick events for presentation (tracers, explosions, …).
 * They are cleared at the START of every tick and re-filled by systems, so
 * the client must consume them right after each tick() call. They live on
 * GameState (and thus in the hash) but are themselves deterministic.
 */
export type SimEvent =
  | { type: 'SHOT'; x: number; y: number; tx: number; ty: number; fx: WeaponFx }
  | { type: 'HIT'; x: number; y: number }
  | { type: 'DEATH'; x: number; y: number; big: boolean }
  | { type: 'SUPERWEAPON'; x: number; y: number; kind: SuperweaponKind }
  | { type: 'REPAIR'; x: number; y: number };
