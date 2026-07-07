import type { Command } from '@cac/sim';

/**
 * Local command buffer between input handlers and the sim tick. In
 * multiplayer this becomes the outbox toward the lockstep relay.
 */
const pending: Command[] = [];

export function sendCommand(cmd: Command): void {
  pending.push(cmd);
}

export function drainCommands(): Command[] {
  return pending.splice(0, pending.length);
}
