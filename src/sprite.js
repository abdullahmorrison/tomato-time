// Pixel-art tomato, generated at 16x16 and drawn upscaled with smoothing off so it
// stays crisp and blocky at any size. Matches the look of the tomatoTime 7TV emote.

const SIZE = 16;

const SKIN = '#e0342a';
const SKIN_LIGHT = '#f2685c';
const SKIN_DARK = '#a81f1a';
const RIM = '#6d1210';
const LEAF = '#3f8f3a';
const LEAF_DARK = '#25601f';

// Distance from centre at which the body ends. Leaves room for the stem above.
const CX = 7.5;
const CY = 9.6;
const R = 5.6;

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
      const dx = x + 0.5 - CX;
      const dy = y + 0.5 - CY;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;

      // Light falls from the upper left, so shade along that axis.
      const lit = (-dx - dy) / (R * 1.6);
      let color;
      if (d > R - 1.05) color = RIM;
      else if (lit > 0.42) color = SKIN_LIGHT;
      else if (lit < -0.3) color = SKIN_DARK;
      else color = SKIN;
      px(ctx, x, y, color);
    }
  }

  // Stem: a short stalk with two leaves sweeping out over the shoulders of the fruit.
  px(ctx, 7, 2, LEAF_DARK);
  px(ctx, 8, 2, LEAF_DARK);
  px(ctx, 7, 3, LEAF);
  px(ctx, 8, 3, LEAF);
  for (const [x, y] of [[5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
                        [4, 5], [5, 5], [10, 5], [11, 5]]) {
    px(ctx, x, y, LEAF);
  }
  for (const [x, y] of [[4, 6], [11, 6], [6, 5], [9, 5]]) {
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
