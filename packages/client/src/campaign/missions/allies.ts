import type { MissionDef, MissionTriggerDef } from '@cac/sim';
import { aiBase, mcvStart, playerBase } from './layouts.js';
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

const MIN = 15 * 60; // Ticks pro Minute

/* ------------------------------------------------------------------------- *
 * Mission 1 — Operation Leuchtfeuer (Kommando)
 * ------------------------------------------------------------------------- */

function m01Sim(): MissionDef {
  const map = newMap(48, 48, 'Leuchtfeuer');
  frame(map);
  scatter(map, TERRAIN_TREE, 90, 101);
  scatter(map, TERRAIN_ROCK, 40, 102);
  riverVertical(map, 22, 4, [38, 9]);
  setSpawns(map, [
    [9, 40],
    [38, 9],
  ]);
  clearRect(map, 30, 3, 16, 13); // Sowjet-Lager
  clearRect(map, 5, 36, 12, 9); // Startzone
  clearRect(map, 26, 36, 8, 4); // Brückenkopf Ost
  return {
    id: 'allies-01',
    map,
    players: [
      { faction: 'ALLIES', team: 0, credits: 0, isAi: false },
      { faction: 'SOVIETS', team: 1, credits: 0, isAi: false, name: 'Küstengarnison' },
    ],
    buildings: [
      { type: 'RADAR', owner: 1, cx: 37, cy: 6, tag: 'radar' },
      { type: 'SILO', owner: 1, cx: 42, cy: 5, tag: 'depot' },
      { type: 'TESLA', owner: 1, cx: 33, cy: 5 },
      { type: 'TESLA', owner: 1, cx: 33, cy: 12 },
      { type: 'TESLA', owner: 1, cx: 42, cy: 12 },
      { type: 'POWER', owner: 1, cx: 40, cy: 9 },
    ],
    units: [
      { type: 'LIGHTTANK', owner: 0, cx: 7, cy: 38 },
      { type: 'LIGHTTANK', owner: 0, cx: 8, cy: 38 },
      { type: 'SNIPER', owner: 0, cx: 9, cy: 39 },
      { type: 'RIFLEMAN', owner: 0, cx: 7, cy: 41 },
      { type: 'RIFLEMAN', owner: 0, cx: 8, cy: 41 },
      { type: 'RIFLEMAN', owner: 0, cx: 9, cy: 41 },
      { type: 'RIFLEMAN', owner: 0, cx: 10, cy: 41 },
      { type: 'DOG', owner: 1, cx: 35, cy: 8 },
      { type: 'RIFLEMAN', owner: 1, cx: 36, cy: 10 },
      { type: 'RIFLEMAN', owner: 1, cx: 38, cy: 12 },
      { type: 'FLAMER', owner: 1, cx: 40, cy: 12 },
    ],
    objectives: [
      { id: 'radar', spec: { kind: 'DESTROY_TAG', tag: 'radar' } },
      { id: 'depot', spec: { kind: 'DESTROY_TAG', tag: 'depot' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'bruecke',
        when: { kind: 'AREA_ENTERED', team: 0, cx: 22, cy: 36, w: 4, h: 5 },
        actions: [{ kind: 'MESSAGE', msgId: 'bruecke' }],
      },
      {
        id: 'welle1',
        when: { kind: 'AT_TICK', tick: Math.round(1.5 * MIN) },
        actions: [
          {
            kind: 'SPAWN',
            units: [
              { type: 'RIFLEMAN', owner: 1, cx: 38, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
              { type: 'RIFLEMAN', owner: 1, cx: 39, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
              { type: 'DOG', owner: 1, cx: 40, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
            ],
          },
        ],
      },
      {
        id: 'welle2',
        when: { kind: 'AT_TICK', tick: 3 * MIN },
        actions: [
          { kind: 'MESSAGE', msgId: 'welle' },
          {
            kind: 'SPAWN',
            units: [
              { type: 'FLAMER', owner: 1, cx: 38, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
              { type: 'RIFLEMAN', owner: 1, cx: 39, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
              { type: 'RIFLEMAN', owner: 1, cx: 40, cy: 15, order: { kind: 'ATTACK_MOVE', cx: 9, cy: 40 } },
            ],
          },
        ],
      },
    ],
  };
}

const m01: CampaignMissionDef = {
  id: 'allies-01',
  campaign: 'allies',
  index: 0,
  title: 'Mission 1: Operation Leuchtfeuer',
  tagline: 'Kommandoeinsatz gegen die sowjetische Radarstation',
  briefing: [
    'Die Sowjets haben an der Küste eine Radarstation errichtet, die jede unserer Bewegungen meldet. Solange sie sendet, ist keine Landung möglich.',
    'Sie erhalten einen kleinen Stoßtrupp — mehr können wir unbemerkt nicht anlanden. Überqueren Sie den Fluss und zerstören Sie die Station.',
    'Es gibt keine Basis und keinen Nachschub. Jede Einheit zählt, Commander.',
  ],
  objectiveTexts: {
    radar: 'Zerstöre die sowjetische Radarstation',
    depot: 'Zerstöre das Nachschubdepot',
  },
  messages: {
    intro: 'Funkspruch: Stoßtrupp gelandet. Radarstation im Nordosten ausschalten!',
    bruecke: 'Vorsicht — die Brücke wird von Tesla-Spulen gedeckt!',
    welle: 'Feindliche Patrouille im Anmarsch!',
  },
  playerFaction: 'ALLIES',
  seed: 101,
  makeSimDef: m01Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 2 — Brückenkopf (Basisaufbau)
 * ------------------------------------------------------------------------- */

function m02Sim(): MissionDef {
  const map = newMap(64, 64, 'Brückenkopf');
  frame(map);
  scatter(map, TERRAIN_TREE, 150, 201);
  scatter(map, TERRAIN_ROCK, 70, 202);
  setSpawns(map, [
    [10, 52],
    [52, 10],
  ]);
  clearRect(map, 2, 44, 18, 18); // Spielerplateau
  clearRect(map, 42, 3, 20, 16); // KI-Basis
  clearRect(map, 28, 28, 8, 8); // Mitte fürs Lazarett
  orePatch(map, 16, 46, 3);
  orePatch(map, 46, 16, 3);
  orePatch(map, 32, 40, 2);
  orePatch(map, 24, 24, 1, RESOURCE_GEMS);
  const enemy = aiBase(1, 52, 10, 'SOVIETS');
  return {
    id: 'allies-02',
    map,
    players: [
      { faction: 'ALLIES', team: 0, credits: 6000, isAi: false },
      {
        faction: 'SOVIETS',
        team: 1,
        credits: 4000,
        isAi: true,
        aiDifficulty: 'easy',
        aiTuning: { incomeBonus: 4, firstAttackTick: 12 * MIN, riflemenCap: 3, vehicleCap: 3, airCap: 0, navalCap: 0 },
        name: 'Vorpostenkommando',
      },
    ],
    buildings: [
      ...enemy.buildings,
      { type: 'HOSPITAL', owner: -1, cx: 30, cy: 30, tag: 'lazarett' },
    ],
    units: [...mcvStart(0, 10, 52, 'ALLIES').units, ...enemy.units],
    objectives: [
      { id: 'vernichten', spec: { kind: 'DESTROY_ALL_ENEMIES' } },
      { id: 'lazarett', spec: { kind: 'CAPTURE_TAG', tag: 'lazarett' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'aufklaerung',
        when: { kind: 'AT_TICK', tick: 5 * MIN },
        actions: [{ kind: 'MESSAGE', msgId: 'aufklaerung' }],
      },
    ],
  };
}

const m02: CampaignMissionDef = {
  id: 'allies-02',
  campaign: 'allies',
  index: 1,
  title: 'Mission 2: Brückenkopf',
  tagline: 'Errichte eine Basis und wirf die Sowjets zurück',
  briefing: [
    'Der Radarschatten aus Ihrer letzten Operation hat uns ein Zeitfenster verschafft: Ein Bauhof-Konvoi hat die Küste erreicht.',
    'Errichten Sie eine Basis und vernichten Sie den sowjetischen Vorposten im Nordosten, bevor er Verstärkung erhält.',
    'Im Zentrum liegt ein verlassenes Lazarett — ein Ingenieur könnte es für uns nutzbar machen.',
  ],
  objectiveTexts: {
    vernichten: 'Vernichte alle sowjetischen Kräfte',
    lazarett: 'Erobere das Lazarett mit einem Ingenieur',
  },
  messages: {
    intro: 'Bauhof entfaltet? Dann Basis hochziehen — der Feind schläft nicht ewig.',
    aufklaerung: 'Aufklärung: Der sowjetische Vorposten rüstet auf. Beeilung, Commander!',
  },
  playerFaction: 'ALLIES',
  seed: 102,
  makeSimDef: m02Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 3 — Stille Übernahme (Eroberung)
 * ------------------------------------------------------------------------- */

function m03Sim(): MissionDef {
  const map = newMap(64, 64, 'Stille Übernahme');
  frame(map);
  scatter(map, TERRAIN_TREE, 160, 301);
  scatter(map, TERRAIN_ROCK, 80, 302);
  setSpawns(map, [
    [10, 32],
    [52, 32],
  ]);
  clearRect(map, 2, 24, 18, 18); // Spielerbasis
  clearRect(map, 42, 22, 20, 20); // KI-Basis
  orePatch(map, 16, 26, 3);
  orePatch(map, 46, 40, 3);
  orePatch(map, 31, 31, 2);
  const enemy = aiBase(1, 52, 32, 'SOVIETS');
  const base = playerBase(0, 10, 32, 'ALLIES');
  return {
    id: 'allies-03',
    map,
    players: [
      { faction: 'ALLIES', team: 0, credits: 8000, isAi: false },
      {
        faction: 'SOVIETS',
        team: 1,
        credits: 5000,
        isAi: true,
        aiDifficulty: 'easy',
        aiTuning: { incomeBonus: 6, firstAttackTick: 10 * MIN, vehicleCap: 4, airCap: 0, navalCap: 0 },
        name: 'Forschungsgarde',
      },
    ],
    buildings: [
      ...base.buildings,
      ...enemy.buildings,
      { type: 'TECHCENTER', owner: 1, cx: 56, cy: 24, tag: 'tech' },
      { type: 'TESLA', owner: 1, cx: 55, cy: 27, tag: 'riegel' },
      { type: 'TESLA', owner: 1, cx: 59, cy: 27, tag: 'riegel' },
    ],
    units: [
      ...base.units,
      { type: 'ENGINEER', owner: 0, cx: 12, cy: 34 },
      { type: 'ENGINEER', owner: 0, cx: 13, cy: 34 },
      ...enemy.units,
    ],
    objectives: [
      { id: 'tech', spec: { kind: 'CAPTURE_TAG', tag: 'tech' } },
      { id: 'riegel', spec: { kind: 'DESTROY_TAG', tag: 'riegel' }, optional: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      {
        id: 'ersatz',
        when: { kind: 'AT_TICK', tick: 8 * MIN },
        actions: [
          { kind: 'MESSAGE', msgId: 'ersatz' },
          {
            kind: 'SPAWN',
            units: [
              { type: 'ENGINEER', owner: 0, cx: 10, cy: 36 },
              { type: 'ENGINEER', owner: 0, cx: 11, cy: 36 },
            ],
          },
        ],
      },
    ],
  };
}

const m03: CampaignMissionDef = {
  id: 'allies-03',
  campaign: 'allies',
  index: 2,
  title: 'Mission 3: Stille Übernahme',
  tagline: 'Erobere das sowjetische Techzentrum — unversehrt',
  briefing: [
    'Im Osten forscht die Forschungsgarde der Sowjets an einer neuen Tesla-Generation. Das Techzentrum darf auf keinen Fall zerstört werden — wir brauchen die Daten intakt.',
    'Schlagen Sie sich mit Ingenieuren durch und übernehmen Sie das Gebäude. Fällt es, ist die Mission gescheitert.',
    'Zwei Tesla-Spulen riegeln das Zentrum ab. Schalten Sie sie aus, ohne das Ziel zu treffen.',
  ],
  objectiveTexts: {
    tech: 'Erobere das Techzentrum mit einem Ingenieur (es darf nicht zerstört werden!)',
    riegel: 'Zerstöre die beiden Tesla-Spulen am Techzentrum',
  },
  messages: {
    intro: 'Das Techzentrum brauchen wir unversehrt — Feuer einstellen in Zielnähe!',
    ersatz: 'Ersatz-Ingenieure sind an Ihrer Basis eingetroffen.',
  },
  playerFaction: 'ALLIES',
  seed: 103,
  makeSimDef: m03Sim,
};

/* ------------------------------------------------------------------------- *
 * Mission 4 — Sturmfront (Verteidigung + Gegenschlag)
 * ------------------------------------------------------------------------- */

function m04Sim(): MissionDef {
  const map = newMap(64, 64, 'Sturmfront');
  frame(map);
  scatter(map, TERRAIN_TREE, 140, 401);
  scatter(map, TERRAIN_ROCK, 90, 402);
  setSpawns(map, [
    [14, 50],
    [50, 14],
    [56, 27], // V3-Stellung (Garnisonsspieler)
  ]);
  clearRect(map, 4, 42, 20, 18); // Spielerbasis
  clearRect(map, 40, 4, 20, 18); // KI-Basis
  clearRect(map, 51, 23, 10, 9); // V3-Stellung
  orePatch(map, 22, 46, 3);
  orePatch(map, 44, 20, 3);
  orePatch(map, 30, 34, 2, RESOURCE_GEMS);
  const base = playerBase(0, 14, 50, 'ALLIES');
  const enemy = aiBase(1, 50, 14, 'SOVIETS');
  const wave = (tick: number, extra: boolean): MissionTriggerDef => ({
    id: `welle-${tick}`,
    when: { kind: 'AT_TICK', tick },
    actions: [
      { kind: 'MESSAGE', msgId: 'welle' },
      {
        kind: 'SPAWN',
        units: [
          { type: 'TANK', owner: 2, cx: 32, cy: 2, order: { kind: 'ATTACK_MOVE', cx: 14, cy: 50 } },
          { type: 'RIFLEMAN', owner: 2, cx: 34, cy: 2, order: { kind: 'ATTACK_MOVE', cx: 14, cy: 50 } },
          { type: 'RIFLEMAN', owner: 2, cx: 35, cy: 2, order: { kind: 'ATTACK_MOVE', cx: 14, cy: 50 } },
          ...(extra
            ? ([
                { type: 'FLAMER', owner: 2, cx: 36, cy: 2, order: { kind: 'ATTACK_MOVE', cx: 14, cy: 50 } },
                { type: 'TANK', owner: 2, cx: 33, cy: 2, order: { kind: 'ATTACK_MOVE', cx: 14, cy: 50 } },
              ] as const)
            : []),
        ],
      },
    ],
  });
  return {
    id: 'allies-04',
    map,
    players: [
      { faction: 'ALLIES', team: 0, credits: 10000, isAi: false },
      {
        faction: 'SOVIETS',
        team: 1,
        credits: 6000,
        isAi: true,
        aiDifficulty: 'normal',
        aiTuning: { incomeBonus: 10, firstAttackTick: 2 * MIN, attackCooldown: 700, attackStrength: 5, airCap: 0, navalCap: 0 },
        name: 'Sturmdivision',
      },
      { faction: 'SOVIETS', team: 1, credits: 0, isAi: false, name: 'V3-Stellung' },
    ],
    buildings: [...base.buildings, ...enemy.buildings],
    units: [
      ...base.units,
      { type: 'ROCKETEER', owner: 0, cx: 10, cy: 46 },
      { type: 'ROCKETEER', owner: 0, cx: 11, cy: 46 },
      ...enemy.units,
      { type: 'V3', owner: 2, cx: 54, cy: 26, tag: 'stellung' },
      { type: 'V3', owner: 2, cx: 56, cy: 26, tag: 'stellung' },
      { type: 'V3', owner: 2, cx: 58, cy: 26, tag: 'stellung' },
      { type: 'FLAK', owner: 2, cx: 55, cy: 29 },
      { type: 'FLAK', owner: 2, cx: 57, cy: 29 },
    ],
    objectives: [
      { id: 'halten', spec: { kind: 'SURVIVE_UNTIL', tick: 8 * MIN } },
      { id: 'stellung', spec: { kind: 'DESTROY_TAG', tag: 'stellung' }, hidden: true },
    ],
    triggers: [
      { id: 'intro', when: { kind: 'AT_TICK', tick: 15 }, actions: [{ kind: 'MESSAGE', msgId: 'intro' }] },
      wave(2 * MIN, false),
      wave(4 * MIN, false),
      wave(6 * MIN, true),
      wave(Math.round(7.5 * MIN), true),
      {
        id: 'gegenschlag',
        when: { kind: 'OBJECTIVE_STATUS', objectiveId: 'halten', status: 2 },
        actions: [
          { kind: 'REVEAL_OBJECTIVE', objectiveId: 'stellung' },
          { kind: 'MESSAGE', msgId: 'gegenschlag' },
          { kind: 'GRANT_CREDITS', player: 0, amount: 3000 },
          { kind: 'REVEAL_AREA', player: 0, cx: 56, cy: 27, radius: 8 },
        ],
      },
    ],
  };
}

const m04: CampaignMissionDef = {
  id: 'allies-04',
  campaign: 'allies',
  index: 3,
  title: 'Mission 4: Sturmfront',
  tagline: 'Halte die Stellung und zerschlage die V3-Batterie',
  briefing: [
    'Die Sturmdivision der Sowjets rollt auf Ihre Stellung zu. Die Front muss halten — mindestens acht Minuten, bis unsere Aufklärung die feindliche Artillerie geortet hat.',
    'Danach gilt: Gegenschlag. Irgendwo hinter der feindlichen Basis steht eine V3-Batterie in Stellung. Zerstören Sie sie, bevor sie feuerbereit ist.',
    'Das Oberkommando stellt nach der Abwehrphase zusätzliche Mittel bereit.',
  ],
  objectiveTexts: {
    halten: 'Halte deine Basis 8 Minuten',
    stellung: 'Zerstöre die V3-Batterie',
  },
  messages: {
    intro: 'Die Front hält, solange Ihre Basis steht. Acht Minuten, Commander!',
    welle: 'Sturmangriff von Norden — Abwehrstellungen besetzen!',
    gegenschlag: 'Aufklärung abgeschlossen: V3-Batterie geortet. Zerstören Sie sie — 3000 Credits Sonderbudget freigegeben.',
  },
  playerFaction: 'ALLIES',
  seed: 104,
  makeSimDef: m04Sim,
};

export const alliesMissions: CampaignMissionDef[] = [m01, m02, m03, m04];
