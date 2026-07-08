import { WALL_LEVELS, type Command, type GameState } from '@cac/sim';
import { worldToScreen } from '../render/iso.js';
import { session } from '../session.js';
import type { Camera } from './camera.js';
import type { Controls } from './controls.js';

/**
 * Global keyboard shortcuts. Pause is client-local, so it is only offered
 * outside multiplayer (stalling one lockstep peer would just freeze both).
 * Camera keys (WASD/arrows) and the debug toggle live in their own handlers.
 *
 * P pause · U upgrade selected building · R toggle full build radius ·
 * H center camera on own base · E unload selected transport ships.
 * Ctrl+1–9 assign a control group, 1–9 recall it (double-tap centers camera).
 * C opens the (solo-only) cheat console; the codes are secret and named in
 * balance.json, so nothing on screen reveals them.
 */
/** Cheat kinds the sim understands. */
export type CheatKind = 'MONEY' | 'REVEAL' | 'POWER';
/** Console code (as typed) → cheat kind, supplied from the config. */
export type CheatCodes = Record<string, CheatKind>;

export class Hotkeys {
  paused = false;
  /** R toggles showing the whole buildable area (read by the loop). */
  showAllRadius = false;
  private readonly overlay = document.getElementById('pause')!;
  private readonly cheatOverlay = document.getElementById('cheat')!;
  private readonly cheatInput = document.getElementById('cheat-input') as HTMLInputElement;
  private readonly cheatStatus = document.getElementById('cheat-status')!;
  /** Control groups: digit → unit ids (client-only, never touches the sim). */
  private readonly groups = new Map<number, number[]>();
  /** Last recalled group + timestamp, for double-tap-to-center. */
  private lastRecall: { group: number; at: number } | null = null;

  constructor(
    private state: GameState,
    private controls: Controls,
    private send: (cmd: Command) => void,
    private camera: Camera,
    private canPause: boolean,
    private cheatCodes: CheatCodes,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.cheatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submitCheat();
      if (e.key === 'Escape') this.closeCheatConsole();
    });
    this.cheatOverlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.cheatOverlay) this.closeCheatConsole(); // click outside
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.repeat) return; // don't hijack text fields
    switch (e.key.toLowerCase()) {
      case 'p':
        if (this.canPause) this.togglePause();
        break;
      case 'u':
        this.tryUpgrade();
        break;
      case 'r':
        this.showAllRadius = !this.showAllRadius;
        break;
      case 'h':
        this.centerOnBase();
        break;
      case 'e':
        this.tryUnload();
        break;
      case 'c':
        // preventDefault so this very keystroke isn't typed into the field.
        e.preventDefault();
        this.openCheatConsole();
        break;
      default: {
        const digit = e.key >= '1' && e.key <= '9' ? Number(e.key) : 0;
        if (digit === 0) break;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault(); // don't trigger browser tab-switching
          this.assignGroup(digit);
        } else {
          this.recallGroup(digit);
        }
      }
    }
  }

  /** Stores the current selection under a digit (empty selection clears it). */
  private assignGroup(digit: number): void {
    this.groups.set(digit, [...this.controls.selected]);
  }

  /**
   * Reselects a group's still-living own units. A second recall of the same
   * group within 400 ms centers the camera on the group's centroid.
   */
  private recallGroup(digit: number): void {
    const ids = this.groups.get(digit);
    if (!ids || ids.length === 0) return;
    const live = this.state.units.filter(
      (u) => u.owner === session.localPlayer && ids.includes(u.id),
    );
    if (live.length === 0) return;

    this.controls.selected.clear();
    for (const u of live) this.controls.selected.add(u.id);
    this.controls.selectedBuilding = null;

    const now = performance.now();
    if (this.lastRecall && this.lastRecall.group === digit && now - this.lastRecall.at < 400) {
      const cx = live.reduce((s, u) => s + u.x, 0) / live.length;
      const cy = live.reduce((s, u) => s + u.y, 0) / live.length;
      const p = worldToScreen(cx, cy);
      this.camera.x = p.x;
      this.camera.y = p.y;
    }
    this.lastRecall = { group: digit, at: now };
  }

  /**
   * Cheat console: C opens an input, the player types a secret code and
   * confirms with Enter. Cheats ride the command stream (replay-safe); solo
   * only. The opening keystroke is preventDefault'd in onKey so the "c" is
   * never typed into the freshly-focused field.
   */
  private openCheatConsole(): void {
    if (!this.canPause) return; // lockstep multiplayer: no cheating
    this.cheatOverlay.style.display = 'flex';
    this.cheatInput.value = '';
    this.cheatStatus.textContent = '';
    this.cheatInput.focus();
  }

  private closeCheatConsole(): void {
    this.cheatOverlay.style.display = 'none';
    this.cheatInput.blur();
  }

  private submitCheat(): void {
    const code = this.cheatInput.value.trim().toLowerCase();
    const cheat = this.cheatCodes[code];
    if (!cheat) {
      // Deliberately vague — never confirm or hint at valid codes.
      this.cheatStatus.textContent = 'Ungültig';
      this.cheatInput.select();
      return;
    }
    this.send({ type: 'CHEAT', playerId: session.localPlayer, cheat });
    this.closeCheatConsole();
  }

  /** Unload the selected transport ships at their current shore position. */
  private tryUnload(): void {
    const transports = [...this.controls.selected]
      .sort((a, b) => a - b)
      .filter((id) => this.state.units.find((u) => u.id === id)?.type === 'TRANSPORT');
    if (transports.length === 0) return;
    this.send({ type: 'UNLOAD', playerId: session.localPlayer, unitIds: transports });
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.overlay.style.display = this.paused ? 'flex' : 'none';
  }

  /** Upgrade the selected own building if it has a next tier (walls today). */
  private tryUpgrade(): void {
    const id = this.controls.selectedBuilding;
    if (id === null) return;
    const building = this.state.buildings.find((b) => b.id === id);
    if (!building || building.owner !== session.localPlayer) return;
    if (building.type === 'WALL' && building.level < WALL_LEVELS.length) {
      this.send({ type: 'UPGRADE_BUILDING', playerId: session.localPlayer, buildingId: id });
    }
  }

  /** Recenter the camera on the player's construction yard (or any building). */
  private centerOnBase(): void {
    const home =
      this.state.buildings.find(
        (b) => b.owner === session.localPlayer && b.type === 'CONYARD',
      ) ?? this.state.buildings.find((b) => b.owner === session.localPlayer);
    if (!home) return;
    const p = worldToScreen(home.x, home.y);
    this.camera.x = p.x;
    this.camera.y = p.y;
  }
}
