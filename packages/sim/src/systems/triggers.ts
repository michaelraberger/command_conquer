import {
  OBJ_ACTIVE,
  OBJ_HIDDEN,
  applyPlacementOrder,
  findSpawnCell,
  missionEnemyRep,
  type TriggerAction,
  type TriggerCondition,
} from '../mission.js';
import { FOG_HIDDEN, FOG_EXPLORED, spawnUnit, type GameState } from '../state.js';

/**
 * Campaign trigger engine: one-shot triggers fire in array order (part of the
 * determinism contract) as soon as their condition holds. Runs right after
 * applyCommands, so spawned reinforcements exist before the AI pass and act
 * the same tick.
 */
export function triggersSystem(state: GameState): void {
  const mission = state.mission;
  if (mission === undefined || state.winner !== -1) return;
  for (const trig of mission.triggers) {
    if (trig.fired || !conditionMet(state, trig.when)) continue;
    trig.fired = true;
    for (const action of trig.actions) {
      runAction(state, action);
      if (state.winner !== -1) return; // WIN/LOSE freezes the sim immediately
    }
  }
}

function conditionMet(state: GameState, when: TriggerCondition): boolean {
  switch (when.kind) {
    case 'AT_TICK':
      return state.tick >= when.tick;
    case 'OBJECTIVE_STATUS': {
      const obj = state.mission!.objectives.find((o) => o.id === when.objectiveId);
      return obj !== undefined && obj.status === when.status;
    }
    case 'TAG_DEAD':
      return (
        !state.units.some(
          (u) => u.tag === when.tag || u.passengers.some((p) => p.tag === when.tag),
        ) && !state.buildings.some((b) => b.tag === when.tag)
      );
    case 'AREA_ENTERED':
      return state.units.some((u) => {
        if (state.players[u.owner]?.team !== when.team) return false;
        const cx = u.cell % state.mapWidth;
        const cy = (u.cell - cx) / state.mapWidth;
        return cx >= when.cx && cx < when.cx + when.w && cy >= when.cy && cy < when.cy + when.h;
      });
  }
}

function runAction(state: GameState, action: TriggerAction): void {
  switch (action.kind) {
    case 'SPAWN':
      for (const placement of action.units) {
        const cell = findSpawnCell(state, placement.type, placement.cx, placement.cy);
        if (!cell) continue; // everything nearby is taken — drop this unit
        const unit = spawnUnit(state, placement.type, placement.owner, cell.cx, cell.cy);
        if (placement.tag !== undefined) unit.tag = placement.tag;
        if (placement.order) applyPlacementOrder(state, unit, placement.order);
      }
      break;
    case 'GRANT_CREDITS': {
      const player = state.players[action.player];
      if (player) player.credits += action.amount;
      break;
    }
    case 'MESSAGE':
      state.events.push({ type: 'MISSION_MESSAGE', msgId: action.msgId });
      break;
    case 'REVEAL_OBJECTIVE': {
      const obj = state.mission!.objectives.find((o) => o.id === action.objectiveId);
      if (obj && obj.status === OBJ_HIDDEN) {
        obj.status = OBJ_ACTIVE;
        state.events.push({ type: 'OBJECTIVE', id: obj.id, status: OBJ_ACTIVE });
      }
      break;
    }
    case 'AI_ATTACK_NOW': {
      const player = state.players[action.player];
      if (player && player.isAi) {
        // Open both attack gates: the grace period and the wave cooldown.
        player.aiTuning = { ...(player.aiTuning ?? {}), firstAttackTick: 0 };
        player.aiLastAttackTick = -1000000;
      }
      break;
    }
    case 'REVEAL_AREA': {
      const fog = state.fogs[action.player];
      if (!fog) break;
      const r = action.radius;
      const rSq = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > rSq) continue;
          const x = action.cx + dx;
          const y = action.cy + dy;
          if (x < 0 || y < 0 || x >= state.mapWidth || y >= state.mapHeight) continue;
          const idx = y * state.mapWidth + x;
          if (fog[idx] === FOG_HIDDEN) fog[idx] = FOG_EXPLORED;
        }
      }
      break;
    }
    case 'WIN':
      state.winner = 0;
      break;
    case 'LOSE':
      state.winner = missionEnemyRep(state);
      break;
  }
}
