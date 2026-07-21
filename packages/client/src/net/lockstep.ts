import type { RealtimeChannel } from '@supabase/supabase-js';
import { TICK_MS, hashState, type Command, type GameState } from '@cac/sim';
import { drainCommands } from '../commandQueue.js';
import type { TickDriver } from '../loop.js';
import { getSupabase } from './supabase.js';
import {
  FrameSender,
  HASH_PERIOD_TURNS,
  INPUT_DELAY_TURNS,
  LockstepScheduler,
  TICKS_PER_TURN,
  turnOfTick,
  type TurnFrame,
} from './lockstepCore.js';
import type { MatchStart } from './lobby.js';

const TURN_MS = TICKS_PER_TURN * TICK_MS; // ~133 ms at 15 Hz
/** Show the waiting overlay once the sim has stalled this long. */
const STALL_OVERLAY_MS = 1000;
/** Ask silent seats to resend while stalled, at this cadence. */
const RESEND_REQ_MS = 2000;
/** Controller drops a silent seat after this long (5 s once presence left). */
const DROP_TIMEOUT_MS = 15_000;
const DROP_PRESENCE_MS = 5_000;
/** All seats must reach the game channel within this window. */
const START_BARRIER_MS = 20_000;
/** No message from anyone for this long → our own link is dead. Generous:
 *  hidden-tab timer throttling on the PEER side must not trip this. */
const SELF_DEAD_MS = 30_000;
/** Extra turns of grace above the newest received frame when dropping. */
const DROP_GRACE_TURNS = 25;
/** Catch-up budget per rendered frame (on top of MAX_TICKS_PER_FRAME). */
const MAX_CATCHUP_TICKS = 7;
/** Chat lines are capped — nobody pastes a novel into the game channel. */
const CHAT_MAX_LEN = 200;

interface FrameMsg {
  seat: number;
  frames: TurnFrame[];
  hashTurn?: number;
  hash?: string;
}

type ControlMsg =
  | { kind: 'drop'; seat: number; fromTurn: number; by: number }
  | { kind: 'abort'; by: number }
  | { kind: 'req'; seat: number; fromTurn: number; toTurn: number; by: number };

export interface RemoteDriverEvents {
  /** Blocked on missing frames: seat names to display, or null to clear. */
  onWaiting: (names: string[] | null) => void;
  /** A peer was dropped from the match (toast). */
  onPlayerDropped: (name: string) => void;
  /** State hashes diverged — the match is over for everyone. */
  onDesync: () => void;
  /** We lost the connection (or were dropped ourselves). */
  onSelfDisconnected: () => void;
  /** Match never started / host aborted. */
  onAborted: (reason: string) => void;
}

/**
 * Lockstep TickDriver over the Supabase Realtime game channel: blocks the sim
 * until every live seat's frame for the pending turn arrived, sends the local
 * frame on a wall-clock interval (so a hidden tab keeps feeding its peers),
 * and polices timeouts, resends, drops and the periodic hash check.
 */
export class RemoteDriver implements TickDriver {
  private readonly core: LockstepScheduler;
  private readonly sender: FrameSender;
  private channel: RealtimeChannel | null = null;
  private timer: number | null = null;

  /** Dev diagnostics (read via window.__mpDriver in dev builds). */
  readonly debug = { sent: 0, received: 0, sendErrors: 0, started: false, presence: 0 };

  /** UI hook: an incoming chat line from another seat (see ui/chat.ts). */
  onChat: ((seat: number, text: string) => void) | null = null;

  private started = false;
  private halted = false;
  private neededTick = 0;
  private lastProgressAt = Date.now();
  private lastAnyMessageAt = Date.now();
  private readonly lastSeenAt: number[];
  private readonly presentSeats = new Set<number>();
  private readonly ownHashes = new Map<number, string>();
  private readonly peerHashes = new Map<number, string>();
  private pendingHash: { turn: number; hash: string } | null = null;
  private lastReqAt = 0;

  constructor(
    private readonly match: MatchStart,
    private readonly events: RemoteDriverEvents,
  ) {
    this.core = new LockstepScheduler(match.seats.length, match.localSeat);
    this.sender = new FrameSender(match.localSeat);
    this.lastSeenAt = match.seats.map(() => Date.now());
  }

