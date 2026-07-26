import type { ControlGroups } from '../input/groups.js';

/**
 * Floating control-group chips on the left edge. Each existing group shows a
 * clickable chip with its digit and unit count; clicking toggles it into the
 * selection (multi-select — the selection is the union of all marked chips).
 * Marked chips are highlighted. Pure DOM, no sim/render coupling.
 */
export class GroupBar {
  private readonly root = document.getElementById('groups')!;
  /** Signature of the last render, so we only touch the DOM on change. */
  private lastSignature = '';

  constructor(private groups: ControlGroups) {}

  /** Called every frame; rebuilds the chips only when something changed. */
  sync(): void {
    const chips = this.groups.list();
    const signature = chips.map((c) => `${c.digit}:${c.count}:${c.marked ? 1 : 0}`).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.root.replaceChildren();
    for (const chip of chips) {
      const el = document.createElement('button');
      el.className = chip.marked ? 'group-chip marked' : 'group-chip';
      el.innerHTML = `<span class="g-num">${chip.digit}</span><span class="g-count">${chip.count}</span>`;
      el.title = `Gruppe ${chip.digit} (${chip.count}) – klicken zum Markieren`;
      el.addEventListener('click', () => {
        this.groups.toggle(chip.digit);
        this.sync(); // reflect the new marked state immediately
      });
      // Dissolve ✕, top-right corner, only visible while hovering the chip.
      // A span, not a nested button — buttons must not contain buttons.
      const close = document.createElement('span');
      close.className = 'g-close';
      close.textContent = '✕';
      close.title = `Gruppe ${chip.digit} auflösen`;
      close.addEventListener('click', (ev) => {
        ev.stopPropagation(); // the chip underneath must not toggle
        this.groups.dissolve(chip.digit);
        this.sync();
      });
      el.appendChild(close);
      this.root.appendChild(el);
    }
  }
}
