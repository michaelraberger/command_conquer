import type { Command } from './commands.js';
import type { MapType } from './map.js';
import type { BalanceConfig, Faction } from './rules.js';

/**
 * Lockstep wire protocol (JSON over WebSocket). Pure types — shared between
 * @cac/client and @cac/server via this dependency-free package.
 */
export const INPUT_DELAY_TICKS = 3;
export const HASH_INTERVAL_TICKS = 100;
export const DEFAULT_SERVER_PORT = 8787;

export type ClientMessage =
  | { t: 'host'; faction: Faction; mapType: MapType; balance?: BalanceConfig | undefined }
  | { t: 'join'; code: string; faction: Faction }
  | { t: 'cmds'; tick: number; cmds: Command[] }
  | { t: 'hash'; tick: number; hash: string };

export type ServerMessage =
  | { t: 'hosted'; code: string }
  | {
      t: 'start';
      seed: number;
      playerId: number;
      factions: [Faction, Faction];
      mapType: MapType;
      /** Host's balance config — guests must apply the identical rules. */
      balance?: BalanceConfig | undefined;
    }
  | { t: 'batch'; tick: number; playerId: number; cmds: Command[] }
  | { t: 'desync'; tick: number }
  | { t: 'left' }
  | { t: 'error'; msg: string };
