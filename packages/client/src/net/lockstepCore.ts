import { TICK_MS, type Command } from '@cac/sim';

/**
 * Pure lockstep bookkeeping — no DOM, no Supabase, no timers. The RemoteDriver
 * (net/lockstep.ts) feeds it received frames and asks which sim ticks may run;
 * everything here is deterministic and unit-tested in isolation.
 *
 * Model: sim ticks are grouped into NET TURNS of TICKS_PER_TURN ticks. Every
 * live seat sends exactly one frame per turn (possibly empty). All commands of
 * a turn execute on its FIRST tick, merged in ascending seat order (sender
 * order within a frame) — the deterministic ordering contract shared by every
 * client. Commands are stamped for turn N + INPUT_DELAY_TURNS when issued
 * during turn N, so the network has ~400 ms to deliver them.
 */

/** Sim ticks per net turn (15 Hz / 2 = 7.5 turns per second). Shorter turns
 *  cut the felt input lag (boundary wait + delay ≈ 330 ms instead of 500 ms)
 *  while the delivery budget stays 2 turns ≈ 266 ms. */
export const TICKS_PER_TURN = 2;
/** Turns between issuing a command and executing it (~266 ms). */
export const INPUT_DELAY_TURNS = 2;
/** A state hash is recorded every N turns (~10 s) for desync detection. */
export const HASH_PERIOD_TURNS = 50;
/** Every frame message carries this many trailing turns (heals lost packets). */
export const HISTORY_TURNS = 3;
/** Sender stops running ahead of the executed turn by more than this. */
export const MAX_AHEAD_TURNS = 300;
/** Wall-clock length of one net turn. */
export const TURN_MS = TICKS_PER_TURN * TICK_MS;
/** Upper bound of turns closed per send — sanity cap after long timer gaps
 *  (laptop sleep, minute-level background throttling). At 7.5 due turns per
 *  second even a 1 Hz throttled timer catches up with room to spare. */
export const MAX_TURNS_PER_SEND = 45;

export function turnOfTick(tick: number): number {
  return Math.trunc(tick / TICKS_PER_TURN);
}

/** First sim tick of a turn — the one that executes the turn's commands. */
export function firstTickOfTurn(turn: number): number {
  return turn * TICKS_PER_TURN;
}

/** One seat's input for one net turn. */
export interface TurnFrame {
  turn: number;
  cmds: Command[];
}

export interface DropRecord {
  seat: number;
  /** First turn treated as empty for the seat; a synthetic SURRENDER runs here. */
  fromTurn: number;
}

/**
 * Per-match lockstep state for one client: which frames arrived, who is live,
 * who was dropped from which turn on.
 */
export class LockstepScheduler {
  /** frames[seat] -> turn -> commands. */
  private readonly frames: Array<Map<number, Command[]>>;
  private readonly dropped: Array<number | null>;
  /** Turns whose synthetic SURRENDER was already merged (guard against dupes). */
  private readonly surrenderDone: Set<number> = new Set();
  private executedTurnWatermark = -1;

  constructor(readonly seatCount: number, readonly localSeat: number) {
    this.frames = Array.from({ length: seatCount }, () => new Map());
    this.dropped = Array.from({ length: seatCount }, () => null);
  }

  /** Store a received (or own) frame. Ignores frames of dropped turns and
   *  duplicates; commands with a foreign playerId are discarded (anti-spoof —
   *  the same filter runs on every client, keeping the merge deterministic). */
  addFrame(seat: number, frame: TurnFrame): void {
    if (seat < 0 || seat >= this.seatCount) return;
    // Turn-Fenster: Nicht-Ganzzahlen und Turns weit jenseits des Spielstands
    // wuerden die Frame-Maps unbegrenzt fuellen (Speicher-DoS) und
    // newestCompleteTurn in lange Schleifen treiben.
    if (
      !Number.isInteger(frame.turn) ||
      frame.turn < 0 ||
      frame.turn > this.executedTurnWatermark + MAX_AHEAD_TURNS + MAX_TURNS_PER_SEND
    ) {
      return;
    }
    const dropAt = this.dropped[seat];
    if (dropAt !== null && frame.turn >= dropAt!) return;
    const bySeat = this.frames[seat]!;
    if (bySeat.has(frame.turn)) return;
    bySeat.set(frame.turn, frame.cmds.filter((c) => c.playerId === seat));
  }

