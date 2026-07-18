import {
  cellIndex,
  cellsAroundRect,
  inBounds,
  isBuildableTerrain,
  isNavigableWater,
  isPassableTerrain,
} from './map.js';
import { findPath } from './path/astar.js';
import { cellCenter } from './fixed.js';
import {
  CHEAT_MONEY,
  CHEAT_POWER,
  SUPERWEAPON_CHARGE_TICKS,
  type SuperweaponKind,
  SUPERWEAPON_TRAVEL_TICKS,
  WALL_LEVELS,
  buildingRule,
  sellRefund,
  unitRule,
  type BuildingType,
  type ProductionCategory,
} from './rules.js';
import { areEnemies, constructBuilding, type GameState, type PathCell, type Unit } from './state.js';
import { crashBoundJets } from './systems/airbase.js';
import { launchParadrop } from './systems/paradrop.js';
import { findTarget, isAir, isNaval, targetOwner } from './targeting.js';
import { canPlaceBuilding } from './systems/placement.js';
import {
  cancelProduction,
  cancelResearch,
  placeQueuedBuilding,
  startProduction,
  startResearch,
} from './systems/production.js';

/**
 * Commands are the ONLY external mutation entry point into the sim. Target
 * coordinates are cell coordinates.
 */
export type Command =
  | { type: 'MOVE'; playerId: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'ATTACK'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'ATTACK_MOVE'; playerId: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'STOP'; playerId: number; unitIds: number[] }
  | { type: 'HARVEST'; playerId: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'REPAIR'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'BUILD_START'; playerId: number; item: string }
  | { type: 'BUILD_CANCEL'; playerId: number; category: ProductionCategory }
  | { type: 'PLACE_BUILDING'; playerId: number; cx: number; cy: number }
  | { type: 'PLACE_WALL'; playerId: number; cx: number; cy: number }
  | { type: 'UPGRADE_BUILDING'; playerId: number; buildingId: number }
  | { type: 'SELL_BUILDING'; playerId: number; buildingId: number }
  | { type: 'SET_RALLY'; playerId: number; buildingId: number; cx: number; cy: number }
  | { type: 'FIRE_SUPERWEAPON'; playerId: number; cx: number; cy: number; kind?: SuperweaponKind }
  | { type: 'PARADROP'; playerId: number; cx: number; cy: number }
  | { type: 'LOAD'; playerId: number; unitIds: number[]; transportId: number }
  | { type: 'UNLOAD'; playerId: number; unitIds: number[] }
  | { type: 'INFILTRATE'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'CAPTURE'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'HOLD'; playerId: number; unitIds: number[] }
  | { type: 'PATROL'; playerId: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'ESCORT'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'DEPLOY'; playerId: number; unitIds: number[] }
  | { type: 'RESEARCH_START'; playerId: number; tech: string }
  | { type: 'RESEARCH_CANCEL'; playerId: number }
  | { type: 'CHEAT'; playerId: number; cheat: 'MONEY' | 'REVEAL' | 'POWER' | 'MOTHERLOAD' };

