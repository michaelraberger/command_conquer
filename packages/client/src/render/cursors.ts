/**
 * Classic C&C-style mouse cursors, drawn procedurally (own art, no original
 * assets): white selection brackets, a green ring of outward arrows for move
 * orders and a red/white reticle for attacks. Baked once at import into
 * data-URL CSS cursors with a centered hotspot.
 */

const SIZE = 32;
const C = SIZE / 2; // hotspot / center

function bake(draw: (ctx: CanvasRenderingContext2D) => void): string {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  // Soft dark halo so the cursor reads on any terrain.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 2;
  draw(ctx);
  return `url(${canvas.toDataURL()}) ${C} ${C}, auto`;
}

/** White corner brackets — hovering something selectable. */
function drawSelect(ctx: CanvasRenderingContext2D): void {
  const t = 3; // bracket thickness
  const arm = 9; // bracket arm length
  const lo = 4;
  const hi = SIZE - 4;
  ctx.fillStyle = '#f2f5f8';
  for (const [x, y, dx, dy] of [
    [lo, lo, 1, 1],
    [hi, lo, -1, 1],
    [lo, hi, 1, -1],
    [hi, hi, -1, -1],
  ] as const) {
    ctx.fillRect(Math.min(x, x + dx * arm), y - (dy < 0 ? t : 0), arm, t);
    ctx.fillRect(x - (dx < 0 ? t : 0), Math.min(y, y + dy * arm), t, arm);
  }
}

/** Green ring of outward arrows (N/E/S/W) with diagonal blocks — move order. */
function drawMove(ctx: CanvasRenderingContext2D): void {
  const arrow = (angle: number): void => {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -15); // tip, pointing outward
    ctx.lineTo(-6, -7);
    ctx.lineTo(6, -7);
    ctx.closePath();
    ctx.fillStyle = '#2fbf3a';
    ctx.fill();
    ctx.strokeStyle = '#eef6ee';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };
  const block = (angle: number): void => {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(angle);
    ctx.fillStyle = '#1f8f2a';
    ctx.fillRect(-3, -12, 6, 6);
    ctx.strokeStyle = '#bfe8bf';
    ctx.lineWidth = 1;
    ctx.strokeRect(-3, -12, 6, 6);
    ctx.restore();
  };
  for (let k = 0; k < 4; k++) {
    block((k + 0.5) * (Math.PI / 2));
    arrow(k * (Math.PI / 2));
  }
}

/** White ring with four red wedges pointing inward — attack order. */
function drawAttack(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(C, C, 12, 0, Math.PI * 2);
  ctx.strokeStyle = '#f2f5f8';
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(k * (Math.PI / 2) + Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, -3); // tip near the center
    ctx.lineTo(-4.5, -11);
    ctx.lineTo(4.5, -11);
    ctx.closePath();
    ctx.fillStyle = '#d42222';
    ctx.fill();
    ctx.strokeStyle = '#f2f5f8';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#f2f5f8';
  ctx.fillRect(C - 1, C - 1, 2, 2);
}

export const CURSORS = {
  select: bake(drawSelect),
  move: bake(drawMove),
  attack: bake(drawAttack),
};
