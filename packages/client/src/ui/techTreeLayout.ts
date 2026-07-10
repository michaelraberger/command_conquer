import {
  BUILDING_RULES,
  UNIT_RULES,
  availableToFaction,
  buildingRule,
  isBuildingType,
  techRule,
  unitRule,
  type BuildingRule,
  type BuildingType,
  type Faction,
  type TechId,
  type UnitCategory,
  type UnitRule,
  type UnitType,
} from '@cac/sim';

/**
 * Pure layout math for the tech-tree overlay (no DOM): turns the rules tables
 * into positioned nodes and orthogonal SVG connector paths, in the style of
 * the classic C&C tech-tree posters — Bauhof at the bottom, higher tech above.
 * All coordinates are in content pixels; the overlay scrolls the whole canvas,
 * so nothing here ever depends on viewport size.
 */

export const TILE_W = 108;
export const TILE_H = 64;
const GAP_X = 14;
/** Vertical gap between tiers; the horizontal edge "buses" run inside it. */
const GAP_Y = 46;
const BAND_GAP = 40;
const PAD = 24;

/** Vertical lanes, left to right. Buildings without a production category sit
 *  in the band of their primary prerequisite (recursively), Bauhof in `base`. */
type Branch = 'infantry' | 'base' | 'vehicle' | 'air' | 'naval';
const BRANCH_ORDER: readonly Branch[] = ['infantry', 'base', 'vehicle', 'air', 'naval'];

const CATEGORY_ICONS: Record<'building' | UnitCategory, string> = {
  building: '🏭',
  infantry: '👥',
  vehicle: '🚙',
  air: '🚁',
  naval: '⚓',
};

export interface TreeNode {
  item: string;
  kind: 'building' | 'unit';
  name: string;
  cost: number;
  /** Power delta (buildings only, omitted when 0). */
  power?: number;
  categoryIcon: string;
  tech?: TechId;
  unique?: boolean;
  /** Reached by upgrading `upgradeOf` in place, not via the build queue. */
  upgradeOf?: string;
  /** Buildings that must stand for this node to count as available — for
   *  upgrade nodes that is the base building, not the rule's `requires`. */
  statusRequires: readonly string[];
  tooltip: string;
  x: number;
  y: number;
  tier: number;
}

export interface TreeEdge {
  from: string;
  to: string;
  /** SVG path `d` string (orthogonal segments). */
  path: string;
  kind: 'requires' | 'upgrade';
}

export interface TechTreeLayout {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
}

