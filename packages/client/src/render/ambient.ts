import { FOG_HIDDEN, SUBCELL, powerBalance, type BuildingType, type GameState } from '@cac/sim';
import { Container, Graphics } from 'pixi.js';
import { session } from '../session.js';
import { TILE_H, TILE_W, worldToScreen } from './iso.js';

/**
 * Ambient building animations: chimney smoke, cooling-tower steam, reactor
 * glow, a rotating radar sweep and a blinking tech-center antenna. Purely
 * presentational — the sim is never touched, so Math.random is fine here.
 * Modeled on PrismLinkOverlay: one Container, ONE pooled Graphics redrawn
 * per frame from an accumulated dtMs phase.
 */

type AmbientKind = 'smoke' | 'steam' | 'glow' | 'sweep' | 'blink' | 'flag' | 'forge' | 'turret';

interface AmbientAnchor {
  kind: AmbientKind;
  /** Fractional cell offset from the building's top-left corner. */
  dx: number;
  dy: number;
  /** Extra screen pixels above the anchor (stack top, dish height, …). */
  yOff: number;
  /** Extra horizontal screen pixels (off-center antenna). */
  xOff?: number;
  color?: number;
  /** smoke/steam: mean ms between puffs. */
  interval?: number;
  /** true = pauses while the owner runs a power deficit. */
  powered?: boolean;
}

const AMBIENT: Partial<Record<BuildingType, readonly AmbientAnchor[]>> = {
  POWER: [
    // The two turbine stacks (see BUILDING_ART.POWER: cylinders at iso(0.65/1.45, 1.0)).
    { kind: 'smoke', dx: 0.65, dy: 1.0, yOff: -40, interval: 450 },
    { kind: 'smoke', dx: 1.45, dy: 1.0, yOff: -40, interval: 520 },
  ],
  ADVPOWER: [
    { kind: 'smoke', dx: 0.55, dy: 1.05, yOff: -48, interval: 420 },
    { kind: 'smoke', dx: 1.55, dy: 0.75, yOff: -48, interval: 480 },
    { kind: 'glow', dx: 1.0, dy: 1.0, yOff: -30, color: 0xffe066 },
  ],
  ATOM: [
    // White steam from the wide cooling tower, green glow on the reactor.
    { kind: 'steam', dx: 0.6, dy: 1.1, yOff: -52, interval: 600 },
    { kind: 'glow', dx: 1.5, dy: 0.8, yOff: -8, color: 0x9fff6e },
  ],
  GUARDTOWER: [
    // The MG on the platform keeps a slow 180° watch sweep (the baked sprite
    // carries only the pivot mount). Manned post — works without power.
    { kind: 'turret', dx: 0.5, dy: 0.5, yOff: -41, color: 0xcfd6dc },
  ],
  BARRACKS: [
    // Waving cloth in the owner's colour at the flag pole top (the baked
    // sprite keeps only the halyard strip — see BUILDING_ART.BARRACKS.team).
    { kind: 'flag', dx: 1.5, dy: 1.0, yOff: -36 },
  ],
  FACTORY: [
    // Forge fire flickering inside the open SE vehicle door (door center at
    // iso(2.8, 1.35) minus half the opening). Pauses on a power deficit.
    { kind: 'forge', dx: 2.8, dy: 1.35, xOff: -13, yOff: -8, powered: true },
  ],
  REFINERY: [
    // Processing smoke from the ore silo; pauses when the base is starved,
    // matching the economy actually slowing down.
    { kind: 'smoke', dx: 2.3, dy: 0.8, yOff: -28, interval: 700, color: 0x4a4438, powered: true },
  ],
  RADAR: [
    // Rotating scan blip around the dish (mast at iso(1.4, 0.75), dish ~-46px).
    { kind: 'sweep', dx: 1.4, dy: 0.75, yOff: -46, color: 0x8dffa0, powered: true },
  ],
  TECHCENTER: [
    // The antenna signal node blinks (mast at center, node at +9/-47 px).
    { kind: 'blink', dx: 1.0, dy: 1.0, yOff: -47, xOff: 9, color: 0x7fd4ff, powered: true },
  ],
};

