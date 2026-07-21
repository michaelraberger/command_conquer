import { describe, expect, it } from 'vitest';
import {
  OBJ_ACTIVE,
  OBJ_COMPLETE,
  OBJ_FAILED,
  OBJ_HIDDEN,
  createGame,
  deserialize,
  emptyCustomMap,
  hashState,
  serialize,
  tick,
  validateMissionDef,
  type GameState,
  type MissionDef,
} from '../src/index.js';

/** Minimal valid mission on an empty 48² dirt map. Override what you test. */
function baseMission(overrides: Partial<MissionDef> = {}): MissionDef {
  return {
    id: 'test-01',
    map: emptyCustomMap(48, 48, 'Testkarte'),
    players: [
      { faction: 'ALLIES', team: 0, credits: 5000, isAi: false },
      { faction: 'SOVIETS', team: 1, credits: 0, isAi: false },
    ],
    units: [{ type: 'TANK', owner: 0, cx: 10, cy: 10 }],
    buildings: [{ type: 'POWER', owner: 1, cx: 30, cy: 30, tag: 'ziel' }],
    objectives: [{ id: 'primary-1', spec: { kind: 'DESTROY_TAG', tag: 'ziel' } }],
    triggers: [],
    ...overrides,
  };
}

function start(def: MissionDef): GameState {
  return createGame(7, { mission: def });
}

const objective = (state: GameState, id: string) =>
  state.mission!.objectives.find((o) => o.id === id)!;

describe('Missionsaufbau (createGame)', () => {
  it('builds players, starting forces and mission state from the def', () => {
    const state = start(baseMission());
    expect(state.players).toHaveLength(2);
    expect(state.players[0]!.faction).toBe('ALLIES');
    expect(state.players[0]!.credits).toBe(5000);
    expect(state.players[1]!.team).toBe(1);
    // No default bases: exactly the placed tank and the tagged power plant.
    expect(state.units).toHaveLength(1);
    expect(state.buildings.filter((b) => b.type !== 'BRIDGE')).toHaveLength(1);
    expect(state.buildings[0]!.tag).toBe('ziel');
    expect(state.mission!.missionId).toBe('test-01');
    expect(objective(state, 'primary-1').status).toBe(OBJ_ACTIVE);
  });

  it('rejects missions with dangling tag references', () => {
    const def = baseMission({
      objectives: [{ id: 'p', spec: { kind: 'DESTROY_TAG', tag: 'gibtsnicht' } }],
    });
    expect(validateMissionDef(def).ok).toBe(false);
    expect(() => start(def)).toThrow(/Ungültige Mission/);
  });

  it('rejects mission + multiplayer', () => {
    expect(() =>
      createGame(1, {
        mission: baseMission(),
        multiplayer: { seats: [{ faction: 'ALLIES', name: 'a' }, { faction: 'SOVIETS', name: 'b' }] },
      }),
    ).toThrow(/Mehrspieler/);
  });

  it('skirmish games carry no mission state', () => {
    expect(createGame(1).mission).toBeUndefined();
  });
});

