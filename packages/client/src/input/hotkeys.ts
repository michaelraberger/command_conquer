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
 * C opens the cheat console (solo only): "money" · "visible" · "power".
 */
/** Typed console codes → sim cheat kinds. */
const CHEAT_CODES: Record<string, 'MONEY' | 'REVEAL' | 'POWER'> = {
  money: 'MONEY',
  visible: 'REVEAL',
  power: 'POWER',
};

export class Hotkeys {
  paused = false;
  /** R toggles showing the whole buildable area (read by the loop). */
  showAllRadius = false;
  private readonly overlay = document.getElementById('pause')!;
  private readonly cheatOverlay = document.getElementById('cheat')!;
  private readonly cheatInput = document.getElementById('cheat-input') as HTMLInputElement;
  private readonly cheatStatus = document.getElementById('cheat-status')!;

  constructor(
    private state: GameState,
    private controls: Controls,
    private send: (cmd: Command) => void,
    private camera: Camera,
    private canPause: boolean,
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
        this.openCheatConsole();
        break;
    }
  }

  /**
   * Cheat console: C opens an input, the player types a code and confirms
   * with Enter. Cheats ride the command stream (replay-safe); solo only.
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
    const cheat = CHEAT_CODES[code];
    if (!cheat) {
      this.cheatStatus.textContent = `Unbekannter Cheat: „${code}“`;
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
