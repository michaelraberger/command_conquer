import { distSq, isqrt } from '../fixed.js';
import { unitRule } from '../rules.js';
import { aimPoint, damageTarget, findTarget } from '../targeting.js';
import type { GameState, Projectile } from '../state.js';

/**
 * Homing projectiles (classic C&C shells): steer toward the target's live
 * position, apply warhead damage on impact, fizzle if the target died first.
 */
export function projectileSystem(state: GameState): void {
  if (state.projectiles.length === 0) return;

  const alive: Projectile[] = [];
  for (const p of state.projectiles) {
    const weapon = unitRule(p.srcType).weapon!;
    const target = findTarget(state, p.targetId);
    if (!target) {
      state.events.push({ type: 'HIT', x: p.x, y: p.y });
      continue;
    }
    const aim = aimPoint(target, p.x, p.y);
    const dx = aim.x - p.x;
    const dy = aim.y - p.y;
    const d2 = distSq(dx, dy);
    const speed = weapon.projectileSpeed;
    if (d2 <= speed * speed) {
      damageTarget(state, target, weapon);
      continue;
    }
    const dist = isqrt(d2);
    p.x += Math.trunc((dx * speed) / dist);
    p.y += Math.trunc((dy * speed) / dist);
    alive.push(p);
  }
  state.projectiles = alive;
}
