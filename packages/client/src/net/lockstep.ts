import {
  HASH_INTERVAL_TICKS,
  INPUT_DELAY_TICKS,
  hashState,
  type Command,
  type GameState,
} from '@cac/sim';
import { drainCommands } from '../commandQueue.js';
import type { TickDriver } from '../loop.js';
import type { Connection } from './connection.js';

/**
 * Deterministic lockstep: local input issued during tick T executes at
 * T + INPUT_DELAY on every client. The sim only advances once BOTH players'
 * command sets for the next tick have arrived (the server echoes our own
 * back, so one code path handles both). Stalls appear as a short freeze —
 * the classic "waiting for player".
 */
export class LockstepDriver implements TickDriver {
  /** tick → playerId → commands. */
  private buffers = new Map<number, Map<number, Command[]>>();

  constructor(
    private conn: Connection,
    private playerCount = 2,
  ) {
    conn.onMessage((msg) => {
      if (msg.t !== 'batch') return;
      let perPlayer = this.buffers.get(msg.tick);
      if (!perPlayer) {
        perPlayer = new Map();
        this.buffers.set(msg.tick, perPlayer);
      }
      perPlayer.set(msg.playerId, msg.cmds);
    });
  }

  canTick(nextTick: number): boolean {
    if (nextTick < INPUT_DELAY_TICKS) return true; // pre-delay ticks are empty
    return (this.buffers.get(nextTick)?.size ?? 0) >= this.playerCount;
  }

  commandsFor(nextTick: number): Command[] {
    // Ship local input scheduled for the future first (empty = heartbeat).
    this.conn.send({ t: 'cmds', tick: nextTick + INPUT_DELAY_TICKS, cmds: drainCommands() });

    if (nextTick < INPUT_DELAY_TICKS) return [];
    const perPlayer = this.buffers.get(nextTick)!;
    this.buffers.delete(nextTick);
    const merged: Command[] = [];
    for (const playerId of [...perPlayer.keys()].sort((a, b) => a - b)) {
      merged.push(...perPlayer.get(playerId)!);
    }
    return merged;
  }

  onTicked(state: GameState): void {
    if (state.tick % HASH_INTERVAL_TICKS === 0) {
      this.conn.send({ t: 'hash', tick: state.tick, hash: hashState(state) });
    }
  }
}
