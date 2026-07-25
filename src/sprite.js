// Pixel-art tomato, generated at 16x16 and drawn upscaled with smoothing off so it
// stays crisp and blocky at any size. Matches the look of the tomatoTime 7TV emote.

const SIZE = 16;

// Slightly orange-red: a pinker red reads as strawberry.
const SKIN = '#e03a1e';
const SKIN_LIGHT = '#f4694a';
const SKIN_DARK = '#a82613';
const RIM = '#6d1408';
const LEAF = '#4f9e35';
const LEAF_DARK = '#2e6b1f';

// The body is a squat ellipse — wider than tall. This is the single thing that
// separates a tomato from a strawberry, which tapers to a point instead.
const CX = 8;
const CY = 9.9;
const RX = 6.9;
const RY = 5.3;

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function buildTomato() {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d');

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Normalised ellipse coordinates: d <= 1 is inside the fruit.
      const nx = (x + 0.5 - CX) / RX;
      const ny = (y + 0.5 - CY) / RY;
      const d = Math.hypot(nx, ny);
      if (d > 1) continue;

      let color;
      if (d > 0.88) color = RIM;
      // A small compact gloss spot, not a broad diagonal band.
      else if (Math.hypot(nx + 0.38, ny + 0.4) < 0.26) color = SKIN_LIGHT;
      else if (nx + ny > 0.55) color = SKIN_DARK;
      else color = SKIN;
      px(ctx, x, y, color);
    }
  }

  // Calyx: short sepals lying FLAT across the top and flaring sideways, with a stubby
  // stem. A strawberry's crown instead drapes down over the shoulders of the fruit.
  // One unbroken band across the top of the fruit, rather than pieces floating out
  // at the sides.
  for (let x = 4; x <= 11; x++) px(ctx, x, 5, LEAF);
  px(ctx, 7, 4, LEAF);
  px(ctx, 8, 4, LEAF);
  // Outer sepal tips sit in shadow, which stops the band reading as a flat bar.
  for (const [x, y] of [[3, 5], [12, 5], [5, 6], [10, 6]]) {
    px(ctx, x, y, LEAF_DARK);
  }
  // Stubby stem.
  for (const [x, y] of [[7, 2], [8, 2], [7, 3], [8, 3]]) {
    px(ctx, x, y, LEAF_DARK);
  }

  return c;
}

let cached = null;

/** The 16x16 tomato sprite, built once and reused by every projectile. */
export function tomatoSprite() {
  if (!cached) cached = buildTomato();
  return cached;
}

export const SPRITE_SIZE = SIZE;
