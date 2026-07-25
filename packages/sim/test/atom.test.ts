import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DIRT,
  buildingRule,
  constructBuilding,
  createGame,
  hashState,
  powerBalance,
  satisfiesRequirement,
  spawnUnit,
  startProduction,
  tick,
  upgradeChainOf,
  type Command,
  type GameState,
} from '../src/index.js';

const upgrade = (id: number): Command => ({ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: id });

const ADV_TIME = buildingRule('ADVPOWER').buildTime;
const ATOM_TIME = buildingRule('ATOM').buildTime;
const ATOM_COST = buildingRule('ADVPOWER').upgradeCost!;

/** Empty dirt battlefield with both HQs so nobody auto-loses. */
function arena(seed = 7): GameState {
  const state = createGame(seed);
  state.units = [];
  state.buildings = [];
  state.occupancy.fill(0);
  state.structures.fill(0);
  state.terrain.fill(TERRAIN_DIRT);
  constructBuilding(state, 'CONYARD', 0, 5, 5);
  constructBuilding(state, 'CONYARD', 1, 55, 55);
  return state;
}

/** A standing ADVPOWER for player 0 (skips the first upgrade stage). */
function withAdvPlant(state: GameState, cx = 20, cy = 20) {
  return constructBuilding(state, 'ADVPOWER', 0, cx, cy);
}

describe('Atomkraftwerk (third power tier)', () => {
  it('the upgrade is REJECTED without the Atomprogramm — and works after', () => {
    const state = arena();
    const plant = withAdvPlant(state);
    state.players[0]!.credits = 5000;

    tick(state, [upgrade(plant.id)]);
    expect(state.players[0]!.credits).toBe(5000); // nothing paid
    expect(state.buildings.find((b) => b.id === plant.id)!.upgrade).toBeUndefined();

    state.players[0]!.researched.push('atom');
    tick(state, [upgrade(plant.id)]);
    expect(state.players[0]!.credits).toBe(5000 - ATOM_COST);
    expect(state.buildings.find((b) => b.id === plant.id)!.upgrade).toEqual({
      to: 'ATOM',
      progress: expect.any(Number) as number,
    });
  });

  it('POWER → ADVPOWER stays tech-free', () => {
    const state = arena();
    const plant = constructBuilding(state, 'POWER', 0, 20, 20);
    state.players[0]!.credits = 1000;
    tick(state, [upgrade(plant.id)]);
    expect(state.buildings.find((b) => b.id === plant.id)!.upgrade).toBeDefined();
  });

  it('full chain: timed conversion, +250 power, same footprint, hp 1100', () => {
    const state = arena();
    const plant = withAdvPlant(state);
    state.players[0]!.credits = 5000;
    state.players[0]!.researched.push('atom');
    const producedBefore = powerBalance(state, 0).produced;
    const { cx, cy } = plant;

    tick(state, [upgrade(plant.id)]);
    // Still an ADVPOWER (and its output) during the conversion.
    expect(state.buildings.find((b) => b.id === plant.id)!.type).toBe('ADVPOWER');
    expect(powerBalance(state, 0).produced).toBe(producedBefore);

    for (let t = 0; t < ATOM_TIME; t++) tick(state, []);
    const now = state.buildings.find((b) => b.id === plant.id)!;
    expect(now.type).toBe('ATOM');
    expect(now.cx).toBe(cx);
    expect(now.cy).toBe(cy);
    expect(now.hp).toBe(buildingRule('ATOM').maxHp);
    const gain = powerBalance(state, 0).produced - producedBefore;
    expect(gain).toBe(buildingRule('ATOM').power - buildingRule('ADVPOWER').power); // +250
  });

  it('is upgrade-only, shares the 2×2 footprint, and closes the chain', () => {
    const atom = buildingRule('ATOM');
    const base = buildingRule('POWER');
    expect(atom.buildable).toBe(false);
    expect(buildingRule('ADVPOWER').upgradeTo).toBe('ATOM');
    expect(atom.upgradeTo).toBeUndefined(); // end of the line
    expect(atom.width).toBe(base.width);
    expect(atom.height).toBe(base.height);
    expect(upgradeChainOf('POWER')).toEqual(['POWER', 'ADVPOWER', 'ATOM']);
    expect(upgradeChainOf('GUARDTOWER')).toEqual(['GUARDTOWER', 'AGT']);
  });

  it('still counts as a Kraftwerk for prerequisites', () => {
    expect(satisfiesRequirement('ATOM', 'POWER')).toBe(true);
    expect(satisfiesRequirement('ATOM', 'ADVPOWER')).toBe(true);
    expect(satisfiesRequirement('POWER', 'ATOM')).toBe(false); // nur aufwärts

    const state = arena();
    constructBuilding(state, 'ATOM', 0, 20, 20); // the only plant is an ATOM
    state.players[0]!.credits = 5000;
    startProduction(state, 0, 'REFINERY'); // requires POWER
    expect(state.players[0]!.queues.building.item).toBe('REFINERY');
  });
});

