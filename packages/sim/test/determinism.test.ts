import { describe, expect, it } from 'vitest';
import {
  createGame,
  deserialize,
  hashState,
  serialize,
  tick,
  type Command,
  type GameState,
} from '../src/index.js';

// Spawn order is deterministic, so the starting unit ids can be probed once.
const P0_IDS = createGame(1)
  .units.filter((u) => u.owner === 0)
  .map((u) => u.id);

/** A scripted "match": builds a base, harvests, assaults the enemy camp. */
function scriptedCommands(t: number): Command[] {
  switch (t) {
    case 5:
      return [{ type: 'MOVE', playerId: 0, unitIds: P0_IDS, cx: 40, cy: 24 }];
    case 10:
      return [{ type: 'BUILD_START', playerId: 0, item: 'POWER' }];
    case 100:
      return [{ type: 'PLACE_BUILDING', playerId: 0, cx: 17, cy: 17 }];
    case 120:
      return [{ type: 'BUILD_START', playerId: 0, item: 'BARRACKS' }];
    case 150:
      // Attack-move into the enemy camp at (46,46): chasing, firing,
      // projectiles, deaths and traffic jams all in one command. The
      // harvester in the group falls back to a plain move.
      return [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: P0_IDS, cx: 46, cy: 46 }];
    case 250:
      return [{ type: 'PLACE_BUILDING', playerId: 0, cx: 19, cy: 19 }];
    case 260:
      return [
        { type: 'BUILD_START', playerId: 0, item: 'RIFLEMAN' },
        { type: 'BUILD_START', playerId: 0, item: 'REFINERY' },
      ];
    case 400:
      return [
        { type: 'MOVE', playerId: 0, unitIds: P0_IDS.slice(0, 4), cx: 10, cy: 40 },
        { type: 'STOP', playerId: 0, unitIds: P0_IDS.slice(4) },
      ];
    case 470:
      return [{ type: 'PLACE_BUILDING', playerId: 0, cx: 13, cy: 19 }];
    default:
      return [];
  }
}

function runScripted(state: GameState, ticks: number, onCheckpoint?: (t: number) => void): void {
  for (let t = 0; t < ticks; t++) {
    tick(state, scriptedCommands(state.tick));
    if (onCheckpoint && state.tick % 50 === 0) onCheckpoint(state.tick);
  }
}

describe('determinism', () => {
  it('two sims with the same seed and commands stay hash-identical', () => {
    const a = createGame(1337);
    const b = createGame(1337);
    expect(hashState(a)).toBe(hashState(b));
    const startX = a.units[0]!.x;

    for (let t = 0; t < 900; t++) {
      tick(a, scriptedCommands(a.tick));
      tick(b, scriptedCommands(b.tick));
      if (a.tick % 50 === 0) {
        expect(hashState(a), `desync at tick ${a.tick}`).toBe(hashState(b));
      }
    }
    // Sanity: the script actually moved units, combat killed some, and the
    // economy ran — we didn't hash a no-op game.
    expect(a.units[0]!.x).not.toBe(startX);
    expect(a.units.length).toBeLessThan(21);
    expect(a.buildings.filter((b2) => b2.owner === 0).length).toBe(4);
    expect(a.players[0]!.credits).not.toBe(5000);
  });

  it('different seeds produce different states', () => {
    expect(hashState(createGame(1))).not.toBe(hashState(createGame(2)));
  });

  it('serialize/deserialize round-trip preserves state and future evolution', () => {
    const original = createGame(42);
    runScripted(original, 200);

    const restored = deserialize(serialize(original));
    expect(hashState(restored)).toBe(hashState(original));

    // The restored state must evolve identically, not just look identical.
    runScripted(original, 200);
    runScripted(restored, 200);
    expect(hashState(restored)).toBe(hashState(original));
  });
});