interface Puff {
  x: number;
  y: number;
  cellX: number;
  cellY: number;
  born: number;
  life: number;
  drift: number;
  r: number;
  color: number;
  alpha: number;
}

const MAX_PUFFS = 200;

/** Local iso offset in the FLAT projection the building art was baked with —
 *  matches the sprite exactly regardless of terrain lift under the anchor. */
function localIso(dx: number, dy: number): { x: number; y: number } {
  return { x: ((dx - dy) * TILE_W) / 2, y: ((dx + dy) * TILE_H) / 2 };
}

export class AmbientOverlay {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private phase = 0;
  private puffs: Puff[] = [];
  private nextEmit = new Map<string, number>();

  constructor() {
    this.layer.addChild(this.g);
  }

  update(state: GameState, dtMs: number): void {
    this.g.clear();
    this.phase += dtMs;

    const fog = state.fogs[session.localPlayer]!;
    const hidden = (cx: number, cy: number): boolean =>
      fog[cy * state.mapWidth + cx] === FOG_HIDDEN;

    const starvedCache = new Map<number, boolean>();
    const starved = (owner: number): boolean => {
      if (owner < 0) return false;
      let v = starvedCache.get(owner);
      if (v === undefined) {
        const { produced, used } = powerBalance(state, owner);
        v = used > produced;
        starvedCache.set(owner, v);
      }
      return v;
    };

    for (const b of state.buildings) {
      const anchors = AMBIENT[b.type];
      if (!anchors || b.hp <= 0 || hidden(b.cx, b.cy)) continue;
      const corner = worldToScreen(b.cx * SUBCELL, b.cy * SUBCELL);
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i]!;
        if (a.powered === true && starved(b.owner)) continue;
        // Rotated buildings are the diagonal iso mirror: cell (dx,dy) maps to
        // (dy,dx), pixel offsets flip horizontally.
        const local = b.rotated ? localIso(a.dy, a.dx) : localIso(a.dx, a.dy);
        const ax = corner.x + local.x + (b.rotated ? -(a.xOff ?? 0) : (a.xOff ?? 0));
        const ay = corner.y + local.y + a.yOff;
        switch (a.kind) {
          case 'smoke':
          case 'steam':
            this.emit(b.id, i, a, ax, ay, b.cx, b.cy);
            break;
          case 'glow': {
            const pulse = 0.5 + 0.5 * Math.sin(this.phase / 420 + b.id);
            const color = a.color ?? 0xffe066;
            this.g.circle(ax, ay, 5 + pulse * 2).fill({ color, alpha: 0.25 + 0.3 * pulse });
            this.g.circle(ax, ay, 2.5).fill({ color: 0xffffff, alpha: 0.35 + 0.35 * pulse });
            break;
          }
          case 'sweep': {
            // A bright blip orbits the dish on a flat ellipse — reads as the
            // antenna turning without repainting the baked sprite.
            const ang = (this.phase / 1400 + b.id * 0.37) * Math.PI * 2;
            const color = a.color ?? 0x8dffa0;
            const bx = ax + Math.cos(ang) * 12;
            const by = ay + Math.sin(ang) * 5;
            this.g.ellipse(ax, ay, 12, 5).stroke({ width: 1, color, alpha: 0.18 });
            this.g.circle(bx, by, 2.2).fill({ color, alpha: 0.9 });
            this.g.circle(bx, by, 4.5).fill({ color, alpha: 0.25 });
            break;
          }
          case 'blink': {
            // ~1.2 s square wave, staggered per building id.
            const on = ((this.phase / 1200 + b.id * 0.5) % 1) < 0.45;
            if (on) {
              const color = a.color ?? 0x7fd4ff;
              this.g.circle(ax, ay, 2.5).fill({ color, alpha: 0.95 });
              this.g.circle(ax, ay, 5).fill({ color, alpha: 0.3 });
            }
            break;
          }
          case 'flag': {
            // Waving cloth: amplitude grows toward the free end, slight droop
            // like the old baked flag (px+1..px+13, 7.5px tall).
            const owner = state.players[b.owner];
            if (!owner) break;
            const wave = this.phase / 170 + b.id;
            const segs = 4;
            const top: Array<[number, number]> = [];
            for (let k = 0; k <= segs; k++) {
              const fx = ax + 1 + (12 * k) / segs;
              const fy = ay + (2 * k) / segs + Math.sin(wave + k * 0.9) * (1.6 * k) / segs;
              top.push([fx, fy]);
            }
            const pts: number[] = [];
            for (const [fx, fy] of top) pts.push(fx, fy);
            for (let k = segs; k >= 0; k--) pts.push(top[k]![0], top[k]![1] + 7.5 - (1.5 * k) / segs);
            this.g.poly(pts).fill({ color: owner.color, alpha: 0.95 });
            // Shaded outer half so the ripple reads as depth, not noise.
            this.g
              .moveTo(top[2]![0], top[2]![1])
              .lineTo(top[segs]![0], top[segs]![1])
              .stroke({ width: 1, color: 0x000000, alpha: 0.18 });
            break;
          }
          case 'turret': {
            // Slow watch sweep: ±90° around east (a full 180° arc, ~11 s per
            // back-and-forth), iso-flattened vertically, staggered per tower.
            const ang = Math.sin(this.phase / 1800 + b.id) * (Math.PI / 2);
            const dxs = Math.cos(ang);
            const dys = Math.sin(ang) * 0.5;
            const bx = ax + dxs * 13;
            const by = ay + dys * 13;
            this.g
              .moveTo(ax + dxs * 3, ay + dys * 3)
              .lineTo(bx, by)
              .stroke({ width: 2, color: 0x4a4a4a });
            this.g.circle(bx, by, 1.4).fill({ color: a.color ?? 0xcfd6dc });
            break;
          }
          case 'forge': {
            // Fire glow inside the open factory door: two-tone flicker from
            // beating sines (fast + slow), staggered per building id.
            const f =
              0.5 +
              0.5 * Math.sin(this.phase / 90 + b.id * 2.1) * Math.sin(this.phase / 47 + b.id);
            this.g.ellipse(ax, ay, 10, 6.5).fill({ color: 0xff8c42, alpha: 0.2 + 0.16 * f });
            this.g.ellipse(ax, ay + 1, 5.5, 3.5).fill({ color: 0xffcf6e, alpha: 0.32 + 0.28 * f });
            this.g.circle(ax, ay + 2, 1.8).fill({ color: 0xfff3d0, alpha: 0.55 + 0.35 * f });
            break;
          }
        }
      }
    }

    // Age and draw the live puffs; drop the expired and the fog-swallowed.
    if (this.puffs.length > 0) {
      const alive: Puff[] = [];
      for (const p of this.puffs) {
        const t = (this.phase - p.born) / p.life;
        if (t >= 1 || hidden(p.cellX, p.cellY)) continue;
        alive.push(p);
        const rise = t * 26;
        this.g
          .circle(p.x + p.drift * t, p.y - rise, p.r * (1 + t * 1.4))
          .fill({ color: p.color, alpha: p.alpha * (1 - t) });
      }
      this.puffs = alive;
    }

    // Emission bookkeeping cannot grow unbounded: prune when clearly stale.
    if (this.nextEmit.size > 512) this.nextEmit.clear();
  }

  private emit(
    buildingId: number,
    anchorIdx: number,
    a: AmbientAnchor,
    ax: number,
    ay: number,
    cellX: number,
    cellY: number,
  ): void {
    const key = `${buildingId}:${anchorIdx}`;
    const next = this.nextEmit.get(key) ?? 0;
    if (this.phase < next) return;
    const interval = a.interval ?? 500;
    this.nextEmit.set(key, this.phase + interval * (0.7 + Math.random() * 0.6));
    if (this.puffs.length >= MAX_PUFFS) return;
    const steam = a.kind === 'steam';
    this.puffs.push({
      x: ax + (Math.random() - 0.5) * 3,
      y: ay,
      cellX,
      cellY,
      born: this.phase,
      life: (steam ? 2200 : 1700) * (0.85 + Math.random() * 0.3),
      drift: (Math.random() - 0.5) * 10 + 4, // light breeze to the right
      r: steam ? 4.5 : 3,
      color: a.color ?? (steam ? 0xe8e8e4 : 0x5a5a55),
      alpha: steam ? 0.3 : 0.4,
    });
  }
}
