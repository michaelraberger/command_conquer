import {
  OBJ_ACTIVE,
  OBJ_COMPLETE,
  OBJ_FAILED,
  missionAlive,
  missionEnemyRep,
  type ObjectiveState,
} from '../mission.js';
import type { GameState } from '../state.js';

/**
 * Campaign objective evaluation. Runs after deathSystem (this tick's kills
 * count) and instead of victorySystem, which early-returns for mission games:
 * a mission is decided exclusively here — all mandatory objectives complete
 * → the human wins; any mandatory objective failed (or the human team wiped
 * out) → defeat. state.winner freezes the sim exactly like skirmish victory.
 */
export function objectivesSystem(state: GameState): void {
  const mission = state.mission;
  if (mission === undefined || state.winner !== -1) return;

  const humanTeam = state.players[0]?.team ?? 0;
  const teamAlive = (team: number): boolean =>
    state.players.some((p) => p.team === team && missionAlive(state, p.id));

  const tagExists = (tag: string): boolean =>
    state.units.some(
      (u) => u.tag === tag || u.passengers.some((p) => p.tag === tag),
    ) || state.buildings.some((b) => b.tag === tag);

  const setStatus = (obj: ObjectiveState, status: number): void => {
    obj.status = status;
    state.events.push({ type: 'OBJECTIVE', id: obj.id, status });
  };

  for (const obj of mission.objectives) {
    if (obj.status !== OBJ_ACTIVE) continue;
    const spec = obj.spec;
    switch (spec.kind) {
      case 'DESTROY_ALL_ENEMIES': {
        const enemies = state.players.filter((p) => p.team !== humanTeam);
        if (enemies.every((p) => !missionAlive(state, p.id))) setStatus(obj, OBJ_COMPLETE);
        break;
      }
      case 'DESTROY_TAG':
        if (!tagExists(spec.tag)) setStatus(obj, OBJ_COMPLETE);
        break;
      case 'CAPTURE_TAG': {
        const tagged = state.buildings.filter((b) => b.tag === spec.tag);
        if (tagged.length === 0) {
          setStatus(obj, OBJ_FAILED); // the capture target was destroyed
        } else if (tagged.every((b) => state.players[b.owner]?.team === humanTeam)) {
          setStatus(obj, OBJ_COMPLETE);
        }
        break;
      }
      case 'SURVIVE_UNTIL':
        if (state.tick >= spec.tick) setStatus(obj, OBJ_COMPLETE);
        break;
      case 'PROTECT_TAG':
        // Completes only on mission win (see below); dies with its ward.
        if (!tagExists(spec.tag)) setStatus(obj, OBJ_FAILED);
        break;
      case 'REACH_AREA': {
        const inArea = state.units.some((u) => {
          if (state.players[u.owner]?.team !== humanTeam) return false;
          if (spec.tag !== undefined && u.tag !== spec.tag) return false;
          const cx = u.cell % state.mapWidth;
          const cy = (u.cell - cx) / state.mapWidth;
          return cx >= spec.cx && cx < spec.cx + spec.w && cy >= spec.cy && cy < spec.cy + spec.h;
        });
        if (inArea) setStatus(obj, OBJ_COMPLETE);
        break;
      }
    }
  }

  const mandatory = mission.objectives.filter((o) => !o.optional);

  // Defeat: a mandatory objective failed, or the human team no longer exists.
  if (mandatory.some((o) => o.status === OBJ_FAILED) || !teamAlive(humanTeam)) {
    state.winner = missionEnemyRep(state);
    return;
  }

  // Victory: every mandatory objective is complete. PROTECT objectives count
  // as fulfilled while their ward lives — they flip to COMPLETE on the win.
  const done = mandatory.every(
    (o) =>
      o.status === OBJ_COMPLETE ||
      (o.spec.kind === 'PROTECT_TAG' && o.status === OBJ_ACTIVE),
  );
  if (done && mandatory.length > 0) {
    for (const o of mission.objectives) {
      if (o.spec.kind === 'PROTECT_TAG' && o.status === OBJ_ACTIVE && !o.optional) {
        setStatus(o, OBJ_COMPLETE);
      }
    }
    state.winner = 0;
  }
}
