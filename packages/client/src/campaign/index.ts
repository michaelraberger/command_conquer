import { alliesMissions } from './missions/allies.js';
import { sovietsMissions } from './missions/soviets.js';
import { CAMPAIGN_TITLES, type CampaignId, type CampaignMissionDef } from './types.js';

export {
  CAMPAIGN_IDS,
  CAMPAIGN_LENGTH,
  CAMPAIGN_TITLES,
  type CampaignId,
  type CampaignMissionDef,
  type CampaignRef,
} from './types.js';

/** Ordered mission catalogs per campaign (stage 1: the first four each). */
export const CAMPAIGNS: Record<CampaignId, { title: string; missions: CampaignMissionDef[] }> = {
  allies: { title: CAMPAIGN_TITLES.allies, missions: alliesMissions },
  soviets: { title: CAMPAIGN_TITLES.soviets, missions: sovietsMissions },
};

const byId = new Map<string, CampaignMissionDef>();
for (const campaign of Object.values(CAMPAIGNS)) {
  for (const mission of campaign.missions) byId.set(mission.id, mission);
}

export function getMission(id: string): CampaignMissionDef | undefined {
  return byId.get(id);
}

/** The mission after `id` inside its campaign, if it exists (yet). */
export function nextMission(id: string): CampaignMissionDef | undefined {
  const mission = byId.get(id);
  if (!mission) return undefined;
  return CAMPAIGNS[mission.campaign].missions[mission.index + 1];
}
