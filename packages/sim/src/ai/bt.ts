/**
 * Minimal synchronous behavior-tree engine for the AI.
 *
 * Deliberately hand-rolled instead of a library: packages/sim is
 * zero-dependency (see test/purity.test.ts) and every tick must be
 * deterministic. Trees are stateless — there is no RUNNING status and no
 * per-node memory. AI passes are 10–30 ticks apart and all world knowledge
 * lives in GameState, so each pass re-evaluates the whole tree from the root.
 * Nothing here ever enters serialize()/hashState().
 *
 * The engine is generic over the context type and must stay free of game
 * imports so it can be unit-tested in isolation.
 */

/** Result of a node tick. No RUNNING — trees are stateless by design. */
export type Status = 'SUCCESS' | 'FAILURE';

export interface BtNode<C> {
  readonly name: string;
  tick(ctx: C): Status;
}

/** A child of a utilitySelector: an integer score paired with a node. */
export interface ScoredChild<C> {
  /** Integer score; children scoring <= 0 are skipped entirely. */
  score: (ctx: C) => number;
  node: BtNode<C>;
}

/**
 * Observation hook for tests and debug overlays. Called after every node
 * tick with the node's name and result. Observes only — it must never
 * influence tree evaluation, so determinism is unaffected.
 */
export type BtTrace = (name: string, status: Status) => void;

let trace: BtTrace | null = null;

export function setBtTrace(fn: BtTrace | null): void {
  trace = fn;
}

/** Wraps a tick function so every result is reported to the trace hook. */
function node<C>(name: string, tick: (ctx: C) => Status): BtNode<C> {
  return {
    name,
    tick(ctx: C): Status {
      const status = tick(ctx);
      if (trace) trace(name, status);
      return status;
    },
  };
}

/** SUCCESS when the predicate holds. */
export function condition<C>(name: string, fn: (ctx: C) => boolean): BtNode<C> {
  return node(name, (ctx) => (fn(ctx) ? 'SUCCESS' : 'FAILURE'));
}

/** Performs a side effect; the return value says whether it acted. */
export function action<C>(name: string, fn: (ctx: C) => boolean): BtNode<C> {
  return node(name, (ctx) => (fn(ctx) ? 'SUCCESS' : 'FAILURE'));
}

/** Ticks children in order, stops at the first FAILURE. */
export function sequence<C>(name: string, ...children: BtNode<C>[]): BtNode<C> {
  return node(name, (ctx) => {
    for (const child of children) {
      if (child.tick(ctx) === 'FAILURE') return 'FAILURE';
    }
    return 'SUCCESS';
  });
}

/** Ticks children in order, stops at the first SUCCESS. */
export function selector<C>(name: string, ...children: BtNode<C>[]): BtNode<C> {
  return node(name, (ctx) => {
    for (const child of children) {
      if (child.tick(ctx) === 'SUCCESS') return 'SUCCESS';
    }
    return 'FAILURE';
  });
}

/**
 * Ticks every child regardless of results and always succeeds. Mirrors the
 * historical controller structure where all manage* passes ran each pass.
 */
export function runAll<C>(name: string, ...children: BtNode<C>[]): BtNode<C> {
  return node(name, (ctx) => {
    for (const child of children) child.tick(ctx);
    return 'SUCCESS';
  });
}

/**
 * Evaluates all integer scores, then ticks the highest-scoring child.
 * Children scoring <= 0 are skipped; ties break by declaration order
 * (strict > on a single linear scan — no sort, no RNG, deterministic).
 * FAILURE when no child scores positive.
 */
export function utilitySelector<C>(name: string, ...children: ScoredChild<C>[]): BtNode<C> {
  return node(name, (ctx) => {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < children.length; i++) {
      const score = children[i]!.score(ctx);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) return 'FAILURE';
    return children[best]!.node.tick(ctx);
  });
}
