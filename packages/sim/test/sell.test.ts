import { describe, expect, it } from 'vitest';
import {
  WALL_LEVELS,
  buildingRule,
  cellIndex,
  constructBuilding,
  createGame,
  sellRefund,
  tick,
  type GameState,
} from '../src/index.js';

function p0(state: GameState) {
  return state.players[0]!;
}

describe('selling buildings', () => {
  it('refunds half the cost and frees the footprint', () => {
    const state = createGame(7);
    const power = constructBuilding(state, 'POWER', 0, 17, 17);
    const before = p0(state).credits;

    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: power.id }]);

    expect(p0(state).credits).toBe(before + buildingRule('POWER').cost / 2);
    expect(state.buildings.some((b) => b.id === power.id)).toBe(false);
    expect(state.structures[cellIndex(state, 17, 17)]).toBe(0);
    expect(state.events.some((e) => e.type === 'DEATH')).toBe(false); // no explosion
  });

  it('includes paid wall upgrades in the refund', () => {
    const state = createGame(7);
    tick(state, [{ type: 'PLACE_WALL', playerId: 0, cx: 17, cy: 17 }]);
    const wall = state.buildings.find((b) => b.type === 'WALL')!;
    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: wall.id }]);
    tick(state, [{ type: 'UPGRADE_BUILDING', playerId: 0, buildingId: wall.id }]);
    const before = p0(state).credits;

    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: wall.id }]);
    const invested = 50 + WALL_LEVELS[1]!.upgradeCost + WALL_LEVELS[2]!.upgradeCost;
    expect(sellRefund('WALL', 3)).toBe(Math.trunc(invested / 2));
    expect(p0(state).credits).toBe(before + Math.trunc(invested / 2));
  });

  it('cannot sell enemy buildings', () => {
    const state = createGame(7);
    const enemyYard = state.buildings.find((b) => b.owner === 1)!;
    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: enemyYard.id }]);
    expect(state.buildings.some((b) => b.id === enemyYard.id)).toBe(true);
  });

  it('selling your last real building loses the game', () => {
    const state = createGame(7);
    const yard = state.buildings.find((b) => b.owner === 0)!;
    tick(state, [{ type: 'SELL_BUILDING', playerId: 0, buildingId: yard.id }]);
    tick(state);
    expect(state.winner).toBe(1);
  });
});
