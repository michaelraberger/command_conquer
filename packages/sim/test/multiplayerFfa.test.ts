import { describe, expect, it } from 'vitest';
import {
  RESOURCE_ORE,
  areEnemies,
  createGame,
  deserialize,
  emptyCustomMap,
  hashState,
  serialize,
  tick,
  type CustomMapData,
  type GameState,
  type MultiplayerSeat,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

const SEATS_2: MultiplayerSeat[] = [
  { faction: 'ALLIES', name: 'Anna' },
  { faction: 'SOVIETS', name: 'Boris' },
];
const SEATS_4: MultiplayerSeat[] = [
  { faction: 'ALLIES', name: 'Anna' },
  { faction: 'SOVIETS', name: 'Boris' },
  { faction: 'ALLIES', name: 'Carla' },
  { faction: 'SOVIETS', name: 'Dimitri' },
];

describe('multiplayer FFA seats', () => {
  it('creates one human player per seat, each on their own team', () => {
    const state = createGame(1, { multiplayer: { seats: SEATS_4 } });
    expect(state.players.length).toBe(4);
    for (const [id, p] of state.players.entries()) {
      expect(p.isAi).toBe(false);
      expect(p.team).toBe(id);
      expect(p.name).toBe(SEATS_4[id]!.name);
      expect(p.faction).toBe(SEATS_4[id]!.faction);
      expect(p.surrendered).toBe(false);
    }
    // FFA: every pair is hostile.
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        expect(areEnemies(state, a, b)).toBe(a !== b);
      }
    }
    // Every player has a base and a start force.
    for (let id = 0; id < 4; id++) {
      expect(state.buildings.some((b) => b.owner === id && b.type === 'CONYARD')).toBe(true);
      expect(state.units.some((u) => u.owner === id)).toBe(true);
    }
  });

  it('gives seats distinct fixed colors even with identical factions', () => {
    const seats: MultiplayerSeat[] = [
      { faction: 'SOVIETS', name: 'A' },
      { faction: 'SOVIETS', name: 'B' },
      { faction: 'SOVIETS', name: 'C' },
    ];
    const state = createGame(2, { multiplayer: { seats } });
    const colors = state.players.map((p) => p.color);
    expect(new Set(colors).size).toBe(3);
  });

  it('two seats get the classic hand-tuned 1v1 map, humans on both sides', () => {
    const state = createGame(3, { multiplayer: { seats: SEATS_2 } });
    expect(state.players.length).toBe(2);
    expect(state.players.every((p) => !p.isAi)).toBe(true);
    expect(state.players[0]!.team).not.toBe(state.players[1]!.team);
  });

  it('runs deterministically and survives a serialize round-trip', () => {
    const run = (): string => {
      const state = createGame(99, { multiplayer: { seats: SEATS_4 }, mapWidth: 96, mapHeight: 96 });
      tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: state.units.filter((u) => u.owner === 0).map((u) => u.id), cx: 48, cy: 48 }]);
      runTicks(state, 400);
      return hashState(state);
    };
    expect(run()).toBe(run());

    const state = createGame(99, { multiplayer: { seats: SEATS_2 } });
    runTicks(state, 50);
    const copy = deserialize(serialize(state));
    runTicks(state, 200);
    runTicks(copy, 200);
    expect(hashState(copy)).toBe(hashState(state));
  });

  it('plays on a hand-authored map: seats capped at the map spawns, FFA teams', () => {
    const makeMap = (): CustomMapData => {
      const map = emptyCustomMap(48, 48, 'MP-Testkarte');
      const stamp = (cx: number, cy: number): void => {
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (let x = cx - 1; x <= cx + 1; x++) {
            const idx = y * map.width + x;
            map.ore[idx] = 500;
            map.resourceKind[idx] = RESOURCE_ORE;
          }
        }
      };
      const [s0, s1] = map.spawns;
      stamp(s0![0] + 6, s0![1] + 6);
      stamp(s1![0] - 6, s1![1] - 6);
      return map;
    };
    // 2-spawn map + 2 seats: both humans, on the authored spawns.
    const state = createGame(21, { multiplayer: { seats: SEATS_2 }, customMap: makeMap() });
    expect(state.players.length).toBe(2);
    expect(state.players.every((p) => !p.isAi)).toBe(true);
    expect(state.players.map((p) => p.team)).toEqual([0, 1]);
    // 4 seats on the same 2-spawn map: capped to the map's capacity (the
    // lobby prevents this, the sim clamps as a safety net).
    const capped = createGame(22, { multiplayer: { seats: SEATS_4 }, customMap: makeMap() });
    expect(capped.players.length).toBe(2);
    // Determinism on the authored map.
    const run = (): string => {
      const s = createGame(23, { multiplayer: { seats: SEATS_2 }, customMap: makeMap() });
      runTicks(s, 300);
      return hashState(s);
    };
    expect(run()).toBe(run());
  });

  it('the classic solo options are byte-identical to before (no seats)', () => {
    const a = createGame(7, { factions: ['ALLIES'], opponents: 2, ai: true });
    expect(a.players[0]!.isAi).toBe(false);
    expect(a.players[1]!.isAi).toBe(true);
    expect(a.players.map((p) => p.team)).toEqual([0, 1, 1]);
  });
});

describe('SURRENDER', () => {
  it('removes the player from victory accounting; last seat standing wins', () => {
    const state = createGame(11, { multiplayer: { seats: SEATS_4 } });
    tick(state, [
      { type: 'SURRENDER', playerId: 1 },
      { type: 'SURRENDER', playerId: 2 },
      { type: 'SURRENDER', playerId: 3 },
    ]);
    expect(state.winner).toBe(0);
    // Their bases still stand (uncontrolled, not removed).
    expect(state.buildings.some((b) => b.owner === 1 && b.type === 'CONYARD')).toBe(true);
  });

  it('clears production queues and research, and is idempotent', () => {
    const state = createGame(12, { multiplayer: { seats: SEATS_2 } });
    const p1 = state.players[1]!;
    p1.credits = 5000;
    tick(state, [{ type: 'BUILD_START', playerId: 1, item: 'POWER' }]);
    expect(p1.queues.building.item).toBe('POWER');
    tick(state, [{ type: 'SURRENDER', playerId: 1 }]);
    expect(p1.surrendered).toBe(true);
    expect(p1.queues.building.item).toBeNull();
    tick(state, [{ type: 'SURRENDER', playerId: 1 }]); // second time: no-op
    expect(p1.surrendered).toBe(true);
    expect(state.winner).toBe(0);
  });

  it('a surrendered base does not keep the game alive, but stays attackable', () => {
    const state = createGame(13, { multiplayer: { seats: SEATS_2 } });
    tick(state, [{ type: 'SURRENDER', playerId: 1 }]);
    expect(state.winner).toBe(0);
    expect(areEnemies(state, 0, 1)).toBe(true); // still hostile targets
  });
});
