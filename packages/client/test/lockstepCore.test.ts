import { describe, expect, it } from 'vitest';
import type { Command } from '@cac/sim';
import {
  FrameSender,
  HISTORY_TURNS,
  INPUT_DELAY_TURNS,
  LockstepScheduler,
  MAX_AHEAD_TURNS,
  TICKS_PER_TURN,
  firstTickOfTurn,
  turnOfTick,
} from '../src/net/lockstepCore.js';

const move = (playerId: number, cx = 1, cy = 1): Command => ({
  type: 'MOVE',
  playerId,
  unitIds: [1],
  cx,
  cy,
});

describe('turn math', () => {
  it('maps ticks to turns and back', () => {
    expect(turnOfTick(0)).toBe(0);
    expect(turnOfTick(TICKS_PER_TURN - 1)).toBe(0);
    expect(turnOfTick(TICKS_PER_TURN)).toBe(1);
    expect(firstTickOfTurn(5)).toBe(5 * TICKS_PER_TURN);
  });
});

describe('LockstepScheduler', () => {
  it('turns before the input delay are implicitly complete and empty', () => {
    const s = new LockstepScheduler(2, 0);
    for (let t = 0; t < INPUT_DELAY_TURNS; t++) {
      expect(s.turnComplete(t)).toBe(true);
      expect(s.commandsForTurn(t)).toEqual([]);
    }
    expect(s.turnComplete(INPUT_DELAY_TURNS)).toBe(false);
  });

  it('a turn completes only when every seat delivered its frame', () => {
    const s = new LockstepScheduler(3, 0);
    const t = INPUT_DELAY_TURNS;
    s.addFrame(0, { turn: t, cmds: [] });
    s.addFrame(1, { turn: t, cmds: [move(1)] });
    expect(s.turnComplete(t)).toBe(false);
    expect(s.missingSeats(t)).toEqual([2]);
    s.addFrame(2, { turn: t, cmds: [] });
    expect(s.turnComplete(t)).toBe(true);
    expect(s.missingSeats(t)).toEqual([]);
  });

  it('merges frames in ascending seat order and keeps sender order', () => {
    const s = new LockstepScheduler(3, 0);
    const t = INPUT_DELAY_TURNS;
    s.addFrame(2, { turn: t, cmds: [move(2, 9, 9)] });
    s.addFrame(0, { turn: t, cmds: [move(0, 1, 1), move(0, 2, 2)] });
    s.addFrame(1, { turn: t, cmds: [] });
    const merged = s.commandsForTurn(t);
    expect(merged.map((c) => c.playerId)).toEqual([0, 0, 2]);
    expect((merged[1] as { cx: number }).cx).toBe(2);
  });

  it('discards spoofed commands whose playerId is not the sender seat', () => {
    const s = new LockstepScheduler(2, 0);
    const t = INPUT_DELAY_TURNS;
    s.addFrame(1, { turn: t, cmds: [move(0, 5, 5), move(1, 6, 6)] });
    s.addFrame(0, { turn: t, cmds: [] });
    const merged = s.commandsForTurn(t);
    expect(merged.map((c) => c.playerId)).toEqual([1]);
  });

  it('ignores duplicate frames (first delivery wins)', () => {
    const s = new LockstepScheduler(2, 0);
    const t = INPUT_DELAY_TURNS;
    s.addFrame(1, { turn: t, cmds: [move(1, 1, 1)] });
    s.addFrame(1, { turn: t, cmds: [move(1, 9, 9)] });
    const merged = s.commandsForTurn(t);
    expect(merged.length).toBe(1);
    expect((merged[0] as { cx: number }).cx).toBe(1);
  });

  it('drop: later frames vanish, future turns count as present, SURRENDER runs once', () => {
    const s = new LockstepScheduler(2, 0);
    const dropTurn = INPUT_DELAY_TURNS + 2;
    s.addFrame(1, { turn: dropTurn, cmds: [move(1)] }); // arrives, then the drop invalidates it
    s.drop(1, dropTurn);
    expect(s.isDropped(1)).toBe(true);
    // The seat no longer blocks any turn.
    for (let t = INPUT_DELAY_TURNS; t < dropTurn + 5; t++) {
      s.addFrame(0, { turn: t, cmds: [] });
      expect(s.missingSeats(t)).toEqual([]);
    }
    // Its buffered frame at the drop turn was discarded; SURRENDER replaces it.
    const atDrop = s.commandsForTurn(dropTurn);
    expect(atDrop).toEqual([{ type: 'SURRENDER', playerId: 1 }]);
    // Only once — later turns stay empty for the seat.
    expect(s.commandsForTurn(dropTurn + 1)).toEqual([]);
    expect(s.commandsForTurn(dropTurn)).toEqual([]); // re-query does not re-inject
    // Frames arriving after the drop are ignored.
    s.addFrame(1, { turn: dropTurn + 2, cmds: [move(1)] });
    expect(s.commandsForTurn(dropTurn + 2)).toEqual([]);
  });

  it('controllerSeat is the lowest live seat (host succession)', () => {
    const s = new LockstepScheduler(3, 2);
    expect(s.controllerSeat()).toBe(0);
    s.drop(0, INPUT_DELAY_TURNS);
    expect(s.controllerSeat()).toBe(1);
    s.drop(1, INPUT_DELAY_TURNS);
    expect(s.controllerSeat()).toBe(2);
  });

  it('newestCompleteTurn walks the contiguous frontier', () => {
    const s = new LockstepScheduler(2, 0);
    expect(s.newestCompleteTurn()).toBe(INPUT_DELAY_TURNS - 1);
    const t0 = INPUT_DELAY_TURNS;
    for (const t of [t0, t0 + 1, t0 + 3]) {
      s.addFrame(0, { turn: t, cmds: [] });
      s.addFrame(1, { turn: t, cmds: [] });
    }
    expect(s.newestCompleteTurn()).toBe(t0 + 1); // gap at t0+2 stops the walk
  });

  it('prunes frames far behind the executed watermark', () => {
    const s = new LockstepScheduler(1, 0);
    const t0 = INPUT_DELAY_TURNS;
    for (let t = t0; t < t0 + 10; t++) s.addFrame(0, { turn: t, cmds: [move(0)] });
    s.noteExecuted(firstTickOfTurn(t0 + 9));
    expect(s.newestFrameOf(0)).toBe(t0 + 9);
    // Old turns beyond the history window were pruned (drop replays them as empty).
    expect(s.commandsForTurn(t0)).toEqual([]);
  });
});

