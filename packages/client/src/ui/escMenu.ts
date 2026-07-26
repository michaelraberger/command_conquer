/** What the Esc menu needs from the running game — wired after construction
 *  (the menu's keydown listener must register BEFORE PlacementMode's, see
 *  main.ts construction order). */
export interface EscMenuWiring {
  /** Placement/strike/repair mode active — Esc belongs to it, not to us. */
  placementBusy: () => boolean;
  /** Freeze/unfreeze the sim (solo only; loop reads hotkeys.paused). */
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  /** false in lockstep multiplayer — the menu shows a hint instead. */
  canPause: boolean;
  /** Restart the same match setup; null hides the button (MP, loaded saves). */
  restart: (() => void) | null;
  /** MP: surrender the seat (victorySystem then ends the match). */
  surrender: (() => void) | null;
}

/**
 * In-game menu on Escape: continue, restart, back to the main menu. Opening
 * pauses solo games; a second Escape (or "Weiterspielen") resumes. Every
 * other overlay (help, tech tree, stats, chat, save dialog, cheat console,
 * tour, changelog, placement ghost) keeps its own Escape — the menu only
 * opens when none of them is active.
 */
export class EscMenu {
  private readonly root = document.getElementById('esc-menu')!;
  private wiring: EscMenuWiring | null = null;
  /** Pause state before the menu opened, restored on close. */
  private wasPaused = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.wiring) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.isOpen()) {
        e.stopImmediatePropagation(); // nobody else reacts while we're up
        this.close();
        return;
      }
      if (this.otherOverlayOpen() || this.wiring.placementBusy()) return; // their Escape
      e.stopImmediatePropagation();
      this.open();
    });
    document.getElementById('esc-continue')!.addEventListener('click', () => this.close());
    document.getElementById('esc-restart')!.addEventListener('click', () => {
      this.wiring?.restart?.();
    });
    document.getElementById('esc-mainmenu')!.addEventListener('click', () => {
      if (this.wiring?.surrender) {
        // MP: give up cleanly — victorySystem ends the match and the end
        // screen takes over (a bare reload would leave peers waiting).
        this.wiring.surrender();
        this.close();
      } else {
        location.reload();
      }
    });
  }

  wire(wiring: EscMenuWiring): void {
    this.wiring = wiring;
    const restartBtn = document.getElementById('esc-restart')!;
    restartBtn.style.display = wiring.restart ? '' : 'none';
    const main = document.getElementById('esc-mainmenu')!;
    main.textContent = wiring.surrender ? 'Aufgeben & Hauptmenü' : 'Hauptmenü';
    document.getElementById('esc-mp-hint')!.style.display = wiring.canPause ? 'none' : 'block';
    document.getElementById('esc-paused')!.style.display = wiring.canPause ? '' : 'none';
  }

  isOpen(): boolean {
    return this.root.style.display === 'flex';
  }

  private open(): void {
    if (!this.wiring) return;
    this.root.style.display = 'flex';
    if (this.wiring.canPause) {
      this.wasPaused = this.wiring.isPaused();
      this.wiring.setPaused(true);
    }
  }

  close(): void {
    if (!this.wiring) return;
    this.root.style.display = 'none';
    if (this.wiring.canPause) this.wiring.setPaused(this.wasPaused);
  }

  /** Any overlay with its own Escape handling currently visible? */
  private otherOverlayOpen(): boolean {
    const visible = (id: string, prop: 'flex' | 'open' = 'flex'): boolean => {
      const el = document.getElementById(id);
      if (!el) return false;
      return prop === 'open' ? el.classList.contains('open') : el.style.display === 'flex';
    };
    return (
      visible('help', 'open') ||
      visible('techtree', 'open') ||
      visible('tour', 'open') ||
      visible('changelog', 'open') ||
      visible('stats-overlay') ||
      visible('cheat') ||
      visible('save-dialog')
    );
  }
}
