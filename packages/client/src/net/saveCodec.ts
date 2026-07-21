import { serialize, type GameState } from '@cac/sim';

/**
 * Save-blob envelope: since v2 the (pre-gzip) payload carries client-side
 * extras next to the sim state — currently the control groups, which are
 * deliberately NOT part of GameState (selection never enters the sim).
 * Legacy blobs are the bare serialized state; the prefix check keeps them
 * loading forever. No DB migration needed — same `data` column.
 */
const ENVELOPE_PREFIX = '{"v":2,';

export interface SaveBlob {
  /** JSON for @cac/sim deserialize(). */
  stateJson: string;
  /** Control groups (digit → unit ids); empty for legacy saves. */
  groups: Record<string, number[]>;
}

/** Builds the pre-gzip payload. The state JSON is spliced in verbatim —
 *  no double stringify of a multi-megabyte string. */
export function encodeSavePayload(state: GameState, groups: Record<number, number[]>): string {
  return `{"v":2,"groups":${JSON.stringify(groups)},"state":${serialize(state)}}`;
}

/** Splits a decompressed blob into state JSON + extras (legacy-tolerant). */
export function decodeSavePayload(text: string): SaveBlob {
  if (text.startsWith(ENVELOPE_PREFIX)) {
    const env = JSON.parse(text) as { groups?: Record<string, number[]>; state: unknown };
    return { stateJson: JSON.stringify(env.state), groups: env.groups ?? {} };
  }
  return { stateJson: text, groups: {} };
}
