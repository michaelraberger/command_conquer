/** Carrier for the sim PRNG state (lives on GameState so it hashes/replays). */
export interface RngCarrier {
  rngState: number;
}

/** mulberry32 step: returns a uint32 and advances the carried state. */
export function nextU32(s: RngCarrier): number {
  s.rngState = (s.rngState + 0x6d2b79f5) >>> 0;
  let t = s.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [0, maxExclusive). */
export function nextInt(s: RngCarrier, maxExclusive: number): number {
  return nextU32(s) % maxExclusive;
}
