import { SUPERWEAPON_STATS, TICKS_PER_SECOND, type GameState } from '@cac/sim';
import { session } from '../session.js';

/**
 * Incoming-superweapon warning (classic C&C tension): while an ENEMY nuke or
 * lightning storm is in the air, a pulsing banner counts down to impact. The
 * strike's target stays hidden — the warning tells you THAT it is coming, not
 * where. Purely client-side; reads state.strikes every frame.
 */
export class SuperweaponAlert {
  private readonly el = document.getElementById('sw-alert')!;
  private readonly label = this.el.querySelector('strong')!;
  private readonly detail = this.el.querySelector('small')!;

  update(state: GameState): void {
    // Soonest hostile strike wins the banner (curtain is defensive — no alarm).
    let soonest: { kind: 'NUKE' | 'STORM'; countdown: number } | null = null;
    for (const strike of state.strikes) {
      if (strike.owner === session.localPlayer) continue;
      if (strike.kind === 'CURTAIN') continue;
      if (soonest === null || strike.countdown < soonest.countdown) {
        soonest = { kind: strike.kind, countdown: strike.countdown };
      }
    }
    if (!soonest) {
      this.el.style.display = 'none';
      return;
    }
    const seconds = Math.max(1, Math.ceil(soonest.countdown / TICKS_PER_SECOND));
    const name = SUPERWEAPON_STATS[soonest.kind].name.toUpperCase();
    const text = `⚠ ${name} IM ANFLUG`;
    if (this.label.textContent !== text) this.label.textContent = text;
    const detail = `Einschlag in ${seconds} s`;
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    this.el.style.display = 'flex';
  }
}
