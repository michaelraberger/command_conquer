import type { MissionDef, MissionTriggerDef } from '@cac/sim';
import { aiBase, mcvStart } from './layouts.js';
import {
  RESOURCE_GEMS,
  TERRAIN_ROCK,
  TERRAIN_TREE,
  clearRect,
  frame,
  newMap,
  orePatch,
  riverVertical,
  scatter,
  setSpawns,
} from './mapTools.js';
import type { CampaignMissionDef } from '../types.js';

const MIN = 15 * 60;

/* ------------------------------------------------------------------------- *
 * Mission 1 — Roter Morgen (Kommando)
 * ------------------------------------------------------------------------- */

function m01Sim(): MissionDef {
  const map = newMap(48, 48, 'Roter Morgen');
  frame(map);
  scatter(map, TERRAIN_TREE, 100, 111);
  scatter(map, TERRAIN_ROCK, 45, 112);
  setSpawns(map, [
    [9, 9],
    [38, 38],
  ]);
  clearRect(map, 4, 4, 12, 10); // Startzone
  clearRect(map, 30, 30, 15, 15); // Alliierten-Lager
  return {
    id: 'soviets-01',
    map,
    players: [
      { faction: 'SOVIETS', team: 0, credits: 0, isAi: false },
      { faction: 'ALLIES', team: 1, credits: 0, isAi: false, name: 'Grenzwache' },
    ],
    buildings: [
      { type: 'POWER', owner: 1, cx: 33, cy: 33, tag: 'kraftwerk' },
      { type: 'POWER', owner: 1, cx: 41, cy: 40, tag: 'kraftwerk' },
      { type: 'GUARDTOWER', owner: 1, cx: 31, cy: 37, tag: 'wachturm' },
      { type: 'PILLBOX', owner: 1, cx: 36, cy: 32 },
      { type: 'PILLBOX', owner: 1, cx: 38, cy: 42 },
      { type: 'RADAR', owner: 1, cx: 37, cy: 36 },
    ],
    units: [
      { type: 'DOG', owner: 0, cx: 6, cy: 6 },
      { type: 'DOG', owner: 0, cx: 7, cy: 6 },
      { type: 'FLAMER', owner: 0, cx: 6, cy: 8 },
      { type: 'FLAMER', owner: 0, cx: 7, cy: 8 },
      { type: 'FLAMER', owner: 0, cx: 8, cy: 8 },
      { type: 'TANK', owner: 0, cx: 6, cy: 10 },
      { type: 'TANK', owner: 0, cx: 8, cy: 10 },
      { type: 'RIFLEMAN', owner: 0, cx: 10, cy: 7 },
      { type: 'RIFLEMAN', owner: 0, cx: 10, cy: 8 },
      { type: 'SNIPER', owner: 1, cx: 34, cy: 36 },
      { type: 'RIFLEMAN', owner: 1, cx: 35, cy: 39 },
      { type: 'RIFLEMAN', owner: 1, cx: 40, cy: 35 },
      { type: 'LIGHTTANK', owner: 1, cx: 39, cy: 38 },
    ],
    objectives: [
      { id: 'kraftwerke', spec: { kind: 'DESTROY_TAG', tag: 'kraftwerk' } },
      { id: 'wachturm', spec: { kind: 'DESTROY_TAG', tag: 'wachturm' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'welle1',
        when: { kind: 'AT_TICK', tick: 2 * MIN },
        actions: [
          { kind: 'MESSAGE', msgId: 'welle' },
          {
            kind: 'SPAWN',
            units: [
              { type: 'RIFLEMAN', owner: 1, cx: 30, cy: 44, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 9 } },
              { type: 'RIFLEMAN', owner: 1, cx: 31, cy: 44, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 9 } },
              { type: 'LIGHTTANK', owner: 1, cx: 32, cy: 44, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 9 } },
            ],
          },
        ],
      },
    ],
  };
}

