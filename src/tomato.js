// Flying tomatoes.
//
// Direction matters: the throw travels AWAY from the viewer, into the scene, at the
// streamer. So a tomato enters large and close at the bottom of the frame and shrinks
// as it recedes, rather than growing toward the camera. Scale comes from a notional
// depth closing at a constant rate, which gives the correct perspective falloff for
// free -- fast shrink at first, tapering off as it gets further away.

import { tomatoSprite, SPRITE_SIZE } from './sprite.js';

const Z_NEAR = 1;
const MIN_FLIGHT = 520;
const MAX_FLIGHT = 820;

function rand(a, b) {
  return a + Math.random() * (b - a);
}

class Tomato {
  constructor() {
    this.active = false;
    this.t = 0;
    this.duration = 0;
    // Quadratic bezier control points.
    this.x0 = 0; this.y0 = 0;
    this.x1 = 0; this.y1 = 0;
    this.x2 = 0; this.y2 = 0;
    this.zFar = 3;
    this.nearSize = 130;
    this.angle = 0;
    this.spin = 0;
    this.x = 0; this.y = 0; this.size = 0;
  }

  launch(w, h) {
    this.active = true;
    this.t = 0;
    this.duration = rand(MIN_FLIGHT, MAX_FLIGHT);

    // Thrown from where the viewer sits: just off the bottom edge.
    this.x0 = rand(-0.05, 1.05) * w;
    this.y0 = h + rand(60, 160);

    // Landing anywhere on screen, kept off the extreme edges so the splat stays visible.
    this.x2 = rand(0.06, 0.94) * w;
    this.y2 = rand(0.08, 0.88) * h;

    // Control point above both ends, so the throw arcs up and over rather than
    // sliding along a straight line.
    this.x1 = (this.x0 + this.x2) / 2 + rand(-0.16, 0.16) * w;
    this.y1 = Math.min(this.y0, this.y2) - rand(0.12, 0.42) * h;

    // Depth follows the landing height: something that lands high on screen is
    // further away, so it arrives smaller and leaves a smaller splat. Without this
    // every impact is the same size and the flood looks flat.
    const depth = 1 - this.y2 / h;
    this.zFar = 2.15 + depth * 1.5 + rand(-0.15, 0.15);
    this.nearSize = rand(105, 155);
    this.angle = rand(0, Math.PI * 2);
    this.spin = rand(2.2, 7) * (Math.random() < 0.5 ? -1 : 1);
    return this;
  }

  /** Advance the flight. Returns true once it has landed. */
  update(dtMs) {
    // A flight only ever moves forward, whatever the caller hands us.
    this.t += Math.max(0, dtMs) / this.duration;
    const t = this.t >= 1 ? 1 : this.t;
    const u = 1 - t;

    this.x = u * u * this.x0 + 2 * u * t * this.x1 + t * t * this.x2;
    this.y = u * u * this.y0 + 2 * u * t * this.y1 + t * t * this.y2;

    const z = Z_NEAR + (this.zFar - Z_NEAR) * t;
    this.size = this.nearSize / z;
    this.angle += (this.spin * dtMs) / 1000;

    return this.t >= 1;
  }

  /** Travel direction at the moment of impact, used to bias the splatter spray. */
  impactDirection() {
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  /** How big the splat should be, matching the tomato's size as it lands. */
  impactSize() {
    return this.nearSize / this.zFar;
  }

  draw(ctx) {
    const sprite = tomatoSprite();
    const s = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

/**
 * Fixed-size pool of tomatoes. Nothing is allocated once the pool is built, so a
 * flood of chat messages cannot trigger garbage collection mid-round.
 */
export class TomatoPool {
  constructor(capacity) {
    this.capacity = capacity;
    this.items = Array.from({ length: capacity }, () => new Tomato());
    this.liveCount = 0;
  }

  /** Launch one tomato, or return null if every slot is already in flight. */
  spawn(w, h) {
    for (const item of this.items) {
      if (!item.active) {
        this.liveCount++;
        return item.launch(w, h);
      }
    }
    return null;
  }

  get full() {
    return this.liveCount >= this.capacity;
  }

  /** Advance all live tomatoes, calling onLand for each one that arrives. */
  update(dtMs, onLand) {
    for (const item of this.items) {
      if (!item.active) continue;
      if (item.update(dtMs)) {
        item.active = false;
        this.liveCount--;
        onLand(item);
      }
    }
  }

  draw(ctx) {
    for (const item of this.items) {
      if (item.active) item.draw(ctx);
    }
  }

  clear() {
    for (const item of this.items) item.active = false;
    this.liveCount = 0;
  }
}

export { SPRITE_SIZE };