describe('Kernschmelze (meltdown)', () => {
  it('blasts units and buildings in the radius — friend and foe, not outside', () => {
    const state = arena();
    const atom = constructBuilding(state, 'ATOM', 0, 20, 20); // center (21,21)
    const { radius, damage } = buildingRule('ATOM').meltdown!;
    const ownTank = spawnUnit(state, 'TANK', 0, 22, 21); // inside
    // Unarmed enemy, so no stray combat shots distort the hp assertions.
    const enemyInf = spawnUnit(state, 'ENGINEER', 1, 21, 23); // inside (dies)
    const farTank = spawnUnit(state, 'TANK', 0, 21 + radius + 3, 21); // outside
    const nearPower = constructBuilding(state, 'POWER', 0, 23, 20); // adjacent
    const farPower = constructBuilding(state, 'POWER', 0, 30, 30); // outside
    const tankHp = ownTank.hp;
    const farTankHp = farTank.hp;
    const powerHp = nearPower.hp;

    atom.hp = 0;
    tick(state, []);

    expect(state.buildings.some((b) => b.id === atom.id)).toBe(false);
    expect(ownTank.hp).toBe(tankHp - damage);
    expect(state.units.some((u) => u.id === enemyInf.id)).toBe(false); // died same tick
    expect(farTank.hp).toBe(farTankHp);
    expect(nearPower.hp).toBe(powerHp - damage);
    expect(farPower.hp).toBe(buildingRule('POWER').maxHp);
    expect(state.events.some((e) => e.type === 'MELTDOWN')).toBe(true);
    // Unattributed: nobody gets kill credit for the meltdown victims.
    expect(state.players[0]!.stats.unitsKilled).toEqual({});
    expect(state.players[1]!.stats.unitsKilled).toEqual({});
  });

  it('the iron curtain shields against the blast', () => {
    const state = arena();
    const atom = constructBuilding(state, 'ATOM', 0, 20, 20);
    const shielded = spawnUnit(state, 'TANK', 0, 22, 21);
    shielded.curtainTicks = 100;
    const hp = shielded.hp;
    atom.hp = 0;
    tick(state, []);
    expect(shielded.hp).toBe(hp);
  });

  it('a plain ADVPOWER does not melt down', () => {
    const state = arena();
    const adv = withAdvPlant(state);
    const bystander = spawnUnit(state, 'TANK', 0, 22, 21);
    const hp = bystander.hp;
    adv.hp = 0;
    tick(state, []);
    expect(bystander.hp).toBe(hp);
    expect(state.events.some((e) => e.type === 'MELTDOWN')).toBe(false);
  });

  it('hard AI researches the Atomprogramm and builds an ATOM without plant spam', () => {
    // Fast research so the AI reaches 'atom' within the test budget (same
    // trick as the superweapon test).
    const fastResearch = {
      research: Object.fromEntries(
        ['repair', 'flak', 'spy', 'armor', 'air', 'navy', 'tesla', 'atom', 'super'].map((t) => [
          t,
          { time: 60, cost: 200 },
        ]),
      ),
    };
    const state = createGame(1337, { ai: true, aiDifficulty: 'hard', balance: fastResearch });
    for (let t = 0; t < 15000 && state.winner === -1; t++) {
      tick(state);
      if (state.buildings.some((b) => b.owner === 1 && b.type === 'ATOM')) break;
    }
    const gotAtomOrWon =
      state.buildings.some((b) => b.owner === 1 && b.type === 'ATOM') || state.winner === 1;
    expect(gotAtomOrWon).toBe(true);
    // countGoalBuildings chain guard: the POWER goal must never read as
    // unfilled once tiers upgraded away — no runaway plant farm.
    const plantChain = state.buildings.filter(
      (b) => b.owner === 1 && upgradeChainOf('POWER').includes(b.type),
    );
    expect(plantChain.length).toBeLessThanOrEqual(10);
  }, 30000);

  it('stays deterministic across research, double upgrade and meltdown', () => {
    const run = (): string => {
      const state = arena(13);
      const plant = constructBuilding(state, 'POWER', 0, 20, 20);
      spawnUnit(state, 'TANK', 0, 23, 21);
      state.players[0]!.credits = 9000;
      state.players[0]!.researched.push('atom');
      tick(state, [upgrade(plant.id)]);
      for (let t = 0; t < ADV_TIME + 1; t++) tick(state, []);
      tick(state, [upgrade(plant.id)]);
      for (let t = 0; t < ATOM_TIME + 1; t++) tick(state, []);
      state.buildings.find((b) => b.id === plant.id)!.hp = 0;
      for (let t = 0; t < 20; t++) tick(state, []);
      return hashState(state);
    };
    expect(run()).toBe(run());
  });
});