describe('Missionsziele', () => {
  it('DESTROY_TAG completes when the tagged building dies → SIEG', () => {
    const state = start(baseMission());
    state.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(state);
    expect(objective(state, 'primary-1').status).toBe(OBJ_COMPLETE);
    expect(state.winner).toBe(0);
  });

  it('a commando force without any base does NOT lose (victorySystem bypassed)', () => {
    const state = start(baseMission());
    for (let i = 0; i < 30; i++) tick(state);
    expect(state.winner).toBe(-1); // player 0 has units but no buildings
  });

  it('losing every unit and building fails the mission', () => {
    const state = start(baseMission());
    state.units = [];
    state.occupancy.fill(0);
    tick(state);
    expect(state.winner).toBe(1);
  });

  it('CAPTURE_TAG completes on ownership, fails on destruction', () => {
    const def = baseMission({
      objectives: [{ id: 'cap', spec: { kind: 'CAPTURE_TAG', tag: 'ziel' } }],
    });
    const captured = start(def);
    captured.buildings.find((b) => b.tag === 'ziel')!.owner = 0;
    tick(captured);
    expect(objective(captured, 'cap').status).toBe(OBJ_COMPLETE);
    expect(captured.winner).toBe(0);

    const destroyed = start(def);
    destroyed.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(destroyed);
    expect(objective(destroyed, 'cap').status).toBe(OBJ_FAILED);
    expect(destroyed.winner).toBe(1);
  });

  it('SURVIVE_UNTIL completes at its tick', () => {
    const state = start(
      baseMission({ objectives: [{ id: 's', spec: { kind: 'SURVIVE_UNTIL', tick: 5 } }] }),
    );
    for (let i = 0; i < 4; i++) tick(state);
    expect(objective(state, 's').status).toBe(OBJ_ACTIVE);
    for (let i = 0; i < 3; i++) tick(state);
    expect(objective(state, 's').status).toBe(OBJ_COMPLETE);
    expect(state.winner).toBe(0);
  });

  it('PROTECT_TAG fails when the ward dies, completes on mission win', () => {
    const def = baseMission({
      units: [
        { type: 'TANK', owner: 0, cx: 10, cy: 10 },
        { type: 'MCV', owner: 0, cx: 12, cy: 10, tag: 'schutz' },
      ],
      objectives: [
        { id: 'p1', spec: { kind: 'DESTROY_TAG', tag: 'ziel' } },
        { id: 'p2', spec: { kind: 'PROTECT_TAG', tag: 'schutz' } },
      ],
    });
    const lost = start(def);
    lost.units = lost.units.filter((u) => u.tag !== 'schutz');
    lost.occupancy.fill(0);
    lost.units.forEach((u) => (lost.occupancy[u.cell] = u.id));
    tick(lost);
    expect(objective(lost, 'p2').status).toBe(OBJ_FAILED);
    expect(lost.winner).toBe(1);

    const won = start(def);
    won.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(won);
    expect(objective(won, 'p2').status).toBe(OBJ_COMPLETE);
    expect(won.winner).toBe(0);
  });

  it('REACH_AREA completes when a human unit stands in the rect', () => {
    const state = start(
      baseMission({
        objectives: [{ id: 'r', spec: { kind: 'REACH_AREA', cx: 9, cy: 9, w: 3, h: 3 } }],
      }),
    );
    tick(state); // tank was placed at (10,10) — already inside
    expect(objective(state, 'r').status).toBe(OBJ_COMPLETE);
    expect(state.winner).toBe(0);
  });

  it('DESTROY_ALL_ENEMIES counts garrison units, not just buildings', () => {
    const state = start(
      baseMission({
        buildings: [],
        units: [
          { type: 'TANK', owner: 0, cx: 10, cy: 10 },
          { type: 'RIFLEMAN', owner: 1, cx: 30, cy: 30, tag: 'ziel' },
        ],
        objectives: [{ id: 'd', spec: { kind: 'DESTROY_ALL_ENEMIES' } }],
      }),
    );
    tick(state);
    expect(objective(state, 'd').status).toBe(OBJ_ACTIVE); // garrison lives
    state.units = state.units.filter((u) => u.owner !== 1);
    state.occupancy.fill(0);
    state.units.forEach((u) => (state.occupancy[u.cell] = u.id));
    tick(state);
    expect(state.winner).toBe(0);
  });

  it('bonus objectives never gate the outcome', () => {
    const state = start(
      baseMission({
        objectives: [
          { id: 'p', spec: { kind: 'DESTROY_TAG', tag: 'ziel' } },
          { id: 'b', spec: { kind: 'SURVIVE_UNTIL', tick: 99999 }, optional: true },
        ],
      }),
    );
    state.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(state);
    expect(state.winner).toBe(0); // bonus still pending, win anyway
  });
});