export function applyCommands(state: GameState, commands: Command[]): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'MOVE':
        applyMove(state, cmd);
        break;
      case 'ATTACK': {
        const target = findTarget(state, cmd.targetId);
        if (!target || targetOwner(target) === cmd.playerId) break;
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unitRule(unit.type).weapon === null) continue; // harvesters can't attack
          unit.order = { kind: 'ATTACK', targetId: cmd.targetId };
          unit.path = null; // combat system takes over pathing (chase)
          unit.pathIndex = 0;
        }
        break;
      }
      case 'ATTACK_MOVE': {
        const all = ownedUnits(state, cmd.unitIds, cmd.playerId);
        const groups: Array<{ units: Unit[]; water: boolean }> = [
          { units: all.filter((u) => !isNaval(u)), water: false },
          { units: all.filter((u) => isNaval(u)), water: true },
        ];
        for (const { units, water } of groups) {
          if (units.length === 0) continue;
          const targets = assignTargetCells(state, cmd.cx, cmd.cy, units.length, water);
          if (targets.length === 0) continue;
          for (let i = 0; i < units.length; i++) {
            const unit = units[i]!;
            const t = targets[i] ?? targets[targets.length - 1]!;
            if (unitRule(unit.type).weapon === null) {
              // Weaponless units treat attack-move as a plain move.
              moveUnitTo(state, unit, t.cx, t.cy);
              continue;
            }
            unit.order = { kind: 'ATTACK_MOVE', cx: t.cx, cy: t.cy };
            unit.path = null; // combat system paths toward the order cell
            unit.pathIndex = 0;
          }
        }
        break;
      }
      case 'STOP':
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          unit.order = null;
          unit.path = null;
          unit.pathIndex = 0;
          unit.blockedTicks = 0;
          unit.repathCount = 0;
        }
        break;
      case 'HARVEST':
        if (!inBounds(state, cmd.cx, cmd.cy)) break;
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unit.type !== 'HARVESTER') continue;
          unit.order = { kind: 'HARVEST', cx: cmd.cx, cy: cmd.cy };
          unit.path = null;
          unit.pathIndex = 0;
        }
        break;
      case 'REPAIR': {
        // The repair vehicle mends own buildings AND own units (vehicles,
        // infantry, …). Pick whichever the target id refers to.
        const building = state.buildings.find((b) => b.id === cmd.targetId);
        const targetUnit = state.units.find((u) => u.id === cmd.targetId);
        const ownBuilding = building && building.owner === cmd.playerId;
        const ownUnit = targetUnit && targetUnit.owner === cmd.playerId;
        if (!ownBuilding && !ownUnit) break;
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unit.type !== 'REPAIR') continue; // only the repair vehicle repairs
          if (ownUnit && targetUnit.id === unit.id) continue; // never repair itself
          unit.order = ownBuilding
            ? { kind: 'REPAIR_BUILDING', targetId: cmd.targetId }
            : { kind: 'REPAIR_UNIT', targetId: cmd.targetId };
          unit.path = null; // repair system takes over pathing (chase)
          unit.pathIndex = 0;
        }
        break;
      }
      case 'BUILD_START':
        startProduction(state, cmd.playerId, cmd.item);
        break;
      case 'DEPLOY': {
        // A Baufahrzeug (MCV) unfolds in place into a fresh construction yard,
        // so long as its 3×3 footprint (centred on the MCV) is clear.
        const deployed = new Set<number>();
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unit.type !== 'MCV' || deployed.has(unit.id)) continue;
          const bx = (unit.cell % state.mapWidth) - 1;
          const by = Math.floor(unit.cell / state.mapWidth) - 1;
          let clear = true;
          for (let y = by; y < by + 3 && clear; y++) {
            for (let x = bx; x < bx + 3; x++) {
              if (!inBounds(state, x, y) || !isBuildableTerrain(state, x, y)) { clear = false; break; }
              const idx = cellIndex(state, x, y);
              const occ = state.occupancy[idx];
              if (state.structures[idx] !== 0 || (occ !== 0 && occ !== unit.id)) { clear = false; break; }
            }
          }
          if (!clear) continue;
          if (state.occupancy[unit.cell] === unit.id) state.occupancy[unit.cell] = 0;
          deployed.add(unit.id);
          constructBuilding(state, 'CONYARD', cmd.playerId, bx, by);
        }
        if (deployed.size > 0) state.units = state.units.filter((u) => !deployed.has(u.id));
        break;
      }
      case 'RESEARCH_START':
        startResearch(state, cmd.playerId, cmd.tech);
        break;
      case 'RESEARCH_CANCEL':
        cancelResearch(state, cmd.playerId);
        break;
      case 'BUILD_CANCEL':
        cancelProduction(state, cmd.playerId, cmd.category);
        break;
      case 'PLACE_BUILDING':
        placeQueuedBuilding(state, cmd.playerId, cmd.cx, cmd.cy);
        break;
      case 'PLACE_WALL': {
        const player = state.players.find((p) => p.id === cmd.playerId);
        const cost = buildingRule('WALL').cost;
        if (!player || player.credits < cost) break;
        if (!canPlaceBuilding(state, cmd.playerId, 'WALL', cmd.cx, cmd.cy)) break;
        player.credits -= cost;
        constructBuilding(state, 'WALL', cmd.playerId, cmd.cx, cmd.cy);
        break;
      }
      case 'UPGRADE_BUILDING': {
        const player = state.players.find((p) => p.id === cmd.playerId);
        const building = state.buildings.find(
          (b) => b.id === cmd.buildingId && b.owner === cmd.playerId,
        );
        if (!player || !building) break;
        if (building.type === 'WALL') {
          if (building.level >= WALL_LEVELS.length) break;
          const next = WALL_LEVELS[building.level]!;
          if (player.credits < next.upgradeCost) break;
          player.credits -= next.upgradeCost;
          building.level++;
          building.hp = next.maxHp; // upgrading fully repairs the wall
          break;
        }
        // In-place type upgrade (Wachturm → AGT): pay upfront and start a timed
        // conversion. The building keeps working as its current type until the
        // upgrade finishes (see buildingUpgradeSystem). One at a time.
        if (building.upgrade) break;
        const rule = buildingRule(building.type);
        if (rule.upgradeTo === undefined || rule.upgradeCost === undefined) break;
        if (player.credits < rule.upgradeCost) break;
        player.credits -= rule.upgradeCost;
        building.upgrade = { to: rule.upgradeTo as BuildingType, progress: 0 };
        break;
      }
      case 'SELL_BUILDING': {
        const player = state.players.find((p) => p.id === cmd.playerId);
        const building = state.buildings.find(
          (b) => b.id === cmd.buildingId && b.owner === cmd.playerId,
        );
        if (!player || !building) break;
        player.credits += sellRefund(building.type, building.level);
        // Selling a Flugfeld loses its bound jet (fixed binding, like being
        // destroyed) — deathSystem sweeps the crashed jet this same tick.
        if (building.type === 'FLUGFELD') crashBoundJets(state, building);
        // Deconstruct without an explosion: free the footprint, drop the record.
        const rule = buildingRule(building.type);
        for (let y = building.cy; y < building.cy + rule.height; y++) {
          for (let x = building.cx; x < building.cx + rule.width; x++) {
            const idx = y * state.mapWidth + x;
            if (state.structures[idx] === building.id) {
              state.structures[idx] = 0;
              state.gateOwner[idx] = 0;
            }
          }
        }
        state.buildings = state.buildings.filter((b) => b.id !== building.id);
        break;
      }
      case 'FIRE_SUPERWEAPON': {
        if (!inBounds(state, cmd.cx, cmd.cy)) break;
        // Lowest-id charged silo fires (deterministic pick); `kind` narrows the
        // choice when a player owns several superweapons (nuke + iron curtain).
        const silo = state.buildings.find((b) => {
          const kind = buildingRule(b.type).superweapon;
          if (b.owner !== cmd.playerId || kind === null) return false;
          if (cmd.kind !== undefined && kind !== cmd.kind) return false;
          return b.charge >= SUPERWEAPON_CHARGE_TICKS;
        });
        if (!silo) break;
        silo.charge = 0;
        const kind = buildingRule(silo.type).superweapon!;
        state.strikes.push({
          id: state.nextEntityId++,
          kind,
          owner: cmd.playerId,
          x: cellCenter(cmd.cx),
          y: cellCenter(cmd.cy),
          // The iron curtain beams down instantly; warheads travel.
          countdown: kind === 'CURTAIN' ? 1 : SUPERWEAPON_TRAVEL_TICKS,
        });
        break;
      }
      case 'PARADROP': {
        // Free support power: needs a standing Flugfeld and a ready cooldown.
        // Firing into fog is allowed, same as the superweapons.
        if (!inBounds(state, cmd.cx, cmd.cy)) break;
        const player = state.players.find((p) => p.id === cmd.playerId);
        if (!player || player.paradropCooldown > 0) break;
        if (!state.buildings.some((b) => b.owner === cmd.playerId && b.type === 'FLUGFELD')) break;
        launchParadrop(state, cmd.playerId, cmd.cx, cmd.cy);
        break;
      }
      case 'LOAD': {
        // Ground units walk up to an own carrier (transport ship or air
        // transport) and board.
        const transport = state.units.find(
          (u) =>
            u.id === cmd.transportId &&
            u.owner === cmd.playerId &&
            unitRule(u.type).carrier === true,
        );
        if (!transport) break;
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (isAir(unit) || isNaval(unit)) continue; // only ground units ride
          unit.order = { kind: 'BOARD', targetId: transport.id };
          unit.path = null; // transport system takes over pathing (chase)
          unit.pathIndex = 0;
        }
        break;
      }
      case 'UNLOAD':
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unitRule(unit.type).carrier !== true) continue;
          unloadTransport(state, unit);
        }
        break;
      case 'INFILTRATE': {
        // A spy targets an ENEMY storage building (refinery/silo) to rob it.
        const target = state.buildings.find((b) => b.id === cmd.targetId);
        if (
          !target ||
          !areEnemies(state, cmd.playerId, target.owner) ||
          (buildingRule(target.type).storage ?? 0) <= 0
        ) {
          break;
        }
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unitRule(unit.type).infiltrator !== true) continue;
          unit.order = { kind: 'INFILTRATE', targetId: cmd.targetId };
          unit.path = null; // the spy system takes over pathing (chase)
          unit.pathIndex = 0;
        }
        break;
      }
      case 'CAPTURE': {
        // An engineer takes over any ENEMY or NEUTRAL building (never own/allied).
        const target = state.buildings.find((b) => b.id === cmd.targetId);
        if (
          !target ||
          target.owner === cmd.playerId ||
          (target.owner >= 0 && !areEnemies(state, cmd.playerId, target.owner))
        ) {
          break;
        }
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          if (unitRule(unit.type).captures !== true) continue;
          unit.order = { kind: 'CAPTURE', targetId: cmd.targetId };
          unit.path = null; // the capture system takes over pathing (chase)
          unit.pathIndex = 0;
        }
        break;
      }
      case 'HOLD': {
        // Stand fast where the unit is right now. Jets can't hold (they always
        // fly sorties); hovering helicopters can. Unarmed units may hold too —
        // the order shields them from the base-alarm pull.
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          const rule = unitRule(unit.type);
          if (rule.hidden === true || (rule.air === true && rule.hover !== true)) continue;
          unit.order = { kind: 'HOLD' };
          unit.path = null;
          unit.pathIndex = 0;
        }
        break;
      }
      case 'PATROL': {
        // Shuttle between the unit's current cell and the clicked cell. A
        // combat order: armed ground/sea units and hovering helicopters only.
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          const rule = unitRule(unit.type);
          if (rule.weapon === null || rule.hidden === true) continue;
          if (rule.air === true && rule.hover !== true) continue;
          const ax = unit.cell % state.mapWidth;
          const ay = (unit.cell - ax) / state.mapWidth;
          unit.order = { kind: 'PATROL', ax, ay, bx: cmd.cx, by: cmd.cy, leg: 1 };
          unit.path = null; // combat paces the legs
          unit.pathIndex = 0;
        }
        break;
      }
      case 'ESCORT': {
        // Guard an own living unit; the escort may not escort itself.
        const ward = state.units.find((u) => u.id === cmd.targetId);
        if (
          !ward ||
          ward.owner !== cmd.playerId ||
          unitRule(ward.type).hidden === true ||
          cmd.unitIds.includes(ward.id)
        ) {
          break;
        }
        for (const unit of ownedUnits(state, cmd.unitIds, cmd.playerId)) {
          const rule = unitRule(unit.type);
          if (rule.weapon === null || rule.hidden === true || rule.air === true) continue;
          if (unit.id === ward.id) continue;
          unit.order = { kind: 'ESCORT', targetId: ward.id };
          unit.path = null; // combat handles following
          unit.pathIndex = 0;
        }
        break;
      }
      case 'CHEAT': {
        // Cheats are ordinary commands so replays reproduce them faithfully;
        // the client only offers the hotkeys in solo games.
        const player = state.players.find((p) => p.id === cmd.playerId);
        if (!player) break;
        if (cmd.cheat === 'MONEY') player.credits += CHEAT_MONEY;
        else if (cmd.cheat === 'POWER') player.powerBonus += CHEAT_POWER;
        else if (cmd.cheat === 'REVEAL') player.mapRevealed = true;
        else if (cmd.cheat === 'MOTHERLOAD') {
          // The mother of all cheats includes full map vision.
          player.motherload = true;
          player.mapRevealed = true;
        }
        break;
      }
      case 'SET_RALLY': {
        if (!inBounds(state, cmd.cx, cmd.cy)) break;
        const building = state.buildings.find(
          (b) => b.id === cmd.buildingId && b.owner === cmd.playerId,
        );
        if (!building || buildingRule(building.type).produces === null) break;
        building.rallyCx = cmd.cx;
        building.rallyCy = cmd.cy;
        break;
      }
    }
  }
}

