import { SUBCELL, toCell, type GameState } from '@cac/sim';
import { session } from '../session.js';

/** How long (sim ticks) the warning stays up after the last hit — ~3 s. */
const ALERT_WINDOW = 45;

/** A missing unit counts as KILLED only when a DEATH event fired within this
 *  fixed-point distance of its last known position (same tick). Filters out
 *  the harmless disappearances: boarding a transport, an engineer consumed on
 *  capture/bridge repair, a paradrop plane despawning at the map edge. */
const DEATH_MATCH_DIST = SUBCELL + SUBCELL / 2;

/**
 * "Under attack" / "unit lost" detection, purely client-side: watches the HP
 * of the local player's own units and buildings and flags a drop; a unit that
 * vanishes next to a DEATH event of the same tick reports as lost. No sim
 * change needed. Precedence within one tick: a building hit ("Basis wird
 * angegriffen") outranks a lost unit, which outranks a mere unit hit.
 */
export class Alerts {
  private lastHp = new Map<number, number>();
  /** Last known position of own units (fixed-point), for the lost-unit ping. */
  private lastUnitPos = new Map<number, { x: number; y: number }>();
  private lastTick = -ALERT_WINDOW * 2;
  private kind: 'unit' | 'building' | 'lost' = 'unit';
  private cx = 0;
  private cy = 0;

  /** Call once per executed sim tick. */
  update(state: GameState): void {
    const local = session.localPlayer;
    const seen = new Set<number>();

    for (const b of state.buildings) {
      if (b.owner !== local) continue;
      seen.add(b.id);
      const prev = this.lastHp.get(b.id);
      if (prev !== undefined && b.hp < prev) {
        this.trigger(state.tick, 'building', b.cx, b.cy);
      }
      this.lastHp.set(b.id, b.hp);
    }
    for (const u of state.units) {
      if (u.owner !== local) continue;
      seen.add(u.id);
      const prev = this.lastHp.get(u.id);
      if (prev !== undefined && u.hp < prev) {
        // Don't let a unit hit override a building hit reported this same tick.
        if (this.lastTick !== state.tick || this.kind === 'unit') {
          this.trigger(state.tick, 'unit', toCell(u.x), toCell(u.y));
        }
      }
      this.lastHp.set(u.id, u.hp);
      this.lastUnitPos.set(u.id, { x: u.x, y: u.y });
    }

    // Own units that vanished at a DEATH event this tick were destroyed.
    for (const [id, pos] of this.lastUnitPos) {
      if (seen.has(id)) continue;
      const died = state.events.some(
        (e) =>
          e.type === 'DEATH' &&
          Math.abs(e.x - pos.x) <= DEATH_MATCH_DIST &&
          Math.abs(e.y - pos.y) <= DEATH_MATCH_DIST,
      );
      if (died && (this.lastTick !== state.tick || this.kind !== 'building')) {
        this.trigger(state.tick, 'lost', toCell(pos.x), toCell(pos.y));
      }
      this.lastUnitPos.delete(id);
    }

    // Forget entities that no longer exist so ids can't collide later.
    for (const id of this.lastHp.keys()) {
      if (!seen.has(id)) this.lastHp.delete(id);
    }
  }

  private trigger(tick: number, kind: 'unit' | 'building' | 'lost', cx: number, cy: number): void {
    this.lastTick = tick;
    this.kind = kind;
    this.cx = cx;
    this.cy = cy;
  }

  active(tick: number): boolean {
    return tick - this.lastTick < ALERT_WINDOW;
  }

  message(): string {
    return this.kind === 'building'
      ? '⚠ BASIS WIRD ANGEGRIFFEN'
      : this.kind === 'lost'
        ? '⚠ EINHEIT VERLOREN'
        : '⚠ EINHEITEN WERDEN ANGEGRIFFEN';
  }

  /** Minimap ping location while an alert is active, else null. */
  ping(tick: number): { cx: number; cy: number } | null {
    return this.active(tick) ? { cx: this.cx, cy: this.cy } : null;
  }
}
