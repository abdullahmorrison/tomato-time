// Procedural pixel-art splatter.
//
// Splats are generated once into a small set of low-resolution variants and then
// stamped, upscaled with smoothing off, so they share the tomato's blocky look and
// cost nothing to produce at throw time. Once stamped they live in a persistent
// canvas and are never redrawn, so a screen buried in splatter still costs zero per
// frame.

const GRID = 32;
const VARIANTS = 14;
const POP_MS = 150;

// Shaded by position rather than at random: picking a colour per pixel turns a splat
// into static instead of a solid shape.
const PULP = '#d13327';
const PULP_LIGHT = '#e8564a';
const PULP_DARK = '#a3201b';
const RIM = '#75110f';

function rand(a, b) {
  return a + Math.random() * (b - a);
}

function pick(list) {
  return list[(Math.random() * list.length) | 0];
}

function buildVariant() {
  const c = document.createElement('canvas');
  c.width = GRID;
  c.height = GRID;
  const ctx = c.getContext('2d');

  const cx = GRID / 2;
  const cy = GRID / 2 - 1;

  // Main blob: a circle deformed by a few harmonics so it never reads as round.
  const base = GRID * 0.25;
  const h = [
    { k: 3, amp: rand(0.1, 0.19), phase: rand(0, 6.28) },
    { k: 5, amp: rand(0.06, 0.12), phase: rand(0, 6.28) },
    { k: 7, amp: rand(0.03, 0.07), phase: rand(0, 6.28) },
  ];
  const radiusAt = (a) =>
    base * (1 + h.reduce((s, t) => s + t.amp * Math.sin(t.k * a + t.phase), 0));

  // Wet-looking highlight, offset up and left to match the lighting on the fruit.
  const hlx = cx - base * 0.34;
  const hly = cy - base * 0.36;
  const hlr = base * rand(0.3, 0.46);

  const filled = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      const r = radiusAt(Math.atan2(dy, dx));
      if (d > r) continue;

      const rel = d / r;
      let color;
      if (rel > 0.86) color = RIM;
      else if (rel > 0.62) color = PULP_DARK;
      else if (Math.hypot(x + 0.5 - hlx, y + 0.5 - hly) < hlr) color = PULP_LIGHT;
      else color = PULP;

      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
      filled.push([x, y]);
    }
  }

  // Satellite droplets flung clear of the main blob. Each is one solid colour.
  const drops = 5 + ((Math.random() * 8) | 0);
  for (let i = 0; i < drops; i++) {
    const a = rand(0, Math.PI * 2);
    const dist = rand(base * 1.2, GRID * 0.46);
    const dx = Math.cos(a) * dist;
    const dy = Math.sin(a) * dist;
    // Further out means smaller, the way real spatter falls off.
    const rr = Math.max(0.6, rand(1.1, 2.6) * (1 - dist / (GRID * 0.62)));
    const px = cx + dx;
    const py = cy + dy;
    ctx.fillStyle = pick([PULP, PULP, PULP_DARK]);
    for (let y = Math.floor(py - rr); y <= py + rr; y++) {
      for (let x = Math.floor(px - rr); x <= px + rr; x++) {
        if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
        if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= rr) ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Drips running down from the underside of the blob. Always downward, so variants
  // are only ever mirrored horizontally.
  const lowest = new Map();
  for (const [x, y] of filled) {
    if (!lowest.has(x) || y > lowest.get(x)) lowest.set(x, y);
  }
  const columns = [...lowest.keys()];
  const dripCount = 1 + ((Math.random() * 3) | 0);
  for (let i = 0; i < dripCount; i++) {
    const x = pick(columns);
    const from = lowest.get(x);
    const len = rand(2, 7) | 0;
    ctx.fillStyle = PULP_DARK;
    for (let j = 1; j <= len; j++) {
      const y = from + j;
      if (y >= GRID) break;
      ctx.fillRect(x, y, 1, 1);
      // A slightly fatter head where the drip is about to fall.
      if (j === len && y + 1 < GRID) {
        ctx.fillRect(x, y + 1, 1, 1);
        if (x + 1 < GRID) ctx.fillRect(x + 1, y, 1, 1);
      }
    }
  }

  return c;
}

/**
 * The accumulated splatter on screen, plus the brief expansion each new splat plays
 * before it is committed.
 */
export class SplatterField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.variants = Array.from({ length: VARIANTS }, buildVariant);
    this.pops = [];
  }

  resize(w, h) {
    // Resizing clears the canvas, which is fine: it only happens between rounds.
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Begin a splat at the impact point. It commits to the persistent layer after POP_MS. */
  add(x, y, size) {
    this.pops.push({
      x,
      y,
      size: size * 2.1,
      variant: this.variants[(Math.random() * this.variants.length) | 0],
      flip: Math.random() < 0.5,
      age: 0,
    });
  }

  get busy() {
    return this.pops.length > 0;
  }

  /** Advance in-progress splats, stamping any that have finished expanding. */
  update(dtMs) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.age += dtMs;
      if (p.age >= POP_MS) {
        this.stamp(this.ctx, p, 1);
        this.pops.splice(i, 1);
      }
    }
  }

  /** Draw the still-expanding splats onto the front layer. */
  drawPops(ctx) {
    for (const p of this.pops) {
      const t = p.age / POP_MS;
      // Overshoot slightly then settle, so impacts land with a snap.
      const scale = t < 0.6 ? 0.45 + (t / 0.6) * 0.72 : 1.17 - ((t - 0.6) / 0.4) * 0.17;
      this.stamp(ctx, p, scale);
    }
  }

  stamp(ctx, p, scale) {
    const s = p.size * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(p.x, p.y);
    if (p.flip) ctx.scale(-1, 1);
    ctx.drawImage(p.variant, -s / 2, -s / 2, s, s);
    ctx.restore();
  }

  clear() {
    this.pops.length = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export { POP_MS };
