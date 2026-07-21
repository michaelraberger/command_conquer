import type { GameState } from '@cac/sim';
import { buildStatsTable } from './statsTable.js';

/** Re-render cadence while the overlay is open (read-only, cheap). */
const REFRESH_MS = 500;

/**
 * In-game statistics overlay on the Tab key: read-only view of the live
 * Player.stats, same table as the end screen. Tab toggles, Escape closes;
 * text fields (chat, cheat console, save dialog) keep their Tab key.
 */
export class StatsOverlay {
  private readonly root = document.getElementById('stats-overlay')!;
  private readonly host = document.getElementById('stats-overlay-table')!;
  private timer: number | null = null;
  private renderedTick = -1;

  constructor(
    private state: GameState,
    private readonly localPlayer: number,
  ) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.repeat) return;
        e.preventDefault(); // keep focus where it is — Tab is ours in-game
        this.toggle();
      } else if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  /** Save/load swaps the state object — follow it (matches minimap et al.). */
  setState(state: GameState): void {
    this.state = state;
    this.renderedTick = -1;
  }

  isOpen(): boolean {
    return this.root.style.display === 'flex';
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    this.root.style.display = 'flex';
    this.renderedTick = -1;
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
  }

  close(): void {
    this.root.style.display = 'none';
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private render(): void {
    if (this.state.tick === this.renderedTick) return; // paused: nothing new
    this.renderedTick = this.state.tick;
    // Keep expanded per-type breakdowns expanded across the periodic refresh.
    const open = [...this.host.querySelectorAll('details')].map((d) => d.open);
    this.host.replaceChildren(buildStatsTable(this.state, this.localPlayer));
    this.host.querySelectorAll('details').forEach((d, i) => (d.open = open[i] ?? false));
  }
}
