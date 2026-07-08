import { describe, expect, it } from 'vitest';
import {
  cellCenter,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
} from '../src/index.js';

/** Fresh battlefield: armies/buildings removed, spawn area (12..20)² is grass. */
function emptyBattlefield(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  return state;
}

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

describe('combat', () => {
  it('ATTACK chases an out-of-range target, kills it and frees its cell', () => {
    const state = emptyBattlefield();
    const tank = spawnUnit(state, 'TANK', 0, 13, 13);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 20, 20); // ~10 cells away
    const victimCell = victim.cell;

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: victim.id }]);
    let sawDeath = false;
    for (let i = 0; i < 300 && state.units.length > 1; i++) {
      tick(state);
      if (state.events.some((e) => e.type === 'DEATH')) sawDeath = true;
    }

    expect(state.units.map((u) => u.id)).toEqual([tank.id]);
    expect(sawDeath).toBe(true);
    expect(state.occupancy[victimCell]).toBe(0);
    runTicks(state, 2);
    expect(state.units[0]!.order).toBeNull();
  });

  it('applies warhead-vs-armor multipliers (rifle scratches heavy armor)', () => {
    const state = emptyBattlefield();
    spawnUnit(state, 'RIFLEMAN', 0, 14, 14);
    const tank = spawnUnit(state, 'TANK', 1, 16, 14); // 2 cells, in rifle range

    tick(state); // rifle is hitscan → damage lands this tick
    const weapon = unitRule('RIFLEMAN').weapon!;
    const expected = Math.trunc((weapon.damage * weapon.vs.heavy) / 100);
    expect(tank.hp).toBe(unitRule('TANK').maxHp - expected);
    expect(expected).toBeLessThan(weapon.damage); // multiplier actually reduced it
  });

  it('idle units guard: acquire nearest enemy, ties broken by lower id', () => {
    const state = emptyBattlefield();
    spawnUnit(state, 'TANK', 0, 14, 14);
    const a = spawnUnit(state, 'RIFLEMAN', 1, 14, 17); // 3 cells south
    const b = spawnUnit(state, 'RIFLEMAN', 1, 17, 14); // 3 cells east — same distance
    expect(a.id).toBeLessThan(b.id);

    tick(state);
    expect(state.projectiles.length).toBe(1);
    expect(state.projectiles[0]!.targetId).toBe(a.id);
  });

  it('does not fire at friends or beyond weapon range', () => {
    const state = emptyBattlefield();
    const tank = spawnUnit(state, 'TANK', 0, 13, 13);
    spawnUnit(state, 'RIFLEMAN', 0, 14, 13); // friend right next to it
    spawnUnit(state, 'RIFLEMAN', 1, 20, 20); // enemy far out of range

    runTicks(state, 5);
    expect(state.projectiles.length).toBe(0);
    expect(tank.cooldown).toBe(0);
  });

  it('idle units auto-defend: step toward a nearby attacker out of range', () => {
    const state = emptyBattlefield();
    const tank = spawnUnit(state, 'TANK', 0, 13, 13);
    const enemy = spawnUnit(state, 'RIFLEMAN', 1, 13, 20); // 7 cells: in guard, out of range
    const startCell = tank.cell;

    runTicks(state, 120);
    const enemyGone = !state.units.some((u) => u.id === enemy.id);
    expect(enemyGone || enemy.hp < unitRule('RIFLEMAN').maxHp).toBe(true); // engaged it
    expect(state.units.find((u) => u.id === tank.id)!.cell).not.toBe(startCell); // moved to defend
  });

  it('idle units stay put for enemies beyond the guard radius', () => {
    const state = emptyBattlefield();
    const tank = spawnUnit(state, 'TANK', 0, 13, 13);
    const startCell = tank.cell;
    spawnUnit(state, 'RIFLEMAN', 1, 13, 30); // 17 cells away — well beyond guard

    runTicks(state, 40);
    expect(tank.cell).toBe(startCell); // held its post
    expect(tank.order).toBeNull();
  });

  it('ATTACK_MOVE halts to fight, then resumes and clears the order', () => {
    const state = emptyBattlefield();
    const tank = spawnUnit(state, 'TANK', 0, 13, 14);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 17, 14);

    tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [tank.id], cx: 20, cy: 14 }]);
    for (let i = 0; i < 300 && (state.units.length > 1 || tank.order !== null); i++) {
      tick(state);
    }

    expect(state.units.map((u) => u.id)).toEqual([tank.id]);
    expect(victim.hp).toBeLessThanOrEqual(0);
    expect(tank.order).toBeNull();
    // Ended on/next to the ordered cell.
    const cx = tank.cell % state.mapWidth;
    const cy = (tank.cell - cx) / state.mapWidth;
    expect(Math.max(Math.abs(cx - 20), Math.abs(cy - 14))).toBeLessThanOrEqual(1);
    expect(tank.x).toBe(cellCenter(cx));
    expect(tank.y).toBe(cellCenter(cy));
  });

  it('projectiles fizzle when their target dies mid-flight', () => {
    const state = emptyBattlefield();
    spawnUnit(state, 'TANK', 0, 13, 14);
    const victim = spawnUnit(state, 'RIFLEMAN', 1, 17, 14);

    tick(state); // tank fires, shell in flight
    expect(state.projectiles.length).toBe(1);
    victim.hp = 0; // dies to something else
    tick(state);
    expect(state.projectiles.length).toBe(0);
    expect(state.units.some((u) => u.id === victim.id)).toBe(false);
  });
});