describe('FrameSender', () => {
  it('starts at the input delay and grows a history window', () => {
    const f = new FrameSender(0);
    expect(f.currentSendTurn()).toBe(INPUT_DELAY_TURNS);
    const first = f.buildFrames([move(0)]);
    expect(first.map((x) => x.turn)).toEqual([INPUT_DELAY_TURNS]);
    f.buildFrames([]);
    f.buildFrames([move(0, 3, 3)]);
    const fourth = f.buildFrames([]);
    expect(fourth.length).toBe(HISTORY_TURNS);
    expect(fourth.map((x) => x.turn)).toEqual([
      INPUT_DELAY_TURNS + 1,
      INPUT_DELAY_TURNS + 2,
      INPUT_DELAY_TURNS + 3,
    ]);
    expect(fourth[1]!.cmds.length).toBe(1); // history carries the real commands
  });

  it('answers resend requests from its log', () => {
    const f = new FrameSender(0);
    f.buildFrames([move(0, 1, 1)]);
    f.buildFrames([move(0, 2, 2)]);
    const range = f.framesForRange(0, INPUT_DELAY_TURNS + 1);
    expect(range.map((x) => x.turn)).toEqual([INPUT_DELAY_TURNS, INPUT_DELAY_TURNS + 1]);
  });

  it('reports back-pressure when too far ahead', () => {
    const f = new FrameSender(0);
    for (let i = 0; i <= MAX_AHEAD_TURNS; i++) f.buildFrames([]);
    expect(f.tooFarAhead(INPUT_DELAY_TURNS - 1)).toBe(true);
    expect(f.tooFarAhead(INPUT_DELAY_TURNS + 5)).toBe(false);
  });
});