/** Resolves ids to living units of the player, in ascending-id order. */
function ownedUnits(state: GameState, ids: number[], playerId: number): Unit[] {
  const byId = new Map<number, Unit>();
  for (const unit of state.units) byId.set(unit.id, unit);
  const out: Unit[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const unit = byId.get(id);
    if (!unit || unit.owner !== playerId) continue;
    // Scripted units (paradrop plane) ignore every player command.
    if (unitRule(unit.type).hidden === true) continue;
    out.push(unit);
  }
  return out;
}

function applyMove(state: GameState, cmd: { unitIds: number[]; playerId: number; cx: number; cy: number }): void {
  const all = ownedUnits(state, cmd.unitIds, cmd.playerId);
  if (all.length === 0) return;
  // Ships spread over water cells, everyone else over land — a mixed selection
  // ordered to the coast splits naturally between shore and sea.
  const groups: Array<{ units: Unit[]; water: boolean }> = [
    { units: all.filter((u) => !isNaval(u)), water: false },
    { units: all.filter((u) => isNaval(u)), water: true },
  ];
  for (const { units, water } of groups) {
    if (units.length === 0) continue;
    const targets = assignTargetCells(state, cmd.cx, cmd.cy, units.length, water);
    if (targets.length === 0) continue;
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      const target = targets[i] ?? targets[targets.length - 1]!;
      moveUnitTo(state, unit, target.cx, target.cy);
    }
  }
}

