import type { SimEvent } from '@cac/sim';
import { Container, Graphics } from 'pixi.js';
import { worldToScreen } from './iso.js';

interface Fx {
  g: Graphics;
  age: number;
  ttl: number;
  anim: (g: Graphics, t: number) => void;
}

/**
 * Short-lived visual effects (muzzle flashes, tracers, explosions), fed from
 * sim events. Purely cosmetic — client-local, never touches the sim.
 */
export class Effects {
  readonly layer = new Container();
  private items: Fx[] = [];

  ingest(events: SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'SHOT') {
        const from = worldToScreen(e.x, e.y);
        const to = worldToScreen(e.tx, e.ty);
        if (e.fx === 'TESLA') {
          this.addLightning(from, to);
          continue;
        }
        if (e.fx === 'PRISM') {
          this.addPrismBeam(from, to);
          continue;
        }
        if (e.fx === 'FLAME') {
          const mx = from.x;
          const my = from.y - 9;
          const dx = to.x - mx;
          const dy = to.y - 6 - my;
          this.add(
            240,
            (g) => {
              for (let i = 0; i <= 4; i++) {
                const t = i / 4;
                g.circle(mx + dx * t, my + dy * t, 6 - i).fill({
                  color: i < 2 ? 0xffd070 : 0xff6a26,
                  alpha: 0.85,
                });
              }
            },
            (g, t) => {
              g.alpha = 1 - t;
            },
          );
          continue;
        }
        this.add(
          110,
          (g) => {
            g.circle(from.x, from.y - 9, e.fx === 'ARTY' || e.fx === 'ROCKET' ? 6 : 4).fill(0xffe9a0);
          },
          (g, t) => {
            g.alpha = 1 - t;
          },
        );
        if (e.fx === 'BULLET') {
          this.add(
            90,
            (g) => {
              g.moveTo(from.x, from.y - 9)
                .lineTo(to.x, to.y - 6)
                .stroke({ width: 1, color: 0xfff2b0, alpha: 0.9 });
            },
            (g, t) => {
              g.alpha = 0.9 * (1 - t);
            },
          );
        } else if (e.fx === 'ROCKET') {
          // A launch smoke puff that rises and fades behind the rocket.
          const mx = from.x;
          const my = from.y - 9;
          this.add(
            520,
            (g) => {
              g.circle(0, 0, 4).fill({ color: 0x999999, alpha: 0.5 });
              g.position.set(mx, my);
            },
            (g, t) => {
              g.alpha = 0.5 * (1 - t);
              g.scale.set(1 + t * 1.5);
              g.position.y = my - t * 6;
            },
          );
        }
      } else if (e.type === 'HIT') {
        const p = worldToScreen(e.x, e.y);
        this.add(
          260,
          (g) => {
            g.circle(0, 0, 7).fill({ color: 0xff9a3d, alpha: 0.9 });
            g.circle(0, 0, 3).fill(0xfff1c4);
            g.position.set(p.x, p.y - 6);
          },
          (g, t) => {
            g.alpha = 1 - t;
            g.scale.set(0.6 + t);
          },
        );
      } else if (e.type === 'SUPERWEAPON') {
        if (e.kind === 'CURTAIN') this.addIronCurtain(worldToScreen(e.x, e.y));
        else this.addSuperweapon(worldToScreen(e.x, e.y), e.kind === 'NUKE');
      } else if (e.type === 'REPAIR') {
        const p = worldToScreen(e.x, e.y);
        this.add(
          420,
          (g) => {
            g.circle(0, 0, 5).fill({ color: 0x8dffa0, alpha: 0.9 });
            g.rect(-4, -1, 8, 2).fill(0x53c94f); // green plus (wrench cue)
            g.rect(-1, -4, 2, 8).fill(0x53c94f);
            g.position.set(p.x, p.y - 12);
          },
          (g, t) => {
            g.alpha = 1 - t;
            g.position.y = p.y - 12 - t * 14; // floats up
          },
        );
      } else {
        const p = worldToScreen(e.x, e.y);
        const r = e.big ? 22 : 13;
        this.add(
          e.big ? 700 : 480,
          (g) => {
            g.circle(0, 0, r).fill({ color: 0xff7a26, alpha: 0.85 });
            g.circle(0, 0, r * 0.45).fill(0xffd9a0);
            g.position.set(p.x, p.y - 4);
          },
          (g, t) => {
            g.alpha = 1 - t;
            g.scale.set(0.6 + t * 1.6);
          },
        );
        // Smoke puffs linger after the fireball.
        this.add(
          e.big ? 1100 : 700,
          (g) => {
            g.circle(-6, -4, r * 0.5).fill({ color: 0x333333, alpha: 0.5 });
            g.circle(7, -8, r * 0.4).fill({ color: 0x444444, alpha: 0.45 });
            g.position.set(p.x, p.y - 8);
          },
          (g, t) => {
            g.alpha = 0.6 * (1 - t);
            g.position.y -= 0.4;
            g.scale.set(0.8 + t * 0.8);
          },
        );
      }
    }
  }

  /** Iron curtain: a red energy beam sweeps down, then an expanding ring marks
   *  the protected area — no fire, no smoke, pure crackling energy. */
  private addIronCurtain(p: { x: number; y: number }): void {
    this.add(
      420,
      (g) => {
        g.rect(p.x - 6, p.y - 120, 12, 120).fill({ color: 0xff5540, alpha: 0.55 }); // beam
        g.rect(p.x - 2, p.y - 120, 4, 120).fill({ color: 0xffd0c4, alpha: 0.9 }); // hot core
        g.circle(p.x, p.y, 14).fill({ color: 0xff5540, alpha: 0.8 });
      },
      (g, t) => {
        g.alpha = 1 - t;
      },
    );
    this.add(
      900,
      (g) => {
        g.ellipse(0, 0, 30, 15).stroke({ width: 3, color: 0xff5540, alpha: 0.9 });
        g.ellipse(0, 0, 18, 9).stroke({ width: 1.5, color: 0xffd0c4, alpha: 0.8 });
        g.position.set(p.x, p.y);
      },
      (g, t) => {
        g.alpha = 0.9 * (1 - t);
        g.scale.set(0.5 + t * 2.6); // ring expands over the protected area
      },
    );
  }

  /** Nuke: flash → fireball → shockwave ring → rising smoke column.
   *  Storm: blue flash plus a fan of lightning bolts inside the blast area. */
  private addSuperweapon(p: { x: number; y: number }, isNuke: boolean): void {
    const flashColor = isNuke ? 0xfff6d8 : 0xbfeaff;
    this.add(
      260,
      (g) => {
        g.circle(0, 0, 85).fill({ color: flashColor, alpha: 0.9 });
        g.position.set(p.x, p.y);
      },
      (g, t) => {
        g.alpha = 0.9 * (1 - t);
        g.scale.set(1 + t * 0.4);
      },
    );
    this.add(
      1100,
      (g) => {
        g.ellipse(0, 0, 30, 15).stroke({ width: 3, color: isNuke ? 0xffb347 : 0x7fd4ff, alpha: 0.9 });
        g.position.set(p.x, p.y);
      },
      (g, t) => {
        g.alpha = 0.9 * (1 - t);
        g.scale.set(0.4 + t * 3.4); // expanding shockwave
      },
    );
    if (isNuke) {
      this.add(
        1300,
        (g) => {
          g.circle(0, 0, 34).fill({ color: 0xff7a26, alpha: 0.9 });
          g.circle(0, -6, 20).fill(0xffd9a0);
          g.position.set(p.x, p.y - 8);
        },
        (g, t) => {
          g.alpha = 1 - t;
          g.scale.set(0.5 + t * 1.3);
          g.position.y = p.y - 8 - t * 26; // fireball lifts off
        },
      );
      this.add(
        2600,
        (g) => {
          g.circle(-10, 0, 16).fill({ color: 0x3a3a3a, alpha: 0.55 });
          g.circle(12, -6, 14).fill({ color: 0x4a4a4a, alpha: 0.5 });
          g.circle(0, -18, 18).fill({ color: 0x555555, alpha: 0.5 });
          g.position.set(p.x, p.y - 18);
        },
        (g, t) => {
          g.alpha = 0.65 * (1 - t);
          g.position.y = p.y - 18 - t * 55; // smoke column rises
          g.scale.set(0.7 + t * 1.5);
        },
      );
    } else {
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2 + Math.random();
        const dist = 25 + Math.random() * 65;
        const hit = { x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist * 0.5 };
        this.addLightning({ x: hit.x, y: hit.y - 60 }, hit);
      }
    }
  }

  /** Straight, bright light beam from the prism crystal to the target, with a
   *  soft outer glow and a flash at the impact point. Purely cosmetic. */
  private addPrismBeam(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const ax = from.x;
    const ay = from.y - 46; // fire from the crystal atop the tower
    const bx = to.x;
    const by = to.y - 6;
    this.add(
      170,
      (g) => {
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 7, color: 0x7fe6ff, alpha: 0.25 }); // glow
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 3, color: 0xd6f7ff, alpha: 0.85 }); // core
        g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 1, color: 0xffffff, alpha: 0.95 });
        g.circle(ax, ay, 5).fill({ color: 0xd6f7ff, alpha: 0.9 }); // emitter spark
        g.circle(bx, by, 6).fill({ color: 0xeaffff, alpha: 0.85 }); // impact bloom
      },
      (g, t) => {
        g.alpha = 1 - t * t;
      },
    );
  }

  /** Jagged tesla arc with a soft glow — client-local randomness is fine. */
  private addLightning(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const points: Array<{ x: number; y: number }> = [];
    const segments = 6;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const jitter = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * 14;
      points.push({
        x: from.x + (to.x - from.x) * t + jitter,
        y: from.y - 40 + (to.y - 6 - (from.y - 40)) * t + jitter * 0.5,
      });
    }
    this.add(
      200,
      (g) => {
        g.moveTo(points[0]!.x, points[0]!.y);
        for (const p of points.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: 5, color: 0x7fd4ff, alpha: 0.3 });
        g.moveTo(points[0]!.x, points[0]!.y);
        for (const p of points.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: 2, color: 0xe8f7ff, alpha: 0.95 });
        g.circle(points[0]!.x, points[0]!.y, 5).fill({ color: 0xbfeaff, alpha: 0.9 });
      },
      (g, t) => {
        g.alpha = 1 - t * t;
      },
    );
  }

  update(dtMs: number): void {
    if (this.items.length === 0) return;
    const keep: Fx[] = [];
    for (const fx of this.items) {
      fx.age += dtMs;
      const t = fx.age / fx.ttl;
      if (t >= 1) {
        fx.g.destroy();
        continue;
      }
      fx.anim(fx.g, t);
      keep.push(fx);
    }
    this.items = keep;
  }

  private add(ttl: number, draw: (g: Graphics) => void, anim: (g: Graphics, t: number) => void): void {
    const g = new Graphics();
    draw(g);
    anim(g, 0);
    this.layer.addChild(g);
    this.items.push({ g, age: 0, ttl, anim });
  }
}
