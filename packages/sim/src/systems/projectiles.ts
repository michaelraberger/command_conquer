import { distSq, isqrt } from '../fixed.js';
import { unitRule } from '../rules.js';
import { aggroKindOfType, aimPoint, damageTarget, findTarget } from '../targeting.js';
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
      // Rally point for defenders = launch position (old saves lack it).
      // Veterancy: the shooter (if still alive) gets bonus + kill credit.
      const source =
        p.srcId !== undefined ? state.units.find((u) => u.id === p.srcId) : undefined;
      damageTarget(
        state,
        target,
        weapon,
        { x: p.sx ?? p.x, y: p.sy ?? p.y, kind: aggroKindOfType(p.srcType) },
        source,
        p.owner, // stats credit survives the shooter's death mid-flight
      );
      continue;
    }
    const dist = isqrt(d2);
    p.x += Math.trunc((dx * speed) / dist);
    p.y += Math.trunc((dy * speed) / dist);
    alive.push(p);
  }
  state.projectiles = alive;
}
