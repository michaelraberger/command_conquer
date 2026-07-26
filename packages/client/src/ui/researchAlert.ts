import { techRule, type GameState, type TechId } from '@cac/sim';

/** How long the banner stays up (ticks; 60 ≈ 4 s at 15 tps). */
const ALERT_WINDOW = 60;

/**
 * Green success banner when the LOCAL player's research completes — the
 * positive twin of the attack warning. Pure state watcher (like Alerts and
 * SuperweaponAlert): diffs player.researched per tick, no sim events, so the
 * hash/NET_VERSION surface stays untouched.
 */
export class ResearchAlert {
  private readonly banner = document.getElementById('research-done')!;
  private known: ReadonlySet<string> | null = null;
  private lastTick = -10000;
  private techName = '';

  constructor(private readonly localPlayer: number) {}

  /** Call once per TICK (researched only ever grows, sorted). */
  update(state: GameState): void {
    const player = state.players[this.localPlayer];
    if (!player) return;
    if (this.known === null) {
      // First sight (game start or loaded save): everything already known.
      this.known = new Set(player.researched);
      return;
    }
    for (const tech of player.researched) {
      if (this.known.has(tech)) continue;
      (this.known as Set<string>).add(tech);
      this.techName = techRule(tech as TechId).name;
      this.lastTick = state.tick;
    }
  }

  /** Call once per FRAME to toggle the banner. */
  render(tick: number): void {
    const active = tick - this.lastTick < ALERT_WINDOW;
    if (active) {
      this.banner.firstElementChild!.textContent = `FORSCHUNG ABGESCHLOSSEN: ${this.techName.toUpperCase()}`;
    }
    this.banner.style.display = active ? 'flex' : 'none';
  }
}
