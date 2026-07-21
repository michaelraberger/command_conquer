import type { Faction, MissionDef } from '@cac/sim';

/** The two per-faction campaigns ("Kampagne"). */
export type CampaignId = 'allies' | 'soviets';

export const CAMPAIGN_IDS: readonly CampaignId[] = ['allies', 'soviets'];

export const CAMPAIGN_TITLES: Record<CampaignId, string> = {
  allies: 'Alliierte Kampagne',
  soviets: 'Sowjetische Kampagne',
};

/** Missions per campaign when complete; stage 1 ships the first four each. */
export const CAMPAIGN_LENGTH = 12;

/**
 * One campaign mission: menu/briefing metadata plus a factory for the sim-side
 * MissionDef. The factory is lazy so opening the menu never builds map layers;
 * building one is cheap (<1 ms) and pure — same def every call.
 */
export interface CampaignMissionDef {
  /** Equals the sim def's id, e.g. 'allies-01'. Globally unique. */
  id: string;
  campaign: CampaignId;
  /** 0-based position inside the campaign (unlock order). */
  index: number;
  /** 'Mission 3: Operation …' */
  title: string;
  /** One-liner for the mission list. */
  tagline: string;
  /** Briefing paragraphs (German, RA2 flavor). */
  briefing: string[];
  /** objectiveId → German text (briefing list + in-game objectives HUD). */
  objectiveTexts: Record<string, string>;
  /** msgId → German text for MISSION_MESSAGE trigger events. */
  messages?: Record<string, string>;
  playerFaction: Faction;
  /** Fixed seed: the whole mission is deterministic and replayable. */
  seed: number;
  makeSimDef: () => MissionDef;
}

/** Reference a running game keeps so saves/end screen know their mission. */
export interface CampaignRef {
  campaignId: CampaignId;
  missionId: string;
}
