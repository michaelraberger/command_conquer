/**
 * Behavior-tree wiring for the AI. The trees only structure decisions —
 * all game knowledge lives in the leaf functions exported by controller.ts.
 *
 * Trees are built once at module load and are player-agnostic: everything
 * per-player flows through AiCtx. There is a deliberate import cycle with
 * controller.ts (aiSystem ticks AI_ROOT; the leaves live in controller.ts) —
 * safe because leaves are hoisted function declarations that are only
 * dereferenced at tick time, never during module evaluation.
 *
 * The economy/military leaf order mirrors the historical manage* pass order
 * exactly; the production queues compete for the same credits, so reordering
 * would change which queue wins a pass (and with it every AI game).
 */
import { action, condition, runAll, selector, sequence, type BtNode } from './bt.js';
import {
  attackGateOpen,
  combatPool,
  isBaseThreatened,
  launchAttackWave,
  manageCapture,
  manageConstruction,
  manageInvasion,
  manageMcv,
  manageParadrop,
  manageResearch,
  manageSuperweapon,
  manageUpgrades,
  recallDefenders,
  retreatHurt,
  trainAir,
  trainInfantry,
  trainNavy,
  trainVehicles,
  type AiParams,
} from './controller.js';
import type { InfluenceView } from './influence.js';
import type { GameState, Player } from '../state.js';

/** Everything a tree tick may read or act on. Rebuilt per player per pass. */
export interface AiCtx {
  state: GameState;
  player: Player;
  params: AiParams;
  /** Influence view of this pass — threat/economy grids (influence.ts). */
  inf: InfluenceView;
}

/** Shorthand: adapt a (state, player, params) pass into an action leaf. */
function pass(name: string, fn: (state: GameState, player: Player, params: AiParams) => void): BtNode<AiCtx> {
  return action<AiCtx>(name, (ctx) => {
    fn(ctx.state, ctx.player, ctx.params);
    return true;
  });
}

/** Training: four independent queues, each fills toward its standing cap. */
const trainingTree: BtNode<AiCtx> = runAll(
  'training',
  pass('train-infantry', trainInfantry),
  pass('train-vehicles', trainVehicles),
  pass('train-air', trainAir),
  pass('train-navy', trainNavy),
);

/**
 * Army: defense overrides offense. With enemies at the base every combat unit
 * is recalled and the pass ends; otherwise hurt units retreat and — gate
 * permitting — a wave launches.
 */
const armyTree: BtNode<AiCtx> = sequence(
  'army',
  condition<AiCtx>('has-combat-units', (ctx) => combatPool(ctx.state, ctx.player).length > 0),
  selector(
    'army-mode',
    sequence(
      'defend',
      condition<AiCtx>('base-threatened', (ctx) => isBaseThreatened(ctx.state, ctx.player, ctx.inf)),
      action<AiCtx>('recall-all', (ctx) => recallDefenders(ctx.state, ctx.player)),
    ),
    runAll(
      'offense',
      action<AiCtx>('retreat-hurt', (ctx) => retreatHurt(ctx.state, ctx.player, ctx.params)),
      sequence(
        'wave',
        condition<AiCtx>('attack-gate', (ctx) => attackGateOpen(ctx.state, ctx.player, ctx.params, ctx.inf)),
        action<AiCtx>('launch-wave', (ctx) => launchAttackWave(ctx.state, ctx.player, ctx.params, ctx.inf)),
      ),
    ),
  ),
);

export const AI_ROOT: BtNode<AiCtx> = runAll(
  'root',
  runAll(
    'economy',
    pass('construction', manageConstruction),
    pass('upgrades', manageUpgrades),
    pass('research', manageResearch),
    pass('mcv', (state, player) => manageMcv(state, player)),
    trainingTree,
  ),
  runAll(
    'military',
    pass('capture', (state, player) => manageCapture(state, player)),
    pass('invasion', manageInvasion),
    armyTree,
    action<AiCtx>('superweapon', (ctx) => {
      manageSuperweapon(ctx.state, ctx.player, ctx.params, ctx.inf);
      return true;
    }),
    action<AiCtx>('paradrop', (ctx) => {
      manageParadrop(ctx.state, ctx.player, ctx.params, ctx.inf);
      return true;
    }),
  ),
);