  /** Subscribe the game channel and wait at the start barrier until every
   *  seat is present (or the barrier times out → onAborted). */
  async connect(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Cloud nicht konfiguriert.');
    const channel = supabase.channel(`cac:game:${this.match.code}`, {
      config: { presence: { key: String(this.match.localSeat) }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel.on('broadcast', { event: 'frame' }, ({ payload }) => {
      this.handleFrame(payload as FrameMsg);
    });
    channel.on('broadcast', { event: 'control' }, ({ payload }) => {
      this.handleControl(payload as ControlMsg);
    });
    // Chat rides the same channel as plain broadcast: pure presentation,
    // never a sim input — latency/ordering cannot desync anything.
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      const msg = payload as { seat?: unknown; text?: unknown };
      if (typeof msg.seat !== 'number' || typeof msg.text !== 'string') return;
      if (msg.seat === this.match.localSeat) return; // never trust an echo
      this.onChat?.(msg.seat, msg.text.slice(0, CHAT_MAX_LEN));
    });
    channel.on('presence', { event: 'sync' }, () => {
      this.presentSeats.clear();
      for (const key of Object.keys(channel.presenceState())) {
        const seat = Number(key);
        if (Number.isInteger(seat)) this.presentSeats.add(seat);
      }
    });

    const status = await new Promise<string>((resolve) => {
      channel.subscribe((s) => resolve(s), 10_000);
    });
    if (status !== 'SUBSCRIBED') {
      this.shutdown();
      throw new Error('Verbindung zum Spielkanal fehlgeschlagen.');
    }
    await channel.track({ seat: this.match.localSeat });

    const barrierStart = Date.now();
    this.timer = window.setInterval(() => this.onInterval(barrierStart), TURN_MS);
  }

  /** Sends a chat line to every peer and echoes it locally (broadcast is
   *  configured self:false). Empty lines are dropped, length is capped. */
  sendChat(text: string): void {
    const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
    if (trimmed.length === 0) return;
    void this.channel?.send({
      type: 'broadcast',
      event: 'chat',
      payload: { seat: this.match.localSeat, text: trimmed },
    });
    this.onChat?.(this.match.localSeat, trimmed);
  }

  // ---------------------------------------------------------------- TickDriver

  canTick(nextTick: number): boolean {
    this.neededTick = nextTick;
    if (!this.started || this.halted) return false;
    return this.core.turnComplete(turnOfTick(nextTick));
  }

  commandsFor(nextTick: number): Command[] {
    if (nextTick % TICKS_PER_TURN !== 0) return [];
    return this.core.commandsForTurn(turnOfTick(nextTick));
  }

  onTicked(state: GameState): void {
    this.lastProgressAt = Date.now();
    this.core.noteExecuted(state.tick);
    const turn = turnOfTick(state.tick);
    // Hash the state after the LAST tick of a hash turn completed.
    if (state.tick % TICKS_PER_TURN === TICKS_PER_TURN - 1 && turn % HASH_PERIOD_TURNS === 0) {
      const hash = hashState(state);
      this.ownHashes.set(turn, hash);
      this.pendingHash = { turn, hash };
      this.checkHashes();
    }
    if (state.winner !== -1) this.shutdown();
  }

  catchUpTicks(): number {
    if (!this.started || this.halted) return 0;
    const behindTurns = this.core.newestCompleteTurn() - turnOfTick(this.neededTick);
    if (behindTurns <= 1) return 0;
    return Math.min(behindTurns * TICKS_PER_TURN, MAX_CATCHUP_TICKS);
  }

  // ------------------------------------------------------------------- sending

  private onInterval(barrierStart: number): void {
    if (this.halted) return;
    const now = Date.now();

    this.debug.presence = this.presentSeats.size;
    if (!this.started) {
      if (this.presentSeats.size >= this.match.seats.length) {
        this.started = true;
        this.debug.started = true;
        this.lastProgressAt = now;
        this.lastAnyMessageAt = now;
        // The silence clock starts NOW — a slow barrier must not count toward
        // the drop timeout, or a seat could be dropped before its first frame.
        this.lastSeenAt.fill(now);
      } else if (now - barrierStart > START_BARRIER_MS) {
        this.halted = true;
        this.shutdown();
        this.events.onAborted('Nicht alle Spieler haben das Spiel erreicht.');
      }
      return;
    }

    // Own link dead? With ≥1 peer the channel is never this quiet in health.
    if (now - this.lastAnyMessageAt > SELF_DEAD_MS && this.match.seats.length > 1) {
      this.halted = true;
      this.shutdown();
      this.events.onSelfDisconnected();
      return;
    }

    // Send this turn's frame (even when empty) unless we ran too far ahead of
    // our own sim (hidden for many minutes — peers will wait/drop us anyway).
    if (!this.sender.tooFarAhead(this.core.executedTurn())) {
      const drained = drainCommands().filter((c) => c.playerId === this.match.localSeat);
      const frames = this.sender.buildFrames(drained);
      const last = frames[frames.length - 1]!;
      this.core.addFrame(this.match.localSeat, last); // own buffer, no echo needed
      const msg: FrameMsg = { seat: this.match.localSeat, frames };
      if (this.pendingHash) {
        msg.hashTurn = this.pendingHash.turn;
        msg.hash = this.pendingHash.hash;
        this.pendingHash = null;
      }
      this.debug.sent++;
      void this.channel
        ?.send({ type: 'broadcast', event: 'frame', payload: msg })
        .then((r) => {
          if (r !== 'ok') this.debug.sendErrors++;
        });
    }

    this.superviseStall(now);
  }

  private superviseStall(now: number): void {
    const stalledMs = now - this.lastProgressAt;
    if (stalledMs < STALL_OVERLAY_MS) {
      this.events.onWaiting(null);
      return;
    }
    const neededTurn = turnOfTick(this.neededTick);
    const missing = this.core.missingSeats(neededTurn);
    if (missing.length === 0) {
      this.events.onWaiting(null);
      return;
    }
    this.events.onWaiting(missing.map((s) => this.match.seats[s]?.name ?? `Spieler ${s + 1}`));

    // Ask the silent seats to resend the range we are stuck on.
    if (now - this.lastReqAt > RESEND_REQ_MS) {
      this.lastReqAt = now;
      for (const seat of missing) {
        const control: ControlMsg = {
          kind: 'req',
          seat,
          fromTurn: neededTurn,
          toTurn: neededTurn + INPUT_DELAY_TURNS,
          by: this.match.localSeat,
        };
        void this.channel?.send({ type: 'broadcast', event: 'control', payload: control });
      }
    }

    // Controller duty: drop seats that stay silent past the timeout.
    if (this.core.controllerSeat() === this.match.localSeat) {
      for (const seat of missing) {
        if (seat === this.match.localSeat || this.core.isDropped(seat)) continue;
        const silentMs = now - this.lastSeenAt[seat]!;
        const limit = this.presentSeats.has(seat) ? DROP_TIMEOUT_MS : DROP_PRESENCE_MS;
        if (silentMs > limit) {
          const fromTurn =
            Math.max(this.core.newestFrameOf(seat), INPUT_DELAY_TURNS - 1) + DROP_GRACE_TURNS;
          const control: ControlMsg = {
            kind: 'drop',
            seat,
            fromTurn,
            by: this.match.localSeat,
          };
          void this.channel?.send({ type: 'broadcast', event: 'control', payload: control });
          this.applyDrop(seat, fromTurn); // self:false — apply locally too
        }
      }
    }
  }

  // ----------------------------------------------------------------- receiving

  private handleFrame(msg: FrameMsg): void {
    if (this.halted) return;
    this.debug.received++;
    const now = Date.now();
    this.lastAnyMessageAt = now;
    if (msg.seat >= 0 && msg.seat < this.lastSeenAt.length) this.lastSeenAt[msg.seat] = now;
    for (const frame of msg.frames) this.core.addFrame(msg.seat, frame);
    if (msg.hashTurn !== undefined && msg.hash !== undefined) {
      // First peer hash per turn wins — all peers must agree anyway.
      if (!this.peerHashes.has(msg.hashTurn)) this.peerHashes.set(msg.hashTurn, msg.hash);
      this.checkHashes();
    }
  }

  private handleControl(msg: ControlMsg): void {
    if (this.halted) return;
    this.lastAnyMessageAt = Date.now();
    if (msg.kind === 'req') {
      if (msg.seat !== this.match.localSeat) return;
      const frames = this.sender.framesForRange(msg.fromTurn, msg.toTurn);
      if (frames.length > 0) {
        const reply: FrameMsg = { seat: this.match.localSeat, frames };
        void this.channel?.send({ type: 'broadcast', event: 'frame', payload: reply });
      }
      return;
    }
    // drop/abort are controller-only (host succession = lowest live seat).
    if (msg.by !== this.core.controllerSeat()) return;
    if (msg.kind === 'drop') {
      this.applyDrop(msg.seat, msg.fromTurn);
    } else {
      this.halted = true;
      this.shutdown();
      this.events.onAborted('Der Host hat die Partie beendet.');
    }
  }

  private applyDrop(seat: number, fromTurn: number): void {
    if (this.core.isDropped(seat)) return;
    if (seat === this.match.localSeat) {
      this.halted = true;
      this.shutdown();
      this.events.onSelfDisconnected();
      return;
    }
    this.core.drop(seat, fromTurn);
    this.events.onPlayerDropped(this.match.seats[seat]?.name ?? `Spieler ${seat + 1}`);
  }

  private checkHashes(): void {
    for (const [turn, own] of this.ownHashes) {
      const peer = this.peerHashes.get(turn);
      if (peer === undefined) continue;
      if (peer !== own) {
        this.halted = true;
        this.shutdown();
        this.events.onDesync();
        return;
      }
      // Agreed — this turn's bookkeeping is done.
      this.ownHashes.delete(turn);
      this.peerHashes.delete(turn);
    }
  }

  shutdown(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const ch = this.channel;
    this.channel = null;
    if (ch) void getSupabase()?.removeChannel(ch);
    this.events.onWaiting(null);
  }
}