export function computeTechTree(faction: Faction): TechTreeLayout {
  // --- Node set -------------------------------------------------------------
  // Upgrade targets (ADVPOWER, AGT) are buildable:false but real structures;
  // they hang off their base building with a dashed edge.
  const upgradeBase = new Map<string, string>();
  for (const type of Object.keys(BUILDING_RULES) as BuildingType[]) {
    const rule = buildingRule(type);
    if (rule.upgradeTo !== undefined && availableToFaction(rule.factions, faction)) {
      upgradeBase.set(rule.upgradeTo, type);
    }
  }

  const buildings = (Object.keys(BUILDING_RULES) as BuildingType[]).filter((type) => {
    const rule = buildingRule(type);
    if (!availableToFaction(rule.factions, faction)) return false;
    return rule.buildable || type === 'CONYARD' || type === 'WALL' || upgradeBase.has(type);
  });
  const units = (Object.keys(UNIT_RULES) as UnitType[]).filter((type) => {
    const rule = unitRule(type);
    return rule.hidden !== true && availableToFaction(rule.factions, faction);
  });
  const included = new Set<string>([...buildings, ...units]);

  // --- Tiers (longest path up from the Bauhof) --------------------------------
  // Tech-gated items get an implicit TECHCENTER parent for tier computation
  // only — in practice they are unreachable before it stands — but no edge is
  // drawn for it (the 🔬 badge carries that information).
  const parentsOf = (item: string): string[] => {
    const base = upgradeBase.get(item);
    if (base !== undefined) return [base];
    const rule = ruleOf(item);
    const parents = rule.requires.filter((req) => included.has(req));
    if (rule.tech !== undefined && included.has('TECHCENTER') && !parents.includes('TECHCENTER')) {
      parents.push('TECHCENTER');
    }
    return parents;
  };

  const tiers = new Map<string, number>();
  const tierOf = (item: string): number => {
    const memo = tiers.get(item);
    if (memo !== undefined) return memo;
    const parents = parentsOf(item);
    const tier = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(tierOf));
    tiers.set(item, tier);
    return tier;
  };

  // --- Branch bands -----------------------------------------------------------
  const branches = new Map<string, Branch>();
  const branchOf = (item: string): Branch => {
    const memo = branches.get(item);
    if (memo !== undefined) return memo;
    let branch: Branch;
    if (!isBuildingType(item)) {
      branch = unitRule(item as UnitType).category;
    } else if (buildingRule(item).produces !== null) {
      branch = buildingRule(item).produces as Branch;
    } else {
      const parents = parentsOf(item).filter((p) => !(buildingRule(item).tech !== undefined && p === 'TECHCENTER'));
      branch = parents.length === 0 ? 'base' : branchOf(parents[0]!);
    }
    branches.set(item, branch);
    return branch;
  };

  // Group into (tier, branch) cells with a deterministic in-cell order:
  // buildings before units, then by cost, then by name.
  const cells = new Map<string, string[]>();
  let maxTier = 0;
  for (const item of included) {
    const tier = tierOf(item);
    maxTier = Math.max(maxTier, tier);
    const key = `${tier}:${branchOf(item)}`;
    (cells.get(key) ?? cells.set(key, []).get(key)!).push(item);
  }
  for (const list of cells.values()) {
    list.sort((a, b) => {
      const aBuilding = isBuildingType(a) ? 0 : 1;
      const bBuilding = isBuildingType(b) ? 0 : 1;
      if (aBuilding !== bBuilding) return aBuilding - bBuilding;
      const aRule = ruleOf(a);
      const bRule = ruleOf(b);
      if (aRule.cost !== bRule.cost) return aRule.cost - bRule.cost;
      return a < b ? -1 : 1;
    });
  }

  // Band width = widest cell of that branch across all tiers.
  const bandWidths = new Map<Branch, number>();
  for (const branch of BRANCH_ORDER) {
    let maxCount = 0;
    for (let tier = 0; tier <= maxTier; tier++) {
      maxCount = Math.max(maxCount, cells.get(`${tier}:${branch}`)?.length ?? 0);
    }
    if (maxCount > 0) bandWidths.set(branch, maxCount * TILE_W + (maxCount - 1) * GAP_X);
  }
  const bandLefts = new Map<Branch, number>();
  let cursor = PAD;
  for (const branch of BRANCH_ORDER) {
    const width = bandWidths.get(branch);
    if (width === undefined) continue;
    bandLefts.set(branch, cursor);
    cursor += width + BAND_GAP;
  }
  const totalWidth = cursor - BAND_GAP + PAD;
  const totalHeight = PAD * 2 + (maxTier + 1) * TILE_H + maxTier * GAP_Y;
  const yOf = (tier: number): number => PAD + (maxTier - tier) * (TILE_H + GAP_Y);

  // --- Positioned nodes -------------------------------------------------------
  const nodes: TreeNode[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  for (let tier = 0; tier <= maxTier; tier++) {
    for (const branch of BRANCH_ORDER) {
      const list = cells.get(`${tier}:${branch}`);
      if (list === undefined) continue;
      const groupWidth = list.length * TILE_W + (list.length - 1) * GAP_X;
      const startX = Math.round(bandLefts.get(branch)! + (bandWidths.get(branch)! - groupWidth) / 2);
      list.forEach((item, slot) => {
        const x = startX + slot * (TILE_W + GAP_X);
        const y = yOf(tier);
        positions.set(item, { x, y });
        nodes.push(makeNode(item, upgradeBase.get(item), x, y, tier));
      });
    }
  }

  // --- Orthogonal edges -------------------------------------------------------
  // Per child-tier gap, spread overlapping horizontal runs across a few lanes.
  const edges: TreeEdge[] = [];
  const raw: Array<{ from: string; to: string; kind: TreeEdge['kind'] }> = [];
  for (const item of included) {
    const base = upgradeBase.get(item);
    if (base !== undefined) {
      raw.push({ from: base, to: item, kind: 'upgrade' });
      continue;
    }
    for (const req of ruleOf(item).requires) {
      if (included.has(req)) raw.push({ from: req, to: item, kind: 'requires' });
    }
  }
  raw.sort((a, b) => {
    const ax = positions.get(a.to)!.x - positions.get(b.to)!.x;
    return ax !== 0 ? ax : positions.get(a.from)!.x - positions.get(b.from)!.x;
  });
  const laneCounters = new Map<number, number>();
  for (const { from, to, kind } of raw) {
    const parent = positions.get(from)!;
    const child = positions.get(to)!;
    const x1 = parent.x + TILE_W / 2;
    const x2 = child.x + TILE_W / 2;
    const y2 = child.y + TILE_H;
    const childTier = tierOf(to);
    const lane = laneCounters.get(childTier) ?? 0;
    laneCounters.set(childTier, lane + 1);
    const busY = y2 + GAP_Y / 2 + ((lane % 5) * 5 - 10);
    const path =
      x1 === x2 ? `M ${x1} ${parent.y} V ${y2}` : `M ${x1} ${parent.y} V ${busY} H ${x2} V ${y2}`;
    edges.push({ from, to, path, kind });
  }

  return { nodes, edges, width: totalWidth, height: totalHeight };
}

function ruleOf(item: string): UnitRule | BuildingRule {
  return isBuildingType(item) ? buildingRule(item) : unitRule(item as UnitType);
}

function makeNode(item: string, upgradeOf: string | undefined, x: number, y: number, tier: number): TreeNode {
  const building = isBuildingType(item);
  const rule = ruleOf(item);
  const power = building ? buildingRule(item as BuildingType).power : 0;
  const unique = building && buildingRule(item as BuildingType).unique === true;
  const statusRequires = upgradeOf !== undefined ? [upgradeOf] : rule.requires;

  const lines = [`${rule.name} – $${rule.cost}`];
  if (power !== 0) lines.push(`Strom: ${power > 0 ? '+' : '−'}${Math.abs(power)}`);
  if (upgradeOf !== undefined) {
    lines.push(`Ausbau von: ${buildingRule(upgradeOf as BuildingType).name}`);
  } else if (rule.requires.length > 0) {
    lines.push(`Voraussetzungen: ${rule.requires.map((r) => buildingRule(r as BuildingType).name).join(', ')}`);
  }
  if (rule.tech !== undefined) lines.push(`Forschung: ${techRule(rule.tech).name}`);
  if (unique) lines.push('Nur einmal baubar');

  return {
    item,
    kind: building ? 'building' : 'unit',
    name: rule.name,
    cost: rule.cost,
    ...(power !== 0 ? { power } : {}),
    categoryIcon: building ? CATEGORY_ICONS.building : CATEGORY_ICONS[(rule as UnitRule).category],
    ...(rule.tech !== undefined ? { tech: rule.tech } : {}),
    ...(unique ? { unique } : {}),
    ...(upgradeOf !== undefined ? { upgradeOf } : {}),
    statusRequires,
    tooltip: lines.join('\n'),
    x,
    y,
    tier,
  };
}
