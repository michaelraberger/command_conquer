import { hashState, type GameState } from '@cac/sim';

const HASH_EVERY_TICKS = 30;

/** Backquote-toggled overlay: tick, live state hash, FPS — desync smell test. */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;
  private lastHashTick = -1;
  private lastHash = '--------';

  constructor() {
    this.el = document.getElementById('debug')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.key === '^') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(state: GameState, fps: number, selectedCount: number): void {
    if (!this.visible) return;
    if (state.tick !== this.lastHashTick && state.tick % HASH_EVERY_TICKS === 0) {
      this.lastHash = hashState(state);
      this.lastHashTick = state.tick;
    }
    const moving = state.units.filter((u) => u.path !== null).length;
    this.el.textContent =
      `Tick     ${state.tick}\n` +
      `Hash     ${this.lastHash} (@${this.lastHashTick})\n` +
      `FPS      ${fps.toFixed(0)}\n` +
      `Einheiten ${state.units.length} (${moving} in Bewegung)\n` +
      `Gebäude  ${state.buildings.length}\n` +
      `Projektile ${state.projectiles.length}\n` +
      `Credits  ${state.players[0]!.credits}\n` +
      `Auswahl  ${selectedCount}`;
  }
}
