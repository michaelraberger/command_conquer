import { describe, expect, it } from 'vitest';
import {
  MAX_FRAMES_PER_MSG,
  sanitizeControlMsg,
  sanitizeFrameMsg,
  validCommand,
} from '../src/net/validate.js';
import { LockstepScheduler, MAX_AHEAD_TURNS } from '../src/net/lockstepCore.js';

const SEATS = 2;

describe('validCommand', () => {
  it('accepts a well-formed MOVE', () => {
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: [1, 2], cx: 5, cy: 6 })).toBe(true);
  });

  it('rejects the historic crash vector: unitIds as a scalar', () => {
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: 1, cx: 5, cy: 6 })).toBe(false);
  });

  it('rejects oversized selections, floats, nested objects and junk', () => {
    const ids = Array.from({ length: 301 }, (_, i) => i);
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: ids, cx: 0, cy: 0 })).toBe(false);
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: [1.5], cx: 0, cy: 0 })).toBe(false);
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: [1], cx: 0.5, cy: 0 })).toBe(false);
    expect(validCommand({ type: 'MOVE', playerId: 0, unitIds: [1], cx: { evil: 1 } })).toBe(false);
    expect(validCommand({ playerId: 0 })).toBe(false); // no type
    expect(validCommand(null)).toBe(false);
    expect(validCommand([])).toBe(false);
  });
});

describe('sanitizeFrameMsg', () => {
  const frame = (turn: number) => ({ turn, cmds: [] });

  it('passes a well-formed message through', () => {
    const msg = sanitizeFrameMsg({ seat: 1, frames: [frame(2), frame(3)] }, SEATS);
    expect(msg).not.toBeNull();
    expect(msg!.frames.length).toBe(2);
  });

  it('rejects bad seats, non-array frames and oversized batches', () => {
    expect(sanitizeFrameMsg({ seat: 2, frames: [frame(2)] }, SEATS)).toBeNull();
    expect(sanitizeFrameMsg({ seat: -1, frames: [frame(2)] }, SEATS)).toBeNull();
    expect(sanitizeFrameMsg({ seat: 0, frames: 'x' }, SEATS)).toBeNull();
    const many = Array.from({ length: MAX_FRAMES_PER_MSG + 1 }, (_, i) => frame(i));
    expect(sanitizeFrameMsg({ seat: 0, frames: many }, SEATS)).toBeNull();
    expect(sanitizeFrameMsg({ seat: 0, frames: [{ turn: 1.5, cmds: [] }] }, SEATS)).toBeNull();
    expect(sanitizeFrameMsg(null, SEATS)).toBeNull();
  });

  it('rejects malformed hash riders', () => {
    expect(sanitizeFrameMsg({ seat: 0, frames: [], hashTurn: 50 }, SEATS)).toBeNull();
    expect(
      sanitizeFrameMsg({ seat: 0, frames: [], hashTurn: 50, hash: 'x'.repeat(20) }, SEATS),
    ).toBeNull();
    expect(
      sanitizeFrameMsg({ seat: 0, frames: [], hashTurn: 50, hash: 'a03f19c2' }, SEATS),
    ).not.toBeNull();
  });
});

describe('sanitizeControlMsg', () => {
  it('accepts the three kinds with sane fields', () => {
    expect(sanitizeControlMsg({ kind: 'abort', by: 0 }, SEATS)).not.toBeNull();
    expect(sanitizeControlMsg({ kind: 'drop', seat: 1, fromTurn: 10, by: 0 }, SEATS)).not.toBeNull();
    expect(
      sanitizeControlMsg({ kind: 'req', seat: 1, fromTurn: 10, toTurn: 20, by: 0 }, SEATS),
    ).not.toBeNull();
  });

  it('rejects unknown kinds, bad seats and absurd ranges', () => {
    expect(sanitizeControlMsg({ kind: 'nuke', by: 0 }, SEATS)).toBeNull();
    expect(sanitizeControlMsg({ kind: 'drop', seat: 9, fromTurn: 0, by: 0 }, SEATS)).toBeNull();
    expect(
      sanitizeControlMsg({ kind: 'req', seat: 0, fromTurn: 0, toTurn: 10_000, by: 0 }, SEATS),
    ).toBeNull();
    expect(
      sanitizeControlMsg({ kind: 'req', seat: 0, fromTurn: 20, toTurn: 10, by: 0 }, SEATS),
    ).toBeNull();
  });
});

describe('LockstepScheduler turn window', () => {
  it('drops non-integer and far-future turns instead of buffering them', () => {
    const s = new LockstepScheduler(2, 0);
    s.addFrame(1, { turn: 2.5, cmds: [] });
    s.addFrame(1, { turn: -3, cmds: [] });
    s.addFrame(1, { turn: MAX_AHEAD_TURNS + 1000, cmds: [] });
    expect(s.newestFrameOf(1)).toBe(-1);
    // A sane in-window turn still lands.
    s.addFrame(1, { turn: 5, cmds: [] });
    expect(s.newestFrameOf(1)).toBe(5);
  });
});
