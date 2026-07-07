import { toCell, type GameState } from '@cac/sim';
import { session } from '../session.js';

/** How long (sim ticks) the warning stays up after the last hit — ~3 s. */
const ALERT_WINDOW = 45;

/**
 * "Under attack" detection, purely client-side: watches the HP of the local
 * player's own units and buildings and flags a drop. No sim change needed —
 * damage is visible as HP going down. A hit on a building outranks a hit on a
 * unit ("Basis wird angegriffen" is the more urgent message).
 */
export class Alerts {
  private lastHp = new Map<number, number>();
  private lastTick = -ALERT_WINDOW * 2;
  private kind: 'unit' | 'building' = 'unit';
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
        if (this.lastTick !== state.tick || this.kind !== 'building') {
          this.trigger(state.tick, 'unit', toCell(u.x), toCell(u.y));
        }
      }
      this.lastHp.set(u.id, u.hp);
    }

    // Forget entities that no longer exist so ids can't collide later.
    for (const id of this.lastHp.keys()) {
      if (!seen.has(id)) this.lastHp.delete(id);
    }
  }

  private trigger(tick: number, kind: 'unit' | 'building', cx: number, cy: number): void {
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
      : '⚠ EINHEITEN WERDEN ANGEGRIFFEN';
  }

  /** Minimap ping location while an alert is active, else null. */
  ping(tick: number): { cx: number; cy: number } | null {
    return this.active(tick) ? { cx: this.cx, cy: this.cy } : null;
  }
}
