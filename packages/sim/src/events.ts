import type { SuperweaponKind, WeaponFx } from './rules.js';

/** What kind of attacker dealt the damage (drives who bothers to respond). */
export type AggroKind = 'infantry' | 'vehicle' | 'air' | 'naval' | 'building';

/**
 * Transient per-tick events for presentation (tracers, explosions, …).
 * They are cleared at the START of every tick and re-filled by systems, so
 * the client must consume them right after each tick() call. They live on
 * GameState (and thus in the hash) but are themselves deterministic.
 */
export type SimEvent =
  | { type: 'SHOT'; x: number; y: number; tx: number; ty: number; fx: WeaponFx }
  | { type: 'HIT'; x: number; y: number }
  /** Something of `owner` at (x,y) took damage from an attacker of kind
   *  `akind` at (ax,ay) — consumed by defenseReactionSystem to rally idle
   *  defenders that are actually able to fight that attacker. */
  | { type: 'AGGRO'; owner: number; x: number; y: number; ax: number; ay: number; akind: AggroKind }
  | { type: 'DEATH'; x: number; y: number; big: boolean }
  /** A bridge span collapsed: cell (cx,cy) turned into TERRAIN_BRIDGE_WRECK —
   *  the client patches its terrain view and minimap. */
  | { type: 'BRIDGE_DOWN'; cx: number; cy: number }
  /** An engineer rebuilt the span at (cx,cy): wreck → deck again. */
  | { type: 'BRIDGE_UP'; cx: number; cy: number }
  | { type: 'SUPERWEAPON'; x: number; y: number; kind: SuperweaponKind }
  | { type: 'REPAIR'; x: number; y: number }
  | { type: 'PARADROP'; x: number; y: number };