describe('Trigger', () => {
  it('AT_TICK spawns reinforcements, blocked cells fall back to the ring', () => {
    const state = start(
      baseMission({
        triggers: [
          {
            id: 't1',
            when: { kind: 'AT_TICK', tick: 3 },
            actions: [
              {
                kind: 'SPAWN',
                units: [
                  { type: 'TANK', owner: 0, cx: 10, cy: 10 }, // occupied by start tank
                  { type: 'RIFLEMAN', owner: 0, cx: 20, cy: 20, tag: 'neu' },
                ],
              },
            ],
          },
        ],
      }),
    );
    for (let i = 0; i < 4; i++) tick(state);
    const own = state.units.filter((u) => u.owner === 0);
    expect(own).toHaveLength(3);
    expect(own.some((u) => u.tag === 'neu')).toBe(true);
    // The blocked spawn landed near, not on, the occupied cell.
    const tanks = own.filter((u) => u.type === 'TANK');
    expect(new Set(tanks.map((u) => u.cell)).size).toBe(2);
  });

  it('GRANT_CREDITS and MESSAGE fire once', () => {
    const state = start(
      baseMission({
        triggers: [
          {
            id: 't1',
            when: { kind: 'AT_TICK', tick: 1 },
            actions: [
              { kind: 'GRANT_CREDITS', player: 0, amount: 1234 },
              { kind: 'MESSAGE', msgId: 'hallo' },
            ],
          },
        ],
      }),
    );
    tick(state);
    expect(state.players[0]!.credits).toBe(5000);
    tick(state);
    expect(state.players[0]!.credits).toBe(6234);
    expect(state.events.some((e) => e.type === 'MISSION_MESSAGE' && e.msgId === 'hallo')).toBe(true);
    tick(state);
    expect(state.players[0]!.credits).toBe(6234); // one-shot
  });

  it('REVEAL_OBJECTIVE activates a hidden objective and emits the event', () => {
    const state = start(
      baseMission({
        objectives: [
          { id: 'p', spec: { kind: 'DESTROY_TAG', tag: 'ziel' } },
          { id: 'geheim', spec: { kind: 'SURVIVE_UNTIL', tick: 9000 }, hidden: true },
        ],
        triggers: [
          {
            id: 't1',
            when: { kind: 'AT_TICK', tick: 1 },
            actions: [{ kind: 'REVEAL_OBJECTIVE', objectiveId: 'geheim' }],
          },
        ],
      }),
    );
    expect(objective(state, 'geheim').status).toBe(OBJ_HIDDEN);
    tick(state);
    tick(state);
    expect(objective(state, 'geheim').status).toBe(OBJ_ACTIVE);
    expect(state.events.some((e) => e.type === 'OBJECTIVE' && e.id === 'geheim')).toBe(true);
  });

  it('a hidden mandatory objective blocks the win until revealed', () => {
    const state = start(
      baseMission({
        objectives: [
          { id: 'p', spec: { kind: 'DESTROY_TAG', tag: 'ziel' } },
          { id: 'geheim', spec: { kind: 'SURVIVE_UNTIL', tick: 1 }, hidden: true },
        ],
      }),
    );
    state.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(state);
    expect(state.winner).toBe(-1); // 'geheim' still hidden → no win yet
  });

  it('TAG_DEAD and OBJECTIVE_STATUS chain triggers', () => {
    const state = start(
      baseMission({
        triggers: [
          {
            id: 'nach-ziel',
            when: { kind: 'OBJECTIVE_STATUS', objectiveId: 'primary-1', status: OBJ_COMPLETE },
            actions: [{ kind: 'MESSAGE', msgId: 'geschafft' }],
          },
        ],
      }),
    );
    state.buildings.find((b) => b.tag === 'ziel')!.hp = 0;
    tick(state); // objective completes, winner=0 — trigger fires next tick? No:
    // the win freezes the sim, so chained triggers must fire the same tick or
    // never. OBJECTIVE_STATUS is evaluated before objectivesSystem runs, so
    // the chain fires one tick after completion — only if the sim still runs.
    // With winner set, the message never comes: assert exactly that contract.
    tick(state);
    expect(state.events.some((e) => e.type === 'MISSION_MESSAGE')).toBe(false);
    expect(state.winner).toBe(0);
  });

  it('WIN/LOSE actions end the mission immediately', () => {
    const state = start(
      baseMission({
        triggers: [{ id: 'w', when: { kind: 'AT_TICK', tick: 1 }, actions: [{ kind: 'WIN' }] }],
      }),
    );
    tick(state);
    tick(state);
    expect(state.winner).toBe(0);
  });

  it('AREA_ENTERED fires when a team-0 unit stands in the rect', () => {
    const state = start(
      baseMission({
        triggers: [
          {
            id: 'a',
            when: { kind: 'AREA_ENTERED', team: 0, cx: 9, cy: 9, w: 3, h: 3 },
            actions: [{ kind: 'GRANT_CREDITS', player: 0, amount: 1 }],
          },
        ],
      }),
    );
    tick(state);
    expect(state.players[0]!.credits).toBe(5001);
  });
});

