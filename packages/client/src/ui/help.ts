/**
 * Shortcut menu: a "?" button (and F1) toggles a modal listing the controls.
 * Replaces the old always-on bottom help bar. The cheat console is deliberately
 * left out so the cheats stay hidden.
 */
export class HelpMenu {
  private readonly panel = document.getElementById('help')!;
  private readonly btn = document.getElementById('help-btn')!;

  constructor() {
    this.btn.addEventListener('click', () => this.toggle());
    document.getElementById('help-close')?.addEventListener('click', () => this.close());
    // Click on the dimmed backdrop (outside the card) closes the menu.
    this.panel.addEventListener('pointerdown', (e) => {
      if (e.target === this.panel) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return; // don't hijack the cheat input
      if (e.key === 'F1') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape' && this.panel.classList.contains('open')) {
        e.preventDefault();
        this.close();
      }
    });
  }

  private toggle(): void {
    this.panel.classList.toggle('open');
  }

  private close(): void {
    this.panel.classList.remove('open');
  }
}
