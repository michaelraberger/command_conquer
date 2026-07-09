import { FACING_COUNT, type Unit } from '@cac/sim';
import { Assets, type Spritesheet } from 'pixi.js';
import type { GameTextures, UnitSprite } from './placeholders.js';

/**
 * Optional real-sprite override layer.
 *
 * `createTextures()` always bakes procedural placeholder art for every unit.
 * After boot, {@link loadUnitSprites} swaps in pre-rendered sprite atlases for
 * the handful of units that have real art, leaving every other unit on the
 * procedural fallback. The renderer never notices: `spriteFor()` keeps reading
 * `tex.<key>[facing]` and gets whatever we put there.
 *
 * Atlas contract (one Pixi JSON-hash spritesheet per unit, 2× resolution so the
 * on-screen size matches the procedural art baked at `resolution: 2`):
 *   body_00 … body_(N-1)   neutral chassis, contact shadow baked in
 *   team_00 … team_(N-1)   pure-white faction mask on transparency
 * where N = FACING_COUNT. Frame index i is drawn for `unit.facing === i`.
 */
export interface UnitSpriteSource {
  /** Atlas JSON path relative to the Vite base URL, e.g. `units/tank/tank.json`. */
  atlas: string;
  /**
   * Emergency index rotation if the render azimuth is offset by k steps from
   * the facing index. Prefer fixing the orientation in the render script; this
   * is only a fallback. Default 0.
   */
  facingOffset?: number;
}

/** Units that ship real sprite atlases; everything else stays procedural. */
export const SPRITE_UNIT_SOURCES: Partial<Record<Unit['type'], UnitSpriteSource>> = {
  TANK: { atlas: 'units/tank/tank.json' },
  SNIPER: { atlas: 'units/sniper/sniper.json' },
};

/** Keys of GameTextures whose value is a per-facing UnitSprite array. */
type UnitTexKey = {
  [K in keyof GameTextures]: GameTextures[K] extends UnitSprite[] ? K : never;
}[keyof GameTextures];

/** Maps a unit type to its GameTextures array key (same wiring as spriteFor). */
const TEX_KEY: Record<Unit['type'], UnitTexKey> = {
  TANK: 'tank',
  MAMMOTH: 'mammoth',
  ARTILLERY: 'artillery',
  V3: 'v3',
  HARVESTER: 'harvester',
  REPAIR: 'repair',
  RIFLEMAN: 'rifleman',
  ROCKETEER: 'rocketeer',
  SNIPER: 'sniper',
  SPION: 'spion',
  MCV: 'mcv',
  SCOUT: 'scout',
  LIGHTTANK: 'lighttank',
  FLAMER: 'flamer',
  DOG: 'dog',
  TESLATANK: 'teslatank',
  FLAK: 'flak',
  HELI: 'heli',
  JET: 'jet',
  STRIKEJET: 'strikejet',
  AIRLIFT: 'airlift',
  GUNBOAT: 'gunboat',
  DESTROYER: 'destroyer',
  SUB: 'sub',
  TRANSPORT: 'transport',
};

function frameName(prefix: 'body' | 'team', index: number): string {
  return `${prefix}_${String(index).padStart(2, '0')}`;
}

/**
 * Replaces procedural textures with real sprite atlases in-place, for every
 * unit in {@link SPRITE_UNIT_SOURCES} whose atlas loads successfully. A missing
 * or broken atlas is logged and skipped — that unit keeps its procedural art
 * and boot never fails. Call once after `createTextures`, before the first
 * render, so there's no placeholder-to-sprite flash.
 */
export async function loadUnitSprites(tex: GameTextures): Promise<void> {
  const store = tex as Record<UnitTexKey, UnitSprite[]>;
  const entries = Object.entries(SPRITE_UNIT_SOURCES) as [Unit['type'], UnitSpriteSource][];
  for (const [type, src] of entries) {
    try {
      const url = import.meta.env.BASE_URL + src.atlas;
      const sheet = await Assets.load<Spritesheet>(url);
      const offset = src.facingOffset ?? 0;
      const facings: UnitSprite[] = [];
      for (let f = 0; f < FACING_COUNT; f++) {
        const idx = (((f + offset) % FACING_COUNT) + FACING_COUNT) % FACING_COUNT;
        const body = sheet.textures[frameName('body', idx)];
        const team = sheet.textures[frameName('team', idx)];
        if (!body || !team) {
          throw new Error(`atlas ${src.atlas} missing frame ${frameName('body', idx)}/${frameName('team', idx)}`);
        }
        facings.push({ body, team });
      }
      store[TEX_KEY[type]] = facings;
    } catch (err) {
      console.warn(`Sprite-Atlas für ${type} nicht geladen — prozedurale Kunst bleibt aktiv.`, err);
    }
  }
}
