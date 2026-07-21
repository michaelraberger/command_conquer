import { describe, expect, it } from 'vitest';
import {
  buildingRule,
  createGame,
  findPath,
  powerBalance,
  tick,
  unitRule,
  validateCustomMap,
  validateMissionDef,
  type GameState,
} from '@cac/sim';
import { CAMPAIGNS, CAMPAIGN_IDS, getMission } from '../src/campaign/index.js';
import { mergeProgress, type ProgressData } from '../src/campaign/progress.js';

describe('Kampagnen-Katalog', () => {
  it('has contiguous, uniquely-identified missions per campaign', () => {
    const seen = new Set<string>();
    for (const id of CAMPAIGN_IDS) {
      const missions = CAMPAIGNS[id].missions;
      expect(missions.length).toBeGreaterThan(0);
      missions.forEach((m, i) => {
        expect(m.campaign).toBe(id);
        expect(m.index).toBe(i);
        expect(seen.has(m.id)).toBe(false);
        seen.add(m.id);
        expect(getMission(m.id)).toBe(m);
      });
    }
  });

  it('every mission def and map validates and objective texts are complete', () => {
    for (const id of CAMPAIGN_IDS) {
      for (const mission of CAMPAIGNS[id].missions) {
        const def = mission.makeSimDef();
        expect(def.id).toBe(mission.id);
        const mapCheck = validateCustomMap(def.map);
        expect(mapCheck.errors, `${mission.id}: ${mapCheck.errors.join(' ')}`).toEqual([]);
        const check = validateMissionDef(def);
        expect(check.errors, `${mission.id}: ${check.errors.join(' ')}`).toEqual([]);
        for (const o of def.objectives) {
          expect(mission.objectiveTexts[o.id], `${mission.id}: Text für Ziel „${o.id}" fehlt`).toBeTruthy();
        }
        for (const t of def.triggers) {
          for (const a of t.actions) {
            if (a.kind === 'MESSAGE') {
              expect(mission.messages?.[a.msgId], `${mission.id}: Text für Meldung „${a.msgId}" fehlt`).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it('every mission starts and survives the first 30 seconds of sim time', () => {
    for (const id of CAMPAIGN_IDS) {
      for (const mission of CAMPAIGNS[id].missions) {
        const state = createGame(mission.seed, { mission: mission.makeSimDef() });
        for (let i = 0; i < 450; i++) tick(state);
        expect(state.winner, `${mission.id} endete sofort`).toBe(-1);
      }
    }
  });

  it('mission defs are deterministic (two builds are deep-equal)', () => {
    for (const id of CAMPAIGN_IDS) {
      for (const mission of CAMPAIGNS[id].missions) {
        expect(mission.makeSimDef()).toEqual(mission.makeSimDef());
      }
    }
  });
});

describe('Missions-Lint (Logikfehler-Wächter)', () => {
  const eachMissionState = (fn: (label: string, state: GameState) => void): void => {
    for (const id of CAMPAIGN_IDS) {
      for (const mission of CAMPAIGNS[id].missions) {
        fn(mission.id, createGame(mission.seed, { mission: mission.makeSimDef() }));
      }
    }
  };

  it('no player starts with dark defense towers (power deficit)', () => {
    // A tower that needs power but has none never fires — exactly the
    // Mission-1 tesla bug. Manned towers (Wachturm) are exempt by design.
    const offenders: string[] = [];
    eachMissionState((label, state) => {
      for (const p of state.players) {
        const darkTowers = state.buildings.filter((b) => {
          const rule = buildingRule(b.type);
          return b.owner === p.id && rule.weapon !== null && rule.power < 0 && rule.manned !== true;
        });
        if (darkTowers.length === 0) continue;
        const { produced, used } = powerBalance(state, p.id);
        if (used > produced) {
          offenders.push(
            `${label}: Spieler ${p.id} (${p.name}) hat ${darkTowers.length} stromlose Verteidigungstürme (${used}/${produced})`,
          );
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it('every tagged objective target is ground-reachable from the player start', () => {
    const offenders: string[] = [];
    eachMissionState((label, state) => {
      const from = state.units.find(
        (u) => u.owner === 0 && unitRule(u.type).air !== true && unitRule(u.type).category !== 'naval',
      );
      if (!from) return; // pure air/naval mission: nothing to check here
      const fromCx = from.cell % state.mapWidth;
      const fromCy = (from.cell - fromCx) / state.mapWidth;
      const targets = [
        ...state.buildings.filter((b) => b.tag !== undefined),
        ...state.units.filter((u) => u.tag !== undefined && u.owner !== 0),
      ];
      for (const t of targets) {
        const tcx = 'cx' in t && typeof t.cx === 'number' ? t.cx : (t as { cell: number }).cell % state.mapWidth;
        const tcy = 'cy' in t && typeof t.cy === 'number' ? t.cy : Math.floor((t as { cell: number }).cell / state.mapWidth);
        const path = findPath(state, fromCx, fromCy, tcx, tcy, {
          avoidUnits: false,
          selfId: from.id,
          owner: 0,
        });
        const end = path?.[path.length - 1];
        const near = end !== undefined && Math.max(Math.abs(end.cx - tcx), Math.abs(end.cy - tcy)) <= 3;
        if (!near) {
          offenders.push(`${label}: Ziel „${t.tag}" bei (${tcx},${tcy}) ist vom Start aus nicht erreichbar`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });

  it('trigger areas and spawn anchors lie inside the map', () => {
    const offenders: string[] = [];
    for (const id of CAMPAIGN_IDS) {
      for (const mission of CAMPAIGNS[id].missions) {
        const def = mission.makeSimDef();
        const w = def.map.width;
        const h = def.map.height;
        for (const trig of def.triggers) {
          if (trig.when.kind === 'AREA_ENTERED') {
            const a = trig.when;
            if (a.cx < 0 || a.cy < 0 || a.cx + a.w > w || a.cy + a.h > h) {
              offenders.push(`${mission.id}: Trigger „${trig.id}" Fläche ragt aus der Karte`);
            }
          }
          for (const action of trig.actions) {
            if (action.kind !== 'SPAWN') continue;
            for (const u of action.units) {
              if (u.cx < 1 || u.cy < 1 || u.cx >= w - 1 || u.cy >= h - 1) {
                offenders.push(`${mission.id}: Trigger „${trig.id}" spawnt außerhalb/am Rand (${u.cx},${u.cy})`);
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('Fortschritts-Merge', () => {
  const blob = (missions: Record<string, { at: string; bestTimeTicks?: number }>): ProgressData => ({
    version: 1,
    campaigns: { allies: { completed: missions }, soviets: { completed: {} } },
  });

  it('unions completions, keeps earliest date and best time', () => {
    const a = blob({ 'allies-01': { at: '2026-01-01T00:00:00Z', bestTimeTicks: 9000 } });
    const b = blob({
      'allies-01': { at: '2026-02-01T00:00:00Z', bestTimeTicks: 7000 },
      'allies-02': { at: '2026-03-01T00:00:00Z' },
    });
    const merged = mergeProgress(a, b);
    expect(merged.campaigns.allies.completed['allies-01']).toEqual({
      at: '2026-01-01T00:00:00Z',
      bestTimeTicks: 7000,
    });
    expect(merged.campaigns.allies.completed['allies-02']).toEqual({ at: '2026-03-01T00:00:00Z' });
  });
});