const m01: CampaignMissionDef = {
  id: 'soviets-01',
  campaign: 'soviets',
  index: 0,
  title: 'Mission 1: Roter Morgen',
  tagline: 'Schalte die Stromversorgung der Grenzwache aus',
  briefing: [
    'Genosse Kommandant! Die Alliierten glauben, ihre Grenzwache im Südosten sei uneinnehmbar. Wir werden sie eines Besseren belehren.',
    'Ihr Stoßtrupp schaltet die beiden Kraftwerke des Lagers aus. Ohne Strom schweigen die MG-Stellungen — und der Weg für unsere Armee ist frei.',
    'Verstärkung gibt es nicht. Die Revolution zählt auf Sie.',
  ],
  objectiveTexts: {
    kraftwerke: 'Zerstöre beide Kraftwerke der Grenzwache',
    wachturm: 'Zerstöre den Wachturm',
  },
  messages: {
    intro: 'Funkspruch: Die Kraftwerke stehen im Südosten. Für die Union!',
    welle: 'Alliierte Patrouille von Süden gemeldet!',
  },
  playerFaction: 'SOVIETS',
  seed: 111,
  makeSimDef: m01Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 2 — Stahlfaust (Basisaufbau)
 * ------------------------------------------------------------------------- */

function m02Sim(): MissionDef {
  const map = newMap(64, 64, 'Stahlfaust');
  frame(map);
  scatter(map, TERRAIN_TREE, 150, 211);
  scatter(map, TERRAIN_ROCK, 70, 212);
  setSpawns(map, [
    [52, 52],
    [10, 10],
  ]);
  clearRect(map, 44, 44, 18, 18);
  clearRect(map, 2, 2, 20, 16);
  clearRect(map, 28, 28, 8, 8);
  orePatch(map, 46, 46, 3);
  orePatch(map, 16, 16, 3);
  orePatch(map, 32, 40, 2);
  orePatch(map, 40, 24, 1, RESOURCE_GEMS);
  const enemy = aiBase(1, 10, 10, 'ALLIES');
  return {
    id: 'soviets-02',
    map,
    players: [
      { faction: 'SOVIETS', team: 0, credits: 6000, isAi: false },
      {
        faction: 'ALLIES',
        team: 1,
        credits: 4000,
        isAi: true,
        aiDifficulty: 'easy',
        aiTuning: { incomeBonus: 4, firstAttackTick: 12 * MIN, riflemenCap: 3, vehicleCap: 3, airCap: 0, navalCap: 0 },
        name: 'Expeditionskorps',
      },
    ],
    buildings: [
      ...enemy.buildings,
      { type: 'HOSPITAL', owner: -1, cx: 30, cy: 30, tag: 'lazarett' },
    ],
    units: [...mcvStart(0, 52, 52, 'SOVIETS').units, ...enemy.units],
    objectives: [
      { id: 'vernichten', spec: { kind: 'DESTROY_ALL_ENEMIES' } },
      { id: 'lazarett', spec: { kind: 'CAPTURE_TAG', tag: 'lazarett' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'mahnung',
        when: { kind: 'AT_TICK', tick: 5 * MIN },
        actions: [{ kind: 'MESSAGE', msgId: 'mahnung' }],
      },
    ],
  };
}

const m02: CampaignMissionDef = {
  id: 'soviets-02',
  campaign: 'soviets',
  index: 1,
  title: 'Mission 2: Stahlfaust',
  tagline: 'Zermalme das alliierte Expeditionskorps',
  briefing: [
    'Der Angriff Ihres Stoßtrupps hat die Grenze aufgerissen — jetzt rollt die Stahlfaust. Ein Bauhof steht bereit.',
    'Errichten Sie eine Operationsbasis und vernichten Sie das alliierte Expeditionskorps im Nordwesten restlos.',
    'Im Zentrum wurde ein Lazarett gesichtet. Ein Ingenieur macht es der Roten Armee dienstbar.',
  ],
  objectiveTexts: {
    vernichten: 'Vernichte alle alliierten Kräfte',
    lazarett: 'Erobere das Lazarett mit einem Ingenieur',
  },
  messages: {
    intro: 'Bauhof entfalten, Genosse — die Faust muss zuschlagen, bevor der Feind sich eingräbt.',
    mahnung: 'Moskau erwartet Resultate. Das Expeditionskorps muss fallen!',
  },
  playerFaction: 'SOVIETS',
  seed: 112,
  makeSimDef: m02Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 3 — Enthauptungsschlag (Kommando + Exfiltration)
 * ------------------------------------------------------------------------- */

function m03Sim(): MissionDef {
  const map = newMap(64, 64, 'Enthauptungsschlag');
  frame(map);
  scatter(map, TERRAIN_TREE, 170, 311);
  scatter(map, TERRAIN_ROCK, 80, 312);
  riverVertical(map, 30, 4, [14, 48]);
  setSpawns(map, [
    [8, 54],
    [52, 12],
  ]);
  clearRect(map, 3, 48, 13, 13); // Start + Evakuierungszone
  clearRect(map, 42, 4, 20, 18); // Alliiertes HQ
  clearRect(map, 26, 46, 12, 6); // Südbrücken-Vorfeld
  clearRect(map, 34, 12, 5, 5); // Brückenkopf Nord (Wache)
  clearRect(map, 34, 43, 5, 5); // Brückenkopf Süd (Wache + Welle)
  return {
    id: 'soviets-03',
    map,
    players: [
      { faction: 'SOVIETS', team: 0, credits: 0, isAi: false },
      { faction: 'ALLIES', team: 1, credits: 0, isAi: false, name: 'Hauptquartier-Garde' },
    ],
    buildings: [
      { type: 'RADAR', owner: 1, cx: 50, cy: 7, tag: 'hq' },
      { type: 'TECHCENTER', owner: 1, cx: 55, cy: 7, tag: 'hq' },
      { type: 'GUARDTOWER', owner: 1, cx: 46, cy: 6 },
      { type: 'GUARDTOWER', owner: 1, cx: 46, cy: 14 },
      { type: 'PILLBOX', owner: 1, cx: 53, cy: 13 },
      { type: 'PILLBOX', owner: 1, cx: 58, cy: 13 },
      { type: 'POWER', owner: 1, cx: 43, cy: 9 },
    ],
    units: [
      { type: 'TANK', owner: 0, cx: 5, cy: 51 },
      { type: 'TANK', owner: 0, cx: 6, cy: 51 },
      { type: 'TESLATANK', owner: 0, cx: 7, cy: 51 },
      { type: 'FLAMER', owner: 0, cx: 5, cy: 53 },
      { type: 'FLAMER', owner: 0, cx: 6, cy: 53 },
      { type: 'DOG', owner: 0, cx: 7, cy: 53 },
      { type: 'ENGINEER', owner: 0, cx: 6, cy: 55, tag: 'spezialist' },
      { type: 'RIFLEMAN', owner: 1, cx: 48, cy: 10 },
      { type: 'RIFLEMAN', owner: 1, cx: 52, cy: 15 },
      { type: 'SNIPER', owner: 1, cx: 56, cy: 11 },
      { type: 'LIGHTTANK', owner: 1, cx: 49, cy: 13 },
      { type: 'LIGHTTANK', owner: 1, cx: 35, cy: 14 }, // Brückenwache Nord
      { type: 'RIFLEMAN', owner: 1, cx: 35, cy: 48 }, // Brückenwache Süd
    ],
    objectives: [
      { id: 'hq', spec: { kind: 'DESTROY_TAG', tag: 'hq' } },
      { id: 'spezialist', spec: { kind: 'PROTECT_TAG', tag: 'spezialist' } },
      {
        id: 'evac',
        spec: { kind: 'REACH_AREA', tag: 'spezialist', cx: 4, cy: 52, w: 5, h: 5 },
        hidden: true,
      },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'hq-tot',
        when: { kind: 'TAG_DEAD', tag: 'hq' },
        actions: [
          { kind: 'REVEAL_OBJECTIVE', objectiveId: 'evac' },
          { kind: 'MESSAGE', msgId: 'evac' },
          {
            kind: 'SPAWN',
            units: [
              { type: 'LIGHTTANK', owner: 1, cx: 44, cy: 18, order: { kind: 'ATTACK_MOVE', cx: 8, cy: 54 } },
              { type: 'RIFLEMAN', owner: 1, cx: 45, cy: 18, order: { kind: 'ATTACK_MOVE', cx: 8, cy: 54 } },
              { type: 'RIFLEMAN', owner: 1, cx: 46, cy: 18, order: { kind: 'ATTACK_MOVE', cx: 8, cy: 54 } },
            ],
          },
        ],
      },
      {
        id: 'welle1',
        when: { kind: 'AT_TICK', tick: 3 * MIN },
        actions: [
          {
            kind: 'SPAWN',
            units: [
              { type: 'RIFLEMAN', owner: 1, cx: 35, cy: 44, order: { kind: 'ATTACK_MOVE', cx: 8, cy: 54 } },
              { type: 'DOG', owner: 1, cx: 36, cy: 44, order: { kind: 'ATTACK_MOVE', cx: 8, cy: 54 } },
            ],
          },
        ],
      },
    ],
  };
}

const m03: CampaignMissionDef = {
  id: 'soviets-03',
  campaign: 'soviets',
  index: 2,
  title: 'Mission 3: Enthauptungsschlag',
  tagline: 'Zerstöre das Feld-Hauptquartier und bring den Spezialisten zurück',
  briefing: [
    'Hinter dem Fluss koordiniert ein alliiertes Feld-Hauptquartier sämtliche Truppenbewegungen der Region: Radarturm und Techzentrum müssen fallen.',
    'Ihr Trupp begleitet einen Spionage-Spezialisten. Er sammelt vor Ort Beweismaterial — er darf unter keinen Umständen fallen und muss nach dem Schlag zur Evakuierungszone zurück.',
    'Zwei Brücken führen über den Fluss. Beide werden bewacht.',
  ],
  objectiveTexts: {
    hq: 'Zerstöre Radarturm und Techzentrum des Hauptquartiers',
    spezialist: 'Der Spezialist muss überleben',
    evac: 'Bring den Spezialisten zur Evakuierungszone im Südwesten',
  },
  messages: {
    intro: 'Das HQ liegt im Nordosten. Der Spezialist bleibt am Leben — Befehl aus Moskau!',
    evac: 'HQ zerstört! Rückzug: Spezialist zur Evakuierungszone im Südwesten bringen. Feindliche Verfolger!',
  },
  playerFaction: 'SOVIETS',
  seed: 113,
  makeSimDef: m03Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 4 — Eiserne Ernte (Eroberung + Vernichtung)
 * ------------------------------------------------------------------------- */

function m04Sim(): MissionDef {
  const map = newMap(64, 64, 'Eiserne Ernte');
  frame(map);
  scatter(map, TERRAIN_TREE, 140, 411);
  scatter(map, TERRAIN_ROCK, 85, 412);
  setSpawns(map, [
    [12, 52],
    [52, 12],
  ]);
  clearRect(map, 4, 44, 18, 18);
  clearRect(map, 42, 4, 20, 18);
  clearRect(map, 20, 18, 8, 8); // Bohrturm West
  clearRect(map, 38, 38, 8, 8); // Bohrturm Ost
  orePatch(map, 18, 46, 3);
  orePatch(map, 46, 18, 3);
  orePatch(map, 30, 30, 2, RESOURCE_GEMS);
  const enemy = aiBase(1, 52, 12, 'ALLIES');
  const wave = (tick: number): MissionTriggerDef => ({
    id: `welle-${tick}`,
    when: { kind: 'AT_TICK', tick },
    actions: [
      {
        kind: 'SPAWN',
        units: [
          { type: 'LIGHTTANK', owner: 1, cx: 2, cy: 20, order: { kind: 'ATTACK_MOVE', cx: 12, cy: 52 } },
          { type: 'RIFLEMAN', owner: 1, cx: 2, cy: 22, order: { kind: 'ATTACK_MOVE', cx: 12, cy: 52 } },
        ],
      },
    ],
  });
  return {
    id: 'soviets-04',
    map,
    players: [
      { faction: 'SOVIETS', team: 0, credits: 7000, isAi: false },
      {
        faction: 'ALLIES',
        team: 1,
        credits: 6000,
        isAi: true,
        aiDifficulty: 'normal',
        aiTuning: { incomeBonus: 10, firstAttackTick: 6 * MIN, airCap: 2, navalCap: 0 },
        name: 'Minengarde',
      },
    ],
    buildings: [
      ...enemy.buildings,
      { type: 'PRISM', owner: 1, cx: 50, cy: 7, tag: 'prisma' },
      { type: 'ERZ_BOHRTURM', owner: -1, cx: 22, cy: 20, tag: 'bohrturm' },
      { type: 'ERZ_BOHRTURM', owner: -1, cx: 40, cy: 40, tag: 'bohrturm' },
    ],
    units: [...mcvStart(0, 12, 52, 'SOVIETS').units, { type: 'ENGINEER', owner: 0, cx: 14, cy: 54 }, { type: 'ENGINEER', owner: 0, cx: 15, cy: 54 }, ...enemy.units],
    objectives: [
      { id: 'bohrtuerme', spec: { kind: 'CAPTURE_TAG', tag: 'bohrturm' } },
      { id: 'vernichten', spec: { kind: 'DESTROY_ALL_ENEMIES' } },
      { id: 'prisma', spec: { kind: 'DESTROY_TAG', tag: 'prisma' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      wave(4 * MIN),
      wave(9 * MIN),
      {
        id: 'bohrtuerme-da',
        when: { kind: 'OBJECTIVE_STATUS', objectiveId: 'bohrtuerme', status: 2 },
        actions: [{ kind: 'MESSAGE', msgId: 'ernte' }],
      },
    ],
  };
}

const m04: CampaignMissionDef = {
  id: 'soviets-04',
  campaign: 'soviets',
  index: 3,
  title: 'Mission 4: Eiserne Ernte',
  tagline: 'Sichere die Bohrtürme und vernichte die Minengarde',
  briefing: [
    'Diese Region liefert das Erz für die gesamte Westfront der Alliierten. Zwei verlassene Erz-Bohrtürme warten nur darauf, für die Union zu fördern.',
    'Erobern Sie beide Bohrtürme mit Ingenieuren und vernichten Sie anschließend die Minengarde im Nordosten. Beide Türme müssen stehen bleiben!',
    'Achtung: Die Garde verfügt über einen Prisma-Turm neuester Bauart. Ihn zu zerstören wäre ein Bonus für unsere Forschung.',
  ],
  objectiveTexts: {
    bohrtuerme: 'Erobere beide Erz-Bohrtürme (sie dürfen nicht zerstört werden)',
    vernichten: 'Vernichte die Minengarde',
    prisma: 'Zerstöre den Prisma-Turm',
  },
  messages: {
    intro: 'Die Bohrtürme zuerst, Genosse — die Ernte gehört der Union!',
    ernte: 'Beide Bohrtürme fördern für die Union. Jetzt: Vernichtet die Minengarde!',
  },
  playerFaction: 'SOVIETS',
  seed: 114,
  makeSimDef: m04Sim,
};

export const sovietsMissions: CampaignMissionDef[] = [m01, m02, m03, m04];
