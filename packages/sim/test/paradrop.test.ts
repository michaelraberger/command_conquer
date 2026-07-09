import { describe, expect, it } from 'vitest';
import {
  PARADROP_COOLDOWN_TICKS,
  PARADROP_COUNTS,
  PARADROP_DROP_RADIUS,
  TERRAIN_WATER,
  cellIndex,
  constructBuilding,
  createGame,
  deserialize,
  hashState,
  serialize,
  tick,
  unitRule,
  type GameState,
  type Unit,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Bare battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7, factions?: ['ALLIES' | 'SOVIETS', 'ALLIES' | 'SOVIETS']): GameState {
  const state = createGame(seed, factions ? { factions } : undefined);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** Flugplatz + ready cooldown for player 0. */
function readyParadrop(state: GameState): void {
  constructBuilding(state, 'HELIPAD', 0, 9, 5);
  state.players[0]!.paradropCooldown = 0;
}

function plane(state: GameState): Unit | undefined {
  return state.units.find((u) => u.type === 'PARAPLANE');
}

function riflemen(state: GameState, owner: number): number {
  return state.units.filter((u) => u.owner === owner && u.type === 'RIFLEMAN').length;
}

/** Fire at (cx,cy) and run until the drop happened (plane turned around). */
function fireAndDrop(state: GameState, cx: number, cy: number): void {
  tick(state, [{ type: 'PARADROP', playerId: 0, cx, cy }]);
  for (let i = 0; i < 600; i++) {
    const p = plane(state);
    if (!p || p.order === null) break; // dropped (outbound) or despawned
    tick(state);
  }
  tick(state); // let landed troopers settle one tick
}

describe('paradrop support power', () => {
  it('PARAPLANE is a hidden, unarmed, factionless aircraft', () => {
    const rule = unitRule('PARAPLANE');
    expect(rule.air).toBe(true);
    expect(rule.weapon).toBeNull();
    expect(rule.hidden).toBe(true);
    expect(rule.factions).toBeNull();
    expect(PARADROP_COOLDOWN_TICKS).toBe(3600);
    expect(PARADROP_COUNTS).toEqual({ ALLIES: 6, SOVIETS: 9 });
  });

  it('is refused without a Flugplatz', () => {
    const state = arena();
    state.players[0]!.paradropCooldown = 0;
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
    expect(plane(state)).toBeUndefined();
    expect(state.players[0]!.paradropCooldown).toBe(0); // not consumed
  });

  it('is refused while the cooldown is still charging', () => {
    const state = arena();
    constructBuilding(state, 'HELIPAD', 0, 9, 5);
    state.players[0]!.paradropCooldown = 10;
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
    expect(plane(state)).toBeUndefined();
  });

  it('charges only while a Flugplatz stands, and two do not stack', () => {
    const state = arena();
    runTicks(state, 50);
    expect(state.players[0]!.paradropCooldown).toBe(PARADROP_COOLDOWN_TICKS); // no airfield

    constructBuilding(state, 'HELIPAD', 0, 9, 5);
    constructBuilding(state, 'HELIPAD', 0, 13, 5); // second one must not stack
    runTicks(state, 100);
    expect(state.players[0]!.paradropCooldown).toBe(PARADROP_COOLDOWN_TICKS - 100);
  });

  it('firing resets the cooldown and launches a loaded plane', () => {
    const state = arena();
    readyParadrop(state);
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
    const p = plane(state)!;
    expect(p).toBeDefined();
    expect(p.passengers.length).toBe(PARADROP_COUNTS.ALLIES);
    // Reset, then already recharging (HELIPAD stands): one tick elapsed.
    expect(state.players[0]!.paradropCooldown).toBe(PARADROP_COOLDOWN_TICKS - 1);
  });

  it('drops 6 riflemen for the Allies near the target', () => {
    const state = arena(7, ['ALLIES', 'SOVIETS']);
    readyParadrop(state);
    fireAndDrop(state, 30, 30);
    expect(riflemen(state, 0)).toBe(6);
    // All landed within the drop radius, on their own occupied cells.
    for (const u of state.units.filter((x) => x.type === 'RIFLEMAN')) {
      const cx = u.cell % state.mapWidth;
      const cy = Math.floor(u.cell / state.mapWidth);
      expect(Math.max(Math.abs(cx - 30), Math.abs(cy - 30))).toBeLessThanOrEqual(
        PARADROP_DROP_RADIUS,
      );
      expect(state.occupancy[u.cell]).toBe(u.id);
    }
  });

  it('drops 9 riflemen for the Soviets', () => {
    const state = arena(8, ['SOVIETS', 'ALLIES']);
    readyParadrop(state);
    fireAndDrop(state, 30, 30);
    expect(riflemen(state, 0)).toBe(9);
  });

  it('the plane flies out and despawns without a death explosion', () => {
    const state = arena();
    readyParadrop(state);
    fireAndDrop(state, 30, 30);
    let sawDeathEvent = false;
    for (let i = 0; i < 900 && plane(state); i++) {
      tick(state);
      if (state.events.some((e) => e.type === 'DEATH')) sawDeathEvent = true;
    }
    expect(plane(state)).toBeUndefined(); // gone at the far edge
    expect(sawDeathEvent).toBe(false);
    expect(riflemen(state, 0)).toBe(6); // troopers stayed
  });

  it('shooting the plane down loses the whole squad', () => {
    const state = arena();
    readyParadrop(state);
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
    plane(state)!.hp = 0; // flak got it
    runTicks(state, 5);
    expect(plane(state)).toBeUndefined();
    expect(riflemen(state, 0)).toBe(0); // paratroopers died silently aboard
  });

  it('a water target drops nobody — the squad is lost with the plane', () => {
    const state = arena();
    readyParadrop(state);
    // Paint a lake bigger than the drop radius around the target.
    for (let cy = 26; cy <= 34; cy++)
      for (let cx = 26; cx <= 34; cx++)
        state.terrain[cellIndex(state, cx, cy)] = TERRAIN_WATER;
    fireAndDrop(state, 30, 30);
    expect(riflemen(state, 0)).toBe(0);
    expect(plane(state)!.passengers.length).toBe(6); // still aboard, flying home
  });

  it('the plane ignores every player command', () => {
    const state = arena();
    readyParadrop(state);
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 55, cy: 30 }]);
    const p = plane(state)!;
    const pathBefore = JSON.stringify(p.path);
    tick(state, [{ type: 'MOVE', playerId: 0, unitIds: [p.id], cx: 5, cy: 5 }]);
    expect(JSON.stringify(p.path)).toBe(pathBefore); // command bounced off
    expect(p.order?.kind).toBe('PARADROP');
  });

  it('replays deterministically and survives a serialize round-trip mid-flight', () => {
    const run = (): string => {
      const state = arena(42);
      readyParadrop(state);
      tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
      runTicks(state, 200);
      return hashState(state);
    };
    expect(run()).toBe(run());

    const state = arena(42);
    readyParadrop(state);
    tick(state, [{ type: 'PARADROP', playerId: 0, cx: 30, cy: 30 }]);
    runTicks(state, 10); // mid-flight, passengers aboard
    const copy = deserialize(serialize(state));
    runTicks(state, 300);
    runTicks(copy, 300);
    expect(hashState(copy)).toBe(hashState(state)); // passengers + cooldown survive JSON
  });

  it('the AI fires the paradrop once charged', () => {
    const state = createGame(5, { ai: true, aiDifficulty: 'hard' });
    const ai = state.players[1]!;
    constructBuilding(state, 'HELIPAD', 1, 45, 40);
    ai.paradropCooldown = 0;
    ai.aiLastAttackTick = 0;
    // Past the grace period the AI drops on its raid target.
    state.tick = 20 * 60 * 15;
    for (let i = 0; i < 40 && !plane(state); i++) tick(state);
    expect(plane(state)?.owner).toBe(1);
  });
});
