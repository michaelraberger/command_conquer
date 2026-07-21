/**
 * In-game chat for internet matches (classic C&C feel): Enter opens the input
 * line, Enter sends, Escape cancels. Incoming lines stack bottom-left in the
 * sender's seat colour and fade out after a while. Pure presentation — the
 * transport is a plain broadcast on the game channel (see RemoteDriver),
 * nothing here touches the sim.
 */

/** How long a line stays before fading (ms), and how many stack at most. */
const LINE_TTL_MS = 12_000;
const MAX_LINES = 8;
const MAX_LEN = 200;

export class ChatOverlay {
  private readonly log = document.getElementById('chat-log')!;
  private readonly form = document.getElementById('chat-form')!;
  private readonly input = document.getElementById('chat-input') as HTMLInputElement;
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);
  private disposed = false;

  constructor(
    /** Seat → display name and tint (from the identical MP player setup). */
    private readonly names: string[],
    private readonly colors: number[],
    private readonly send: (text: string) => void,
    /** Chat stays available while the game runs (blocks after game over). */
    private readonly active: () => boolean,
  ) {
    this.log.replaceChildren();
    window.addEventListener('keydown', this.onKeyDown);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must never trigger game hotkeys
      if (e.key === 'Enter') {
        const text = this.input.value.trim().slice(0, MAX_LEN);
        if (text.length > 0) this.send(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  /** Appends a chat line (sender-coloured name + plain text, XSS-safe). */
  push(seat: number, text: string): void {
    if (this.disposed) return;
    const line = document.createElement('div');
    line.className = 'chat-line';
    const who = document.createElement('span');
    who.textContent = `${this.names[seat] ?? `Spieler ${seat + 1}`}: `;
    who.style.color = `#${(this.colors[seat] ?? 0xffffff).toString(16).padStart(6, '0')}`;
    const body = document.createElement('span');
    body.textContent = text.slice(0, MAX_LEN);
    line.append(who, body);
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild!.remove();
    window.setTimeout(() => {
      line.classList.add('faded');
      window.setTimeout(() => line.remove(), 600);
    }, LINE_TTL_MS);
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.disposed || e.key !== 'Enter' || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!this.active()) return;
    e.preventDefault();
    this.form.style.display = 'flex';
    this.input.value = '';
    this.input.focus();
  }

  private close(): void {
    this.input.value = '';
    this.form.style.display = 'none';
    this.input.blur();
  }

  /** Unhooks the global key listener (end of the match). */
  dispose(): void {
    this.disposed = true;
    this.close();
    window.removeEventListener('keydown', this.onKeyDown);
  }
}