/** Plain move: clears any order (manual moves override attack/harvest). */
function moveUnitTo(state: GameState, unit: Unit, cx: number, cy: number): void {
  unit.order = null;
  const rule = unitRule(unit.type);
  if (rule.air === true && rule.ammo !== undefined) {
    // Combat aircraft never park in the field: a move order is an attack run —
    // fly out, engage whatever waits there, then return to the pad
    // (airbaseSystem brings idle planes home).
    unit.order = { kind: 'ATTACK_MOVE', cx, cy };
    unit.path = null;
    unit.pathIndex = 0;
    unit.blockedTicks = 0;
    unit.repathCount = 0;
    return;
  }
  if (rule.air === true) {
    // Aircraft fly straight there — no ground path.
    unit.path = [{ cx, cy }];
  } else {
    const ucx = unit.cell % state.mapWidth;
    const ucy = (unit.cell - ucx) / state.mapWidth;
    unit.path = findPath(state, ucx, ucy, cx, cy, {
      avoidUnits: false,
      selfId: unit.id,
      owner: unit.owner,
      water: isNaval(unit),
    });
  }
  unit.pathIndex = 0;
  unit.blockedTicks = 0;
  unit.repathCount = 0;
}

/**
 * Drops passengers onto free land around the ship (must be parked at a
 * shore). Unloads as many as fit; the rest stay aboard.
 */
