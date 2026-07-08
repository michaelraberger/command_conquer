import type { GameState, Unit } from '@cac/sim';
import { session } from '../session.js';
import type { Controls } from './controls.js';

/** One chip's worth of info for the on-screen group bar. */
export interface GroupChip {
  digit: number;
  count: number;
  marked: boolean;
}

/**
 * Control groups (Strg+1–9): the single source of truth shared by the keyboard
 * (hotkeys), the floating chip bar and the per-unit number labels. Purely
 * client-side — selection is never part of the sim, so this touches no
 * commands and cannot affect determinism, replays or multiplayer.
 *
 * A group's units can be recalled (keyboard: replace selection, mark only that
 * group) or toggled via a chip (multi-select: the selection is the union of all
 * marked groups). Manual map selection clears the marks.
 */
export class ControlGroups {
  private readonly groups = new Map<number, number[]>();
  private readonly marked = new Set<number>();

  constructor(
    private state: GameState,
    private controls: Controls,
  ) {}

  /** Stores the current selection under a digit; an empty selection clears it. */
  assign(digit: number): void {
    const ids = [...this.controls.selected];
    if (ids.length === 0) {
      this.groups.delete(digit);
      this.marked.delete(digit);
      return;
    }
    this.groups.set(digit, ids);
  }

  /** Still-living own units of a group, in ascending-id order. */
  private liveUnits(digit: number): Unit[] {
    const ids = this.groups.get(digit);
    if (!ids || ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.state.units.filter((u) => u.owner === session.localPlayer && wanted.has(u.id));
  }

  /**
   * Keyboard recall: select exactly this group and mark only its chip. Returns
   * the live units so the caller can center the camera (double-tap).
   */
  recall(digit: number): Unit[] {
    const live = this.liveUnits(digit);
    if (live.length === 0) return [];
    this.marked.clear();
    this.marked.add(digit);
    this.rebuildSelection();
    return live;
  }

  /** Chip click: toggle a group in/out of the marked set (multi-select). */
  toggle(digit: number): void {
    if (this.liveUnits(digit).length === 0) {
      this.groups.delete(digit);
      this.marked.delete(digit);
      return;
    }
    if (this.marked.has(digit)) this.marked.delete(digit);
    else this.marked.add(digit);
    this.rebuildSelection();
  }

  /** Rebuilds the unit selection from every currently marked group. */
  private rebuildSelection(): void {
    this.controls.selected.clear();
    for (const digit of this.marked) {
      for (const u of this.liveUnits(digit)) this.controls.selected.add(u.id);
    }
    this.controls.selectedBuilding = null;
  }

  /** Drops all chip marks — called when the player selects on the map instead. */
  clearMarks(): void {
    this.marked.clear();
  }

  /** Chips for the on-screen bar: only groups that still have living units. */
  list(): GroupChip[] {
    const chips: GroupChip[] = [];
    for (let digit = 1; digit <= 9; digit++) {
      const count = this.liveUnits(digit).length;
      if (count > 0) chips.push({ digit, count, marked: this.marked.has(digit) });
    }
    return chips;
  }

  /**
   * unitId → group digit for every marked group's units (lowest digit wins when
   * a unit is in several). Drives the number badge drawn above each unit.
   */
  tags(): ReadonlyMap<number, number> {
    const tags = new Map<number, number>();
    for (let digit = 1; digit <= 9; digit++) {
      if (!this.marked.has(digit)) continue;
      for (const u of this.liveUnits(digit)) {
        if (!tags.has(u.id)) tags.set(u.id, digit);
      }
    }
    return tags;
  }
}
