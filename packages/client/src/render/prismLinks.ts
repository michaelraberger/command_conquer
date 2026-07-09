import { FOG_HIDDEN, PRISM_LINK_RANGE_SQ, powerBalance, type GameState } from '@cac/sim';
import { Container, Graphics } from 'pixi.js';
import { cellToScreen } from './iso.js';
import { session } from '../session.js';

/** Screen height of the emitter crystal above a tower's cell centre. */
const CRYSTAL_Y = -46;

/**
 * Persistent, purely-cosmetic overlay that tethers linked prism towers so the
 * damage bonus (see defenseSystem) is visible: any two friendly, powered towers
 * within link range are joined by a pulsing beam. Render-only — never touches
 * the sim. Enemy links only show inside explored ground, like the towers do.
 */
export class PrismLinkOverlay {
  readonly layer = new Container();
  private readonly g = new Graphics();
  private phase = 0;

  constructor() {
    this.layer.addChild(this.g);
  }

  update(state: GameState, dtMs: number): void {
    this.g.clear();
    this.phase += dtMs;

    const towers = state.buildings.filter((b) => b.type === 'PRISM' && b.hp > 0);
    if (towers.length < 2) return;

    const fog = state.fogs[session.localPlayer]!;
    const online = new Map<number, boolean>();
    const isOnline = (owner: number): boolean => {
      let v = online.get(owner);
      if (v === undefined) {
        const { produced, used } = powerBalance(state, owner);
        v = used <= produced; // offline towers stop linking, matching the sim
        online.set(owner, v);
      }
      return v;
    };
    const visible = (cx: number, cy: number): boolean =>
      fog[cy * state.mapWidth + cx] !== FOG_HIDDEN;

    // Gentle 0..1 pulse shared by every tether so they breathe in unison.
    const pulse = 0.5 + 0.5 * Math.sin(this.phase / 340);

    for (let i = 0; i < towers.length; i++) {
      const a = towers[i]!;
      if (!isOnline(a.owner) || !visible(a.cx, a.cy)) continue;
      for (let j = i + 1; j < towers.length; j++) {
        const b = towers[j]!;
        if (b.owner !== a.owner || !visible(b.cx, b.cy)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx * dx + dy * dy > PRISM_LINK_RANGE_SQ) continue;

        const pa = cellToScreen(a.cx, a.cy);
        const pb = cellToScreen(b.cx, b.cy);
        this.drawTether(pa.x, pa.y + CRYSTAL_Y, pb.x, pb.y + CRYSTAL_Y, pulse);
      }
    }
  }

  private drawTether(ax: number, ay: number, bx: number, by: number, pulse: number): void {
    const g = this.g;
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 6, color: 0x7fe6ff, alpha: 0.1 + 0.12 * pulse }); // glow
    g.moveTo(ax, ay).lineTo(bx, by).stroke({ width: 2, color: 0xd6f7ff, alpha: 0.45 + 0.4 * pulse }); // core
    // Endpoint sparks at each crystal so the connection reads clearly.
    for (const [x, y] of [[ax, ay], [bx, by]] as const) {
      g.circle(x, y, 3.5 + pulse).fill({ color: 0xeaffff, alpha: 0.55 + 0.35 * pulse });
    }
    // A bright bead travels along the beam to signal the flow of energy.
    const t = (this.phase / 900) % 1;
    g.circle(ax + (bx - ax) * t, ay + (by - ay) * t, 2.5).fill({ color: 0xffffff, alpha: 0.8 });
  }
}
