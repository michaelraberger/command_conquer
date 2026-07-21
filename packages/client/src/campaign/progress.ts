import { CAMPAIGN_IDS, type CampaignId } from './types.js';

/**
 * Campaign progress lives in localStorage (offline-first, like the Gefecht
 * mode) and is mirrored to the cloud when the user is logged in — see
 * net/campaignRepo.ts for the sync half. The shape below is what both sides
 * store; merges are per-mission unions so no device ever loses a completion.
 */

export interface MissionProgress {
  /** ISO timestamp of the first completion. */
  at: string;
  /** Fastest completion in sim ticks (15/s). */
  bestTimeTicks?: number;
}

export interface CampaignProgress {
  completed: Record<string, MissionProgress>;
}

export interface ProgressData {
  version: 1;
  campaigns: Record<CampaignId, CampaignProgress>;
}

const STORAGE_KEY = 'cac-campaign-progress';

const listeners = new Set<() => void>();

function emptyProgress(): ProgressData {
  return {
    version: 1,
    campaigns: { allies: { completed: {} }, soviets: { completed: {} } },
  };
}

/** Parses unknown JSON defensively — a broken blob resets to empty. */
function coerce(raw: unknown): ProgressData {
  const data = emptyProgress();
  if (typeof raw !== 'object' || raw === null) return data;
  const campaigns = (raw as { campaigns?: unknown }).campaigns;
  if (typeof campaigns !== 'object' || campaigns === null) return data;
  for (const id of CAMPAIGN_IDS) {
    const completed = (campaigns as Record<string, { completed?: unknown }>)[id]?.completed;
    if (typeof completed !== 'object' || completed === null) continue;
    for (const [missionId, entry] of Object.entries(completed as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const at = (entry as { at?: unknown }).at;
      const best = (entry as { bestTimeTicks?: unknown }).bestTimeTicks;
      data.campaigns[id].completed[missionId] = {
        at: typeof at === 'string' ? at : new Date(0).toISOString(),
        ...(typeof best === 'number' && Number.isFinite(best) ? { bestTimeTicks: best } : {}),
      };
    }
  }
  return data;
}

export function getProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? coerce(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function write(data: ProgressData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full/blocked — progress simply stays in memory for this session.
  }
  for (const cb of listeners) cb();
}

export function isCompleted(campaign: CampaignId, missionId: string): boolean {
  return missionId in getProgress().campaigns[campaign].completed;
}

export function completedCount(campaign: CampaignId): number {
  return Object.keys(getProgress().campaigns[campaign].completed).length;
}

/**
 * Mission N+1 unlocks once mission N is done; the first is always open.
 * Takes the ordered mission-id list so the store needs no mission catalog.
 */
export function isUnlocked(campaign: CampaignId, orderedIds: readonly string[], index: number): boolean {
  if (index <= 0) return true;
  const prev = orderedIds[index - 1];
  return prev !== undefined && isCompleted(campaign, prev);
}

export function markCompleted(
  campaign: CampaignId,
  missionId: string,
  stats: { timeTicks?: number } = {},
): void {
  const data = getProgress();
  const prev = data.campaigns[campaign].completed[missionId];
  const best =
    stats.timeTicks === undefined
      ? prev?.bestTimeTicks
      : prev?.bestTimeTicks === undefined
        ? stats.timeTicks
        : Math.min(prev.bestTimeTicks, stats.timeTicks);
  data.campaigns[campaign].completed[missionId] = {
    at: prev?.at ?? new Date().toISOString(),
    ...(best !== undefined ? { bestTimeTicks: best } : {}),
  };
  write(data);
  // Cloud mirror is fire-and-forget; offline/logged-out is a silent no-op.
  void import('../net/campaignRepo.js')
    .then(({ pushProgress }) => pushProgress())
    .catch(() => undefined);
}

/** Per-mission union of two blobs: completed wins, earliest date, best time. */
export function mergeProgress(a: ProgressData, b: ProgressData): ProgressData {
  const out = emptyProgress();
  for (const id of CAMPAIGN_IDS) {
    const missions = new Set([
      ...Object.keys(a.campaigns[id].completed),
      ...Object.keys(b.campaigns[id].completed),
    ]);
    for (const m of missions) {
      const ea = a.campaigns[id].completed[m];
      const eb = b.campaigns[id].completed[m];
      const at = ea && eb ? (ea.at < eb.at ? ea.at : eb.at) : (ea?.at ?? eb!.at);
      const times = [ea?.bestTimeTicks, eb?.bestTimeTicks].filter(
        (t): t is number => typeof t === 'number',
      );
      out.campaigns[id].completed[m] = {
        at,
        ...(times.length > 0 ? { bestTimeTicks: Math.min(...times) } : {}),
      };
    }
  }
  return out;
}

/** Replaces the local blob (after a cloud merge) and notifies the UI. */
export function replaceProgress(data: ProgressData): void {
  write(coerce(data));
}

export function onProgressChange(cb: () => void): void {
  listeners.add(cb);
}
