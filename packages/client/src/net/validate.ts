import type { Command } from '@cac/sim';
import { HISTORY_TURNS, MAX_TURNS_PER_SEND, type TurnFrame } from './lockstepCore.js';

/**
 * Schema validation for everything that arrives over the Realtime channels.
 * Broadcast payloads are attacker-controlled: a single malformed command
 * (e.g. `unitIds: 1` instead of an array) used to throw INSIDE tick() and
 * froze the match for every peer, and unbounded turn numbers grew the frame
 * buffers forever. Everything here rejects instead of trusting.
 *
 * Deliberately structural, not semantic: ownership, prerequisites and game
 * rules are enforced by the sim itself (ownedUnits, per-command checks) —
 * identically on every client, so the merge stays deterministic.
 */

/** A frame message may carry one catch-up batch plus its healing window. */
export const MAX_FRAMES_PER_MSG = MAX_TURNS_PER_SEND + HISTORY_TURNS;
/** Commands one seat may issue per net turn (a human issues a handful). */
export const MAX_CMDS_PER_TURN = 64;
/** Selection size cap per command (the UI cannot select more anyway). */
export const MAX_IDS_PER_CMD = 300;
/** Hard ceiling for turn numbers (~15 days of continuous play). */
export const MAX_TURN = 10_000_000;

export interface FrameMsgShape {
  seat: number;
  frames: TurnFrame[];
  hashTurn?: number;
  hash?: string;
}

export type ControlMsgShape =
  | { kind: 'drop'; seat: number; fromTurn: number; by: number }
  | { kind: 'abort'; by: number }
  | { kind: 'req'; seat: number; fromTurn: number; toTurn: number; by: number };

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isSeat(v: unknown, seatCount: number): v is number {
  return isInt(v) && v >= 0 && v < seatCount;
}

function isTurn(v: unknown): v is number {
  return isInt(v) && v >= 0 && v <= MAX_TURN;
}

/**
 * Structural command check. Generic over the ~30 command variants: `type` and
 * `playerId` are mandatory; `unitIds` must be a bounded integer array (the
 * historic crash vector); every other field must be a bounded int, short
 * string or boolean — no nested objects, no floats, no surprises.
 */
export function validCommand(raw: unknown): raw is Command {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const cmd = raw as Record<string, unknown>;
  if (typeof cmd.type !== 'string' || cmd.type.length === 0 || cmd.type.length > 32) return false;
  if (!isInt(cmd.playerId)) return false;
  for (const [key, value] of Object.entries(cmd)) {
    if (key === 'unitIds') {
      if (!Array.isArray(value) || value.length > MAX_IDS_PER_CMD || !value.every(isInt)) {
        return false;
      }
    } else if (typeof value === 'number') {
      if (!Number.isInteger(value) || Math.abs(value) > 0x7fffffff) return false;
    } else if (typeof value === 'string') {
      if (value.length > 64) return false;
    } else if (typeof value !== 'boolean') {
      return false;
    }
  }
  return true;
}

function validFrame(raw: unknown): raw is TurnFrame {
  if (typeof raw !== 'object' || raw === null) return false;
  const frame = raw as Record<string, unknown>;
  if (!isTurn(frame.turn)) return false;
  if (!Array.isArray(frame.cmds) || frame.cmds.length > MAX_CMDS_PER_TURN) return false;
  return frame.cmds.every(validCommand);
}

/** Frame broadcast → typed message, or null when anything is off. */
export function sanitizeFrameMsg(payload: unknown, seatCount: number): FrameMsgShape | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const msg = payload as Record<string, unknown>;
  if (!isSeat(msg.seat, seatCount)) return null;
  if (!Array.isArray(msg.frames) || msg.frames.length > MAX_FRAMES_PER_MSG) return null;
  if (!msg.frames.every(validFrame)) return null;
  const out: FrameMsgShape = { seat: msg.seat, frames: msg.frames as TurnFrame[] };
  if (msg.hashTurn !== undefined || msg.hash !== undefined) {
    if (!isTurn(msg.hashTurn) || typeof msg.hash !== 'string' || msg.hash.length > 16) return null;
    out.hashTurn = msg.hashTurn;
    out.hash = msg.hash;
  }
  return out;
}

/** Control broadcast → typed message, or null when anything is off. */
export function sanitizeControlMsg(payload: unknown, seatCount: number): ControlMsgShape | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const msg = payload as Record<string, unknown>;
  if (!isSeat(msg.by, seatCount)) return null;
  if (msg.kind === 'abort') return { kind: 'abort', by: msg.by };
  if (msg.kind === 'drop') {
    if (!isSeat(msg.seat, seatCount) || !isTurn(msg.fromTurn)) return null;
    return { kind: 'drop', seat: msg.seat, fromTurn: msg.fromTurn, by: msg.by };
  }
  if (msg.kind === 'req') {
    if (!isSeat(msg.seat, seatCount) || !isTurn(msg.fromTurn) || !isTurn(msg.toTurn)) return null;
    if (msg.toTurn < msg.fromTurn || msg.toTurn - msg.fromTurn > MAX_FRAMES_PER_MSG) return null;
    return { kind: 'req', seat: msg.seat, fromTurn: msg.fromTurn, toTurn: msg.toTurn, by: msg.by };
  }
  return null;
}