  /** Mark a seat as dropped from `fromTurn` on: its buffered frames beyond that
   *  are discarded and all its future turns count as (synthetically) present. */
  drop(seat: number, fromTurn: number): void {
    if (seat < 0 || seat >= this.seatCount) return;
    if (this.dropped[seat] !== null) return; // already dropped
    this.dropped[seat] = fromTurn;
    const bySeat = this.frames[seat]!;
    for (const turn of [...bySeat.keys()]) {
      if (turn >= fromTurn) bySeat.delete(turn);
    }
  }

  isDropped(seat: number): boolean {
    return this.dropped[seat] !== null;
  }

  /** Live = not dropped. The controller seat is the lowest live seat. */
  controllerSeat(): number {
    for (let s = 0; s < this.seatCount; s++) {
      if (this.dropped[s] === null) return s;
    }
    return 0;
  }

  /** A seat's frame for `turn` counts as present when it arrived, when the
   *  turn predates the input delay (implicitly empty), or when the seat is
   *  dropped — a dropped seat never blocks ANY turn: frames it did deliver
   *  (before its drop turn) still execute, everything missing counts as
   *  empty. The drop turn sits above every peer's last received frame (grace
   *  window), so views agree; residual divergence trips the hash check. */
  private framePresent(seat: number, turn: number): boolean {
    if (turn < INPUT_DELAY_TURNS) return true;
    if (this.dropped[seat] !== null) return true;
    return this.frames[seat]!.has(turn);
  }

  /** May the sim run the ticks of `turn`? Only when every seat is accounted for. */
  turnComplete(turn: number): boolean {
    for (let s = 0; s < this.seatCount; s++) {
      if (!this.framePresent(s, turn)) return false;
    }
    return true;
  }

  /** Seats whose frame for `turn` is still missing (for the waiting overlay). */
  missingSeats(turn: number): number[] {
    const missing: number[] = [];
    for (let s = 0; s < this.seatCount; s++) {
      if (!this.framePresent(s, turn)) missing.push(s);
    }
    return missing;
  }

  /**
   * The merged, deterministic command list for a turn: frames in ascending
   * seat order, sender order within each frame. A dropped seat contributes a
   * single synthetic SURRENDER on its drop turn (once), nothing afterwards.
   */
  commandsForTurn(turn: number): Command[] {
    const merged: Command[] = [];
    for (let s = 0; s < this.seatCount; s++) {
      const dropAt = this.dropped[s];
      if (dropAt !== null && turn >= dropAt!) {
        if (turn === dropAt && !this.surrenderDone.has(s)) {
          this.surrenderDone.add(s);
          merged.push({ type: 'SURRENDER', playerId: s });
        }
        continue;
      }
      const cmds = this.frames[s]!.get(turn);
      if (cmds) merged.push(...cmds);
    }
    return merged;
  }

  /** Bookkeeping after the sim executed a tick. */
  noteExecuted(tickJustRun: number): void {
    const turn = turnOfTick(tickJustRun);
    if (turn > this.executedTurnWatermark) {
      this.executedTurnWatermark = turn;
      // Frames older than the history window can never be requested again.
      const floor = turn - HISTORY_TURNS - 1;
      for (const bySeat of this.frames) {
        for (const t of [...bySeat.keys()]) {
          if (t < floor) bySeat.delete(t);
        }
      }
    }
  }

  executedTurn(): number {
    return this.executedTurnWatermark;
  }

