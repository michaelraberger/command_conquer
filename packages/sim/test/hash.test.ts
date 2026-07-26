import { describe, expect, it } from 'vitest';
import { createGame, deserialize, hashState, serialize, tick } from '../src/index.js';

/** The fast grid-walking hash must keep the properties the lockstep
 *  desync check and the save round-trip rely on. */
describe('hashState', () => {
  it('is stable across a serialize/deserialize round-trip', () => {
    const state = createGame(7, { ai: true, aiDifficulty: 'hard' });
    for (let i = 0; i < 300; i++) tick(state);
    expect(hashState(deserialize(serialize(state)))).toBe(hashState(state));
  });

  it('reacts to entity changes and to grid changes', () => {
    const state = createGame(7);
    const base = hashState(state);

    state.players[0]!.credits += 1;
    const entityChanged = hashState(state);
    expect(entityChanged).not.toBe(base);
    state.players[0]!.credits -= 1;
    expect(hashState(state)).toBe(base);

    state.terrain[0] = (state.terrain[0]! + 1) % 5;
    expect(hashState(state)).not.toBe(base);
  });

  it('distinguishes per-player fog grids', () => {
    const state = createGame(7);
    const base = hashState(state);
    state.fogs[1]![0] = state.fogs[1]![0] === 0 ? 1 : 0;
    expect(hashState(state)).not.toBe(base);
  });
});
