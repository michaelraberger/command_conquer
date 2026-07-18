import { describe, expect, it } from 'vitest';
import {
  constructBuilding,
  createGame,
  spawnUnit,
  tick,
  unitRule,
  type GameState,
  type Unit,
} from '../src/index.js';

function runTicks(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) tick(state);
}

/** Bare battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** Enemy rifleman at (24,20), fully ringed by enemy walls — no line of fire in. */
function walledVictim(state: GameState): Unit {
  const victim = spawnUnit(state, 'RIFLEMAN', 1, 24, 20);
  for (let cy = 19; cy <= 21; cy++) {
    for (let cx = 23; cx <= 25; cx++) {
      if (cx === 24 && cy === 20) continue;
      constructBuilding(state, 'WALL', 1, cx, cy);
    }
  }
  return victim;
}

describe('walls block direct fire (cover)', () => {
  it('a tank cannot shoot a unit hiding behind a wall — even on explicit attack', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20); // range 4.5 covers the victim
    const victim = walledVictim(state);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [tank.id], targetId: victim.id }]);
    runTicks(state, 60);
    expect(victim.hp).toBe(unitRule('RIFLEMAN').maxHp); // wall soaked nothing, shot never fired
  });

  it('idle guards ignore enemies they cannot draw a line of fire to', () => {
    const state = arena();
    spawnUnit(state, 'TANK', 0, 20, 20); // idle, guard stance
    const victim = walledVictim(state);
    runTicks(state, 30);
    expect(victim.hp).toBe(unitRule('RIFLEMAN').maxHp);
  });

  it('artillery and the V3 lob their shots clean over walls', () => {
    expect(unitRule('ARTILLERY').weapon!.arcing).toBe(true);
    expect(unitRule('V3').weapon!.arcing).toBe(true);

    const state = arena();
    const arty = spawnUnit(state, 'ARTILLERY', 0, 19, 20); // range 7
    const victim = walledVictim(state);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [arty.id], targetId: victim.id }]);
    runTicks(state, 40); // slow shell flight
    expect(victim.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });

  it('aircraft shoot over walls (they fire from above)', () => {
    const state = arena();
    const heli = spawnUnit(state, 'HELI', 0, 20, 20);
    const victim = walledVictim(state);
    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [heli.id], targetId: victim.id }]);
    runTicks(state, 40);
    expect(victim.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });

  it('base-defense towers are tall enough to fire over walls', () => {
    const state = arena();
    constructBuilding(state, 'POWER', 0, 8, 5); // keep the tower online
    constructBuilding(state, 'TESLA', 0, 20, 20); // range 6
    const victim = walledVictim(state);
    runTicks(state, 10);
    expect(victim.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });

  it('an attack-moving force breaches the wall instead of idling in front of it', () => {
    const state = arena();
    const tank = spawnUnit(state, 'TANK', 0, 20, 20);
    walledVictim(state);
    tick(state, [{ type: 'ATTACK_MOVE', playerId: 0, unitIds: [tank.id], cx: 24, cy: 20 }]);
    runTicks(state, 30);
    const walls = state.buildings.filter((b) => b.type === 'WALL');
    expect(walls.some((w) => w.hp < 250)).toBe(true); // the ring is under fire
  });

  it('cover is one-way: defenders fire out over their OWN wall, attackers cannot shoot in', () => {
    const state = arena();
    // Player 0's wall line between the two shooters — 0 owns the wall.
    for (let cy = 18; cy <= 22; cy++) constructBuilding(state, 'WALL', 0, 22, cy);
    const defender = spawnUnit(state, 'TANK', 0, 20, 20); // hinter der eigenen Mauer
    const attacker = spawnUnit(state, 'RIFLEMAN', 1, 24, 20); // davor, in Reichweite

    tick(state, [{ type: 'ATTACK', playerId: 0, unitIds: [defender.id], targetId: attacker.id }]);
    runTicks(state, 60);
    // The defender's shot crosses his own wall; the attacker never reaches the
    // tank behind it (he chews on the wall instead — breach behavior).
    expect(attacker.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
    expect(defender.hp).toBe(unitRule('TANK').maxHp);
  });

  it('idle defenders auto-acquire enemies beyond their own wall', () => {
    const state = arena();
    for (let cy = 18; cy <= 22; cy++) constructBuilding(state, 'WALL', 0, 22, cy);
    spawnUnit(state, 'TANK', 0, 20, 20); // idle, guard stance
    const enemy = spawnUnit(state, 'RIFLEMAN', 1, 24, 20);
    runTicks(state, 40);
    expect(enemy.hp).toBeLessThan(unitRule('RIFLEMAN').maxHp);
  });
});
