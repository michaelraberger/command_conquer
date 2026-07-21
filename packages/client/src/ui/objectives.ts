import {
  OBJ_ACTIVE,
  OBJ_COMPLETE,
  OBJ_FAILED,
  type GameState,
  type SimEvent,
} from '@cac/sim';

/**
 * Campaign HUD: the "Missionsziele" panel (top-left) plus transient mission
 * toasts (objective changes, MISSION_MESSAGE radio chatter). Reads objective
 * status straight from state.mission — SimEvents only tell it when to look
 * and what to announce, so a loaded save renders correctly from tick one.
 */
export class ObjectivesHud {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toasts: HTMLElement;

  constructor(
    private readonly state: GameState,
    private readonly texts: Record<string, string>,
    private readonly messages: Record<string, string>,
  ) {
    this.root = document.getElementById('objectives')!;
    this.list = this.root.querySelector('.obj-list')!;
    this.toasts = document.getElementById('mission-toasts')!;
    this.root.style.display = '';
    this.refresh();
  }

  /** Re-renders the objective rows from the sim state. */
  refresh(): void {
    const mission = this.state.mission;
    if (!mission) return;
    this.list.replaceChildren();
    const rows = [...mission.objectives].sort((a, b) => Number(a.optional) - Number(b.optional));
    for (const obj of rows) {
      if (obj.status !== OBJ_ACTIVE && obj.status !== OBJ_COMPLETE && obj.status !== OBJ_FAILED) {
        continue; // hidden objectives stay invisible until revealed
      }
      const row = document.createElement('div');
      row.className = 'obj-row';
      if (obj.status === OBJ_COMPLETE) row.classList.add('done');
      if (obj.status === OBJ_FAILED) row.classList.add('failed');
      if (obj.optional) row.classList.add('bonus');
      const icon = obj.status === OBJ_COMPLETE ? '✔' : obj.status === OBJ_FAILED ? '✘' : '○';
      const text = this.texts[obj.id] ?? obj.id;
      row.innerHTML = `<span class="obj-icon"></span><span class="obj-text"></span>`;
      row.querySelector('.obj-icon')!.textContent = icon;
      row.querySelector('.obj-text')!.textContent = text;
      this.list.appendChild(row);
    }
  }

  /** Feed the per-tick SimEvents (called from the game loop's event hook). */
  handleEvents(events: readonly SimEvent[]): void {
    let dirty = false;
    for (const e of events) {
      if (e.type === 'OBJECTIVE') {
        dirty = true;
        const text = this.texts[e.id];
        if (e.status === OBJ_COMPLETE) this.toast(`Ziel erreicht: ${text ?? e.id}`, 'good');
        else if (e.status === OBJ_FAILED) this.toast(`Ziel fehlgeschlagen: ${text ?? e.id}`, 'bad');
        else if (e.status === OBJ_ACTIVE) this.toast(`Neues Missionsziel: ${text ?? e.id}`, 'info');
      } else if (e.type === 'MISSION_MESSAGE') {
        const text = this.messages[e.msgId];
        if (text) this.toast(text, 'info');
      }
    }
    if (dirty) this.refresh();
  }

  private toast(text: string, kind: 'good' | 'bad' | 'info'): void {
    const el = document.createElement('div');
    el.className = `mission-toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    // Keep at most three toasts on screen; each fades after ~6 s.
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 600);
    }, 6000);
  }
}