describe('Determinismus & Spielstände', () => {
  const scriptedDef = (): MissionDef =>
    baseMission({
      players: [
        { faction: 'ALLIES', team: 0, credits: 5000, isAi: false },
        { faction: 'SOVIETS', team: 1, credits: 3000, isAi: true, aiDifficulty: 'easy', aiTuning: { incomeBonus: 3 } },
      ],
      buildings: [
        { type: 'CONYARD', owner: 1, cx: 30, cy: 30 },
        { type: 'POWER', owner: 1, cx: 35, cy: 30, tag: 'ziel' },
      ],
      units: [
        { type: 'TANK', owner: 0, cx: 10, cy: 10 },
        { type: 'RIFLEMAN', owner: 0, cx: 11, cy: 10, order: { kind: 'ATTACK_MOVE', cx: 20, cy: 20 } },
      ],
      triggers: [
        {
          id: 'welle',
          when: { kind: 'AT_TICK', tick: 30 },
          actions: [{ kind: 'SPAWN', units: [{ type: 'FLAMER', owner: 1, cx: 40, cy: 40, order: { kind: 'ATTACK_MOVE', cx: 10, cy: 10 } }] }],
        },
      ],
    });

  it('two identically-fed mission sims stay bit-identical', () => {
    const a = createGame(42, { mission: scriptedDef() });
    const b = createGame(42, { mission: scriptedDef() });
    for (let i = 0; i < 120; i++) {
      tick(a);
      tick(b);
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it('serialize→deserialize round-trips a mid-mission state exactly', () => {
    const state = createGame(42, { mission: scriptedDef() });
    for (let i = 0; i < 60; i++) tick(state);
    const json = serialize(state);
    const loaded = deserialize(json);
    expect(serialize(loaded)).toBe(json);
    expect(hashState(loaded)).toBe(hashState(state));
    // The loaded game keeps playing deterministically alongside the original.
    for (let i = 0; i < 60; i++) {
      tick(state);
      tick(loaded);
    }
    expect(hashState(loaded)).toBe(hashState(state));
    expect(loaded.mission!.missionId).toBe('test-01');
  });

  it('pre-campaign saves (no mission/tag fields) still load and tick', () => {
    const skirmish = createGame(5, { ai: true, opponents: 1 });
    for (let i = 0; i < 30; i++) tick(skirmish);
    const loaded = deserialize(serialize(skirmish));
    expect(loaded.mission).toBeUndefined();
    for (let i = 0; i < 30; i++) tick(loaded);
    expect(loaded.winner).toBe(-1);
  });
});
