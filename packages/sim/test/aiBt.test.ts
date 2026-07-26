import { afterEach, describe, expect, it } from 'vitest';
import {
  action,
  condition,
  runAll,
  selector,
  sequence,
  setBtTrace,
  utilitySelector,
  type Status,
} from '../src/ai/bt.js';

interface Ctx {
  log: string[];
}

/** Action that records its name and returns the given result. */
function step(name: string, ok: boolean) {
  return action<Ctx>(name, (ctx) => {
    ctx.log.push(name);
    return ok;
  });
}

afterEach(() => setBtTrace(null));

describe('bt engine', () => {
  it('condition maps predicate to SUCCESS/FAILURE', () => {
    const ctx: Ctx = { log: [] };
    expect(condition<Ctx>('yes', () => true).tick(ctx)).toBe('SUCCESS');
    expect(condition<Ctx>('no', () => false).tick(ctx)).toBe('FAILURE');
  });

  it('sequence stops at the first FAILURE', () => {
    const ctx: Ctx = { log: [] };
    const tree = sequence('seq', step('a', true), step('b', false), step('c', true));
    expect(tree.tick(ctx)).toBe('FAILURE');
    expect(ctx.log).toEqual(['a', 'b']);
  });

  it('sequence succeeds when all children succeed', () => {
    const ctx: Ctx = { log: [] };
    const tree = sequence('seq', step('a', true), step('b', true));
    expect(tree.tick(ctx)).toBe('SUCCESS');
    expect(ctx.log).toEqual(['a', 'b']);
  });

  it('selector stops at the first SUCCESS', () => {
    const ctx: Ctx = { log: [] };
    const tree = selector('sel', step('a', false), step('b', true), step('c', true));
    expect(tree.tick(ctx)).toBe('SUCCESS');
    expect(ctx.log).toEqual(['a', 'b']);
  });

  it('selector fails when every child fails', () => {
    const ctx: Ctx = { log: [] };
    const tree = selector('sel', step('a', false), step('b', false));
    expect(tree.tick(ctx)).toBe('FAILURE');
    expect(ctx.log).toEqual(['a', 'b']);
  });

  it('runAll ticks every child despite failures and always succeeds', () => {
    const ctx: Ctx = { log: [] };
    const tree = runAll('all', step('a', false), step('b', true), step('c', false));
    expect(tree.tick(ctx)).toBe('SUCCESS');
    expect(ctx.log).toEqual(['a', 'b', 'c']);
  });

  it('utilitySelector ticks the highest-scoring child only', () => {
    const ctx: Ctx = { log: [] };
    const tree = utilitySelector<Ctx>(
      'util',
      { score: () => 10, node: step('low', true) },
      { score: () => 30, node: step('high', true) },
      { score: () => 20, node: step('mid', true) },
    );
    expect(tree.tick(ctx)).toBe('SUCCESS');
    expect(ctx.log).toEqual(['high']);
  });

  it('utilitySelector breaks ties by declaration order', () => {
    const ctx: Ctx = { log: [] };
    const tree = utilitySelector<Ctx>(
      'util',
      { score: () => 5, node: step('first', true) },
      { score: () => 5, node: step('second', true) },
    );
    tree.tick(ctx);
    expect(ctx.log).toEqual(['first']);
  });

  it('utilitySelector skips scores <= 0 and fails when none are positive', () => {
    const ctx: Ctx = { log: [] };
    const tree = utilitySelector<Ctx>(
      'util',
      { score: () => 0, node: step('zero', true) },
      { score: () => -3, node: step('neg', true) },
    );
    expect(tree.tick(ctx)).toBe('FAILURE');
    expect(ctx.log).toEqual([]);
  });

  it('utilitySelector propagates the chosen child result', () => {
    const ctx: Ctx = { log: [] };
    const tree = utilitySelector<Ctx>('util', { score: () => 1, node: step('a', false) });
    expect(tree.tick(ctx)).toBe('FAILURE');
  });

  it('trace hook sees every node tick in evaluation order', () => {
    const ctx: Ctx = { log: [] };
    const seen: Array<[string, Status]> = [];
    setBtTrace((name, status) => seen.push([name, status]));
    const tree = sequence('seq', step('a', true), selector('sel', step('b', false), step('c', true)));
    tree.tick(ctx);
    expect(seen).toEqual([
      ['a', 'SUCCESS'],
      ['b', 'FAILURE'],
      ['c', 'SUCCESS'],
      ['sel', 'SUCCESS'],
      ['seq', 'SUCCESS'],
    ]);
  });
});
