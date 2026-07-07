import type { AiDifficulty, BalanceConfig, Command, Faction, GameState, MapType } from '@cac/sim';
import { drainCommands } from './commandQueue.js';
import type { TickDriver } from './loop.js';

/**
 * Replays are the payoff of the deterministic sim: seed + options + the full
 * command log reproduce an entire match bit-for-bit.
 */
export interface ReplayFile {
  version: 1;
  seed: number;
  options: {
    factions: [Faction, Faction];
    ai: boolean;
    aiDifficulty: AiDifficulty;
    /** Older replays omit this; createGame defaults to BADLANDS. */
    mapType?: MapType;
    /** Balance overrides active during the recording (default rules if absent). */
    balance?: BalanceConfig | undefined;
  };
  commands: Array<{ tick: number; cmds: Command[] }>;
}

export class Recorder {
  private entries: Array<{ tick: number; cmds: Command[] }> = [];

  constructor(
    private seed: number,
    private options: ReplayFile['options'],
  ) {}

  record(tick: number, cmds: Command[]): void {
    if (cmds.length > 0) this.entries.push({ tick, cmds });
  }

  toFile(): ReplayFile {
    return { version: 1, seed: this.seed, options: this.options, commands: this.entries };
  }

  /** Browser download as cac-replay-<seed>.json. */
  download(): void {
    const blob = new Blob([JSON.stringify(this.toFile())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cac-replay-${this.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** Local driver that also feeds the recorder. */
export class RecordingDriver implements TickDriver {
  constructor(private recorder: Recorder) {}

  canTick(): boolean {
    return true;
  }

  commandsFor(nextTick: number): Command[] {
    const cmds = drainCommands();
    this.recorder.record(nextTick, cmds);
    return cmds;
  }

  onTicked(): void {}
}

/** Plays a recorded command log back; live input is drained and discarded. */
export class ReplayDriver implements TickDriver {
  private byTick = new Map<number, Command[]>();

  constructor(replay: ReplayFile) {
    for (const entry of replay.commands) {
      const existing = this.byTick.get(entry.tick);
      if (existing) existing.push(...entry.cmds);
      else this.byTick.set(entry.tick, [...entry.cmds]);
    }
  }

  canTick(): boolean {
    return true;
  }

  commandsFor(nextTick: number): Command[] {
    drainCommands(); // swallow live input — the log is the only source
    return this.byTick.get(nextTick) ?? [];
  }

  onTicked(_state: GameState): void {}
}

export function parseReplay(json: string): ReplayFile {
  const file = JSON.parse(json) as ReplayFile;
  if (file.version !== 1 || typeof file.seed !== 'number' || !Array.isArray(file.commands)) {
    throw new Error('Keine gültige Replay-Datei');
  }
  return file;
}
