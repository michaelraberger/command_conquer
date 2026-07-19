import { describe, expect, it } from 'vitest';
import {
  createGame,
  hashState,
  tick,
  type Command,
  type GameState,
  type MultiplayerSeat,
} from '@cac/sim';
import {
  FrameSender,
  INPUT_DELAY_TURNS,
  LockstepScheduler,
  TICKS_PER_TURN,
  turnOfTick,
  type TurnFrame,
} from '../src/net/lockstepCore.js';

const SEATS: MultiplayerSeat[] = [
  { faction: 'ALLIES', name: 'Anna' },
  { faction: 'SOVIETS', name: 'Boris' },
];

/** One simulated client: real sim + real lockstep bookkeeping; the "network"
 *  is a lossy in-memory queue between the peers. */
class SimClient {
  readonly state: GameState;
  readonly core: LockstepScheduler;
  readonly sender: FrameSender;
  readonly outbox: Array<{ seat: number; frames: TurnFrame[] }> = [];
  private pending: Command[] = [];

  constructor(seed: number, readonly seat: number) {
    this.state = createGame(seed, { multiplayer: { seats: SEATS } });
    this.core = new LockstepScheduler(SEATS.length, seat);
    this.sender = new FrameSender(seat);
  }

  issue(cmd: Command): void {
    this.pending.push(cmd);
  }

  /** One net turn: drain local input into a frame message (with history). */
  sendTurn(): void {
    const drained = this.pending;
    this.pending = [];
    const frames = this.sender.buildFrames(drained);
    this.core.addFrame(this.seat, frames[frames.length - 1]!);
    this.outbox.push({ seat: this.seat, frames });
  }

  receive(msg: { seat: number; frames: TurnFrame[] }): void {
    for (const f of msg.frames) this.core.addFrame(msg.seat, f);
  }

  /** Run every sim tick that is currently allowed by the lockstep gate. */
  runAvailable(): void {
    while (this.core.turnComplete(turnOfTick(this.state.tick))) {
      const t = this.state.tick;
      const cmds = t % TICKS_PER_TURN === 0 ? this.core.commandsForTurn(turnOfTick(t)) : [];
      tick(this.state, cmds);
      this.core.noteExecuted(t);
      // Never run ahead of our own send frontier (mirrors the live pacing).
      if (turnOfTick(this.state.tick) >= this.sender.currentSendTurn()) break;
    }
  }
}

/** Delivers every queued message to the other peer (optionally dropping some). */
function exchange(a: SimClient, b: SimClient, drop: (msgIndex: number) => boolean = () => false): void {
  let i = 0;
  for (const msg of a.outbox) if (!drop(i++)) b.receive(msg);
  a.outbox.length = 0;
  for (const msg of b.outbox) if (!drop(i++)) a.receive(msg);
  b.outbox.length = 0;
}

describe('lockstep integration: two real sims over a simulated channel', () => {
  it('cross-client commands execute identically; hashes stay equal', () => {
    const seed = 424242;
    const a = new SimClient(seed, 0);
    const b = new SimClient(seed, 1);
    expect(hashState(a.state)).toBe(hashState(b.state)); // identical creation

    const tankB = b.state.units.find((u) => u.owner === 1 && u.type === 'TANK')!;

    for (let netTurn = 0; netTurn < 120; netTurn++) {
      // Boris orders a tank move on his client only — it must reach Anna's sim
      // through the frame stream, never directly.
      if (netTurn === 5) {
        b.issue({ type: 'MOVE', playerId: 1, unitIds: [tankB.id], cx: 30, cy: 30 });
      }
      // Anna attacks with her force a bit later.
      if (netTurn === 20) {
        const ids = a.state.units.filter((u) => u.owner === 0).map((u) => u.id);
        a.issue({ type: 'ATTACK_MOVE', playerId: 0, unitIds: ids, cx: 45, cy: 44 });
      }
      a.sendTurn();
      b.sendTurn();
      exchange(a, b);
      a.runAvailable();
      b.runAvailable();
    }

    expect(a.state.tick).toBeGreaterThan(300); // the lockstep actually ran
    expect(a.state.tick).toBe(b.state.tick);
    expect(hashState(a.state)).toBe(hashState(b.state));
    // Boris' tank moved on BOTH sims (command crossed the wire): well away
    // from its spawn (44,43) toward (30,30), byte-identical on both clients.
    const tankOnA = a.state.units.find((u) => u.id === tankB.id)!;
    const tankOnB = b.state.units.find((u) => u.id === tankB.id)!;
    expect([tankOnA.x, tankOnA.y]).toEqual([tankOnB.x, tankOnB.y]);
    const cx = Math.trunc(tankOnA.x / 256);
    const cy = Math.trunc(tankOnA.y / 256);
    expect(Math.hypot(cx - 44, cy - 43)).toBeGreaterThan(8); // left its spawn
    expect(Math.hypot(cx - 30, cy - 30)).toBeLessThan(4); // near the ordered cell
  });

  it('the 3-turn history heals single lost messages', () => {
    const seed = 777;
    const a = new SimClient(seed, 0);
    const b = new SimClient(seed, 1);
    let msgIndex = 0;
    for (let netTurn = 0; netTurn < 60; netTurn++) {
      if (netTurn === 3) b.issue({ type: 'CHEAT', playerId: 1, cheat: 'MONEY' });
      a.sendTurn();
      b.sendTurn();
      // Drop every 4th message — the trailing history must fill the gaps.
      exchange(a, b, () => msgIndex++ % 4 === 0);
      a.runAvailable();
      b.runAvailable();
    }
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.tick).toBeGreaterThan(150);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.state.players[1]!.credits).toBe(b.state.players[1]!.credits);
  });

  it('a drop injects SURRENDER deterministically on both clients', () => {
    const seed = 909;
    const a = new SimClient(seed, 0);
    const b = new SimClient(seed, 1);
    // 10 healthy turns, then Boris goes silent.
    for (let netTurn = 0; netTurn < 10; netTurn++) {
      a.sendTurn();
      b.sendTurn();
      exchange(a, b);
      a.runAvailable();
      b.runAvailable();
    }
    // Controller (seat 0) drops Boris; both clients apply the same fromTurn.
    const fromTurn = Math.max(a.core.newestFrameOf(1), INPUT_DELAY_TURNS - 1) + 3;
    a.core.drop(1, fromTurn);
    b.core.drop(1, fromTurn);
    for (let netTurn = 0; netTurn < 30; netTurn++) {
      a.sendTurn();
      b.sendTurn();
      exchange(a, b);
      a.runAvailable();
      b.runAvailable();
    }
    expect(a.state.tick).toBe(b.state.tick);
    expect(hashState(a.state)).toBe(hashState(b.state));
    expect(a.state.players[1]!.surrendered).toBe(true);
    expect(a.state.winner).toBe(0); // last live seat wins on both clients
    expect(b.state.winner).toBe(0);
  });
});