export function unloadTransport(state: GameState, transport: Unit): void {
  if (transport.passengers.length === 0) return;
  const w = state.mapWidth;
  const tcx = transport.cell % w;
  const tcy = (transport.cell - tcx) / w;
  const remaining = [...transport.passengers];
  for (let r = 1; r <= 2 && remaining.length > 0; r++) {
    for (const cell of cellsAroundRect(tcx, tcy, 1, 1, r)) {
      if (remaining.length === 0) break;
      if (!isPassableTerrain(state, cell.cx, cell.cy)) continue;
      const idx = cellIndex(state, cell.cx, cell.cy);
      if (state.occupancy[idx] !== 0) continue;
      const unit = remaining.shift()!;
      unit.x = cellCenter(cell.cx);
      unit.y = cellCenter(cell.cy);
      unit.cell = idx;
      unit.path = null;
      unit.pathIndex = 0;
      unit.order = null;
      unit.blockedTicks = 0;
      unit.repathCount = 0;
      state.occupancy[idx] = unit.id;
      state.units.push(unit);
    }
  }
  transport.passengers = remaining;
}

/**
 * Spreads a group order over distinct passable cells spiraling out from the
 * clicked cell, so formations don't all fight over one destination.
 */
function assignTargetCells(
  state: GameState,
  cx: number,
  cy: number,
  count: number,
  water = false,
): PathCell[] {
  const traversable = water ? isNavigableWater : isPassableTerrain;
  const out: PathCell[] = [];
  for (let r = 0; r < 12 && out.length < count; r++) {
    for (let dy = -r; dy <= r && out.length < count; dy++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        const ax = dx < 0 ? -dx : dx;
        const ay = dy < 0 ? -dy : dy;
        if ((ax > ay ? ax : ay) !== r) continue;
        if (traversable(state, cx + dx, cy + dy)) {
          out.push({ cx: cx + dx, cy: cy + dy });
        }
      }
    }
  }
  return out;
}