  /** Newest turn that is fully available (for catch-up pacing). -1 = none. */
  newestCompleteTurn(): number {
    let t = Math.max(this.executedTurnWatermark, INPUT_DELAY_TURNS - 1);
    while (this.turnComplete(t + 1)) t++;
    return t;
  }

  /** Highest turn received from a seat (drop bookkeeping). -1 = none. */
  newestFrameOf(seat: number): number {
    let newest = -1;
    for (const t of this.frames[seat]!.keys()) {
      if (t > newest) newest = t;
    }
    return newest;
  }
}

/**
 * Outgoing frame log of the local seat: drains the command queue once per
 * turn, keeps a short history for the frame messages and answers resend
 * requests from peers.
 */
export class FrameSender {
  private readonly log = new Map<number, Command[]>();
  private nextSendTurn = INPUT_DELAY_TURNS;
  private turnZeroAt: number | null = null;

  constructor(readonly localSeat: number) {}

  /** Turns 0..INPUT_DELAY_TURNS-1 are implicitly empty and never sent. */
  currentSendTurn(): number {
    return this.nextSendTurn;
  }

  /** Anchor the turn clock: the first send turn is due at `nowMs`. */
  markStarted(nowMs: number): void {
    this.turnZeroAt = nowMs;
  }

  /**
   * Newest turn that should be closed by `nowMs`. Clock-based instead of
   * counting timer fires: setInterval callbacks arrive systematically LATE
   * (and hidden tabs throttle them to seconds), so a fire-counting sender
   * drifts behind the 7.5-turns-per-second the sim consumes — every deficit
   * turn stalls all peers for a turn and triggers a catch-up burst.
   */
  dueTurn(nowMs: number): number {
    if (this.turnZeroAt === null) return this.nextSendTurn;
    return INPUT_DELAY_TURNS + Math.trunc((nowMs - this.turnZeroAt) / TURN_MS);
  }

  /**
   * Close every due turn up to `targetTurn` (capped at MAX_TURNS_PER_SEND):
   * the drained commands land in the first newly closed turn — peers cannot
   * have executed it yet, they are still waiting for exactly this frame — and
   * later turns close empty. Returns the newly closed frames, oldest first;
   * empty array when no turn is due.
   */
  buildFramesUpTo(targetTurn: number, drained: Command[]): TurnFrame[] {
    const closed: TurnFrame[] = [];
    const last = Math.min(targetTurn, this.nextSendTurn + MAX_TURNS_PER_SEND - 1);
    while (this.nextSendTurn <= last) {
      const cmds = closed.length === 0 ? drained : [];
      this.log.set(this.nextSendTurn, cmds);
      closed.push({ turn: this.nextSendTurn, cmds });
      this.nextSendTurn++;
    }
    return closed;
  }

  /**
   * Close exactly the next turn and return the message payload: this turn
   * plus the trailing history window (convenience path, also used by tests).
   */
  buildFrames(drained: Command[]): TurnFrame[] {
    this.buildFramesUpTo(this.nextSendTurn, drained);
    return this.framesForRange(this.nextSendTurn - HISTORY_TURNS, this.nextSendTurn - 1);
  }

  /** Frames for a peer's resend request (empty for unknown turns). */
  framesForRange(fromTurn: number, toTurn: number): TurnFrame[] {
    const frames: TurnFrame[] = [];
    for (let t = Math.max(fromTurn, INPUT_DELAY_TURNS); t <= toTurn && t < this.nextSendTurn; t++) {
      frames.push({ turn: t, cmds: this.log.get(t) ?? [] });
    }
    return frames;
  }

  /** Sender back-pressure: pause sending when too far ahead of the sim. */
  tooFarAhead(executedTurn: number): boolean {
    return this.nextSendTurn - executedTurn > MAX_AHEAD_TURNS;
  }

  /** Drop log entries far behind every peer (memory bound). */
  pruneBelow(turn: number): void {
    for (const t of [...this.log.keys()]) {
      if (t < turn) this.log.delete(t);
    }
  }
}
