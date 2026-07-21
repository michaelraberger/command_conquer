import { describe, expect, it } from 'vitest';
import { createGame, tick, validateCustomMap, validateMissionDef } from '@cac/sim';
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
