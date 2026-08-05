// Round state machine and the glue between chat, physics and the screen.
//
// idle -> active -> landing -> wiping -> idle
//
// `landing` exists so that tomatoes already in the air when the timer expires are
// allowed to arrive instead of vanishing mid-flight.

import { MAX_DURATION } from './config.js';
import { TomatoPool } from './tomato.js';
import { SplatterField } from './splatter.js';
import { Renderer } from './renderer.js';
import { TimerUI } from './timer-ui.js';

export class TomatoShow {
  constructor({ frontCanvas, splatCanvas, timerEl, config, host = null }) {
    this.config = config;
    this.splatCanvas = splatCanvas;
    this.frontCanvas = frontCanvas;
    // `host` lets the setup page render a preview inside a box; the overlay itself
    // fills the window.
    this.host = host;
    this.pool = new TomatoPool(config.maxInFlight);
    this.splatter = new SplatterField(splatCanvas);
    this.timer = new TimerUI(timerEl, config.corner);
    this.renderer = new Renderer(frontCanvas, (dt, ctx) => this.frame(dt, ctx));

    this.state = 'idle';
    this.endsAt = 0;
    this.wipeTimer = null;
    this.width = 0;
    this.height = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.host ? this.host.clientWidth : window.innerWidth;
    const h = this.host ? this.host.clientHeight : window.innerHeight;
    if (!w || !h) return;
    this.renderer.resize(w, h);
    // Only safe to resize the splatter layer between rounds; mid-round it would
    // erase what is already on screen.
    if (this.state === 'idle') this.splatter.resize(w, h);
    this.width = w;
    this.height = h;
  }

  get active() {
    return this.state === 'active';
  }

  start(durationSec) {
    // Only the frame loop advances a round out of `active` or `landing`, so if the
    // loop is not running the state is stale -- a frame that failed, or a source that
    // was suspended mid-round. Left alone it would refuse every future round, so a
    // start command doubles as the way back out.
    if (this.state !== 'idle' && !this.renderer.running) this.reset();
    if (this.state !== 'idle') return false;
    // Pick up the real size now: a preview box may not have been laid out yet when
    // the show was constructed.
    this.resize();
    clearTimeout(this.wipeTimer);
    for (const layer of this.layers) {
      layer.style.transition = '';
      layer.style.opacity = '1';
    }
    this.state = 'active';
    this.endsAt = performance.now() + durationSec * 1000;
    this.timer.show();
    this.timer.update(durationSec);
    this.renderer.start();
    return true;
  }

  /**
   * Give the round in progress more time. Only meaningful while the timer is still
   * counting: once it has expired the round is landing what is already in the air,
   * and reopening it there would drop tomatoes onto a screen that is about to wipe.
   */
  extend(seconds) {
    if (this.state !== 'active') return false;
    const now = performance.now();
    // Cap what is left rather than what is added, so repeated extends cannot walk a
    // round past the range every other way of setting a duration is held to.
    const left = Math.min((this.endsAt - now) / 1000 + seconds, MAX_DURATION);
    this.endsAt = now + left * 1000;
    this.timer.update(left);
    // Normally already running. Restarting it also means an extend recovers a round
    // whose loop has stalled, the same way a fresh start does.
    this.renderer.start();
    return true;
  }

  /** Launch one tomato. Ignored outside an active round. */
  throwOne() {
    if (this.state !== 'active') return;
    this.renderer.start();
    this.pool.spawn(this.width, this.height);
  }

  frame(dt, ctx) {
    const now = performance.now();

    if (this.state === 'active') {
      const left = (this.endsAt - now) / 1000;
      this.timer.update(left);
      if (left <= 0) {
        this.state = 'landing';
        this.timer.hide();
      }
    }

    this.pool.update(dt, (t) => {
      this.splatter.add(t.x2, t.y2, t.impactSize());
    });
    this.splatter.update(dt);

    this.splatter.drawPops(ctx);
    this.pool.draw(ctx);

    if (this.state === 'landing' && this.pool.liveCount === 0 && !this.splatter.busy) {
      this.beginWipe();
    }

    return (
      this.state === 'active' ||
      this.state === 'landing' ||
      // Keep drawing through the wipe so airborne tomatoes stay animated as they
      // fade out, rather than freezing in place.
      this.state === 'wiping' ||
      this.pool.liveCount > 0 ||
      this.splatter.busy
    );
  }

  get layers() {
    return [this.splatCanvas, this.frontCanvas];
  }

  /**
   * End the round now and wipe the screen, rather than waiting out the timer.
   * Anything still airborne fades along with the splatter instead of popping.
   */
  cancel() {
    if (this.state === 'idle' || this.state === 'wiping') return false;
    this.timer.hide();
    this.beginWipe();
    return true;
  }

  /** Drop everything and return to idle immediately, with no wipe animation. */
  reset() {
    clearTimeout(this.wipeTimer);
    this.pool.clear();
    this.splatter.clear();
    this.timer.hide();
    for (const layer of this.layers) {
      layer.style.transition = '';
      layer.style.opacity = '1';
    }
    this.state = 'idle';
  }

  beginWipe() {
    this.state = 'wiping';
    const ms = this.config.wipeMs;
    for (const layer of this.layers) {
      layer.style.transition = `opacity ${ms}ms ease-out`;
      layer.style.opacity = '0';
    }
    this.wipeTimer = setTimeout(() => {
      this.pool.clear();
      this.splatter.clear();
      for (const layer of this.layers) {
        layer.style.transition = '';
        layer.style.opacity = '1';
      }
      this.state = 'idle';
      this.resize();
    }, ms + 40);
  }
}
