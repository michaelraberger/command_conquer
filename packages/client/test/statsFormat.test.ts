import { describe, expect, it } from 'vitest';
import { emptyStats, TICKS_PER_SECOND } from '@cac/sim';
import { formatTicks, statTotal, statsToTotals } from '../src/ui/statsTable.js';

describe('stats formatting (pure)', () => {
  it('statTotal sums a per-type record, empty record is 0', () => {
    expect(statTotal({})).toBe(0);
    expect(statTotal({ TANK: 3, RIFLEMAN: 2 })).toBe(5);
  });

  it('formatTicks renders mm:ss and switches to h:mm:ss past the hour', () => {
    expect(formatTicks(0)).toBe('0:00');
    expect(formatTicks(TICKS_PER_SECOND * 59)).toBe('0:59');
    expect(formatTicks(TICKS_PER_SECOND * 60)).toBe('1:00');
    expect(formatTicks(TICKS_PER_SECOND * (12 * 60 + 5))).toBe('12:05');
    expect(formatTicks(TICKS_PER_SECOND * 3600)).toBe('1:00:00');
    expect(formatTicks(TICKS_PER_SECOND * (3600 + 61))).toBe('1:01:01');
  });

  it('statsToTotals flattens per-type records into career totals', () => {
    const stats = emptyStats();
    stats.unitsKilled.TANK = 2;
    stats.unitsKilled.RIFLEMAN = 1;
    stats.buildingsBuilt.POWER = 4;
    stats.healingDone = 123;
    stats.creditsHarvested = 4500;
    stats.cratesCollected = 2;
    const totals = statsToTotals(stats);
    expect(totals).toEqual({
      unitsKilled: 3,
      unitsLost: 0,
      unitsProduced: 0,
      buildingsKilled: 0,
      buildingsLost: 0,
      buildingsBuilt: 4,
      healingDone: 123,
      creditsHarvested: 4500,
      cratesCollected: 2,
    });
  });
});
