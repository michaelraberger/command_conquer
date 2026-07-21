import { describe, expect, it } from 'vitest';
import { createGame, deserialize, hashState, serialize } from '@cac/sim';
import { decodeSavePayload, encodeSavePayload } from '../src/net/saveCodec.js';

describe('save-blob envelope (v2)', () => {
  it('round-trips state AND control groups', () => {
    const state = createGame(7);
    const groups = { 1: [4, 5], 7: [9] };
    const payload = encodeSavePayload(state, groups);
    const blob = decodeSavePayload(payload);
    expect(blob.groups).toEqual({ 1: [4, 5], 7: [9] });
    const restored = deserialize(blob.stateJson);
    expect(hashState(restored)).toBe(hashState(state));
  });

  it('still loads legacy blobs (bare serialized state, no envelope)', () => {
    const state = createGame(7);
    const blob = decodeSavePayload(serialize(state));
    expect(blob.groups).toEqual({});
    const restored = deserialize(blob.stateJson);
    expect(hashState(restored)).toBe(hashState(state));
  });

  it('empty groups survive the envelope', () => {
    const state = createGame(7);
    const blob = decodeSavePayload(encodeSavePayload(state, {}));
    expect(blob.groups).toEqual({});
    expect(hashState(deserialize(blob.stateJson))).toBe(hashState(state));
  });
});
