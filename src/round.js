// Round state machine and the glue between chat, physics and the screen.
//
// idle -> active -> landing -> wiping -> idle
//
// `landing` exists so that tomatoes already in the air when the timer expires are
// allowed to arrive instead of vanishing mid-flight.

import { TomatoPool } from './tomato.js';
import { SplatterField } from './splatter.js';
import { Renderer } from './renderer.js';
import { TimerUI } from './timer-ui.js';

export class TomatoShow {
  constructor({ frontCanvas, splatCanvas, timerEl, config, host = null }) {
    this.config = config;
    this.splatCanvas = splatCanvas;
    // `host` lets the setup page render a preview inside a box; the overlay itself
    // fills the window.
    this.host = host;
    this.pool = new TomatoPool(config.maxInFlight);
    this.splatter = new SplatterField(splatCanvas);
    this.timer = new TimerUI(timerEl, config.corner);
    this.renderer = new Renderer(frontCanvas, (dt, ctx) => this.frame(dt, ctx));

    this.state = 'idle';
    this.endsAt = 0;
    this.queued = 0;
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
    if (this.state !== 'idle') return false;
    // Pick up the real size now: a preview box may not have been laid out yet when
    // the show was constructed.
    this.resize();
    clearTimeout(this.wipeTimer);
    this.splatCanvas.style.transition = '';
    this.splatCanvas.style.opacity = '1';
    this.state = 'active';
    this.endsAt = performance.now() + durationSec * 1000;
    this.timer.show();
    this.timer.update(durationSec);
    this.renderer.start();
    return true;
  }

  /** Queue one tomato. Extra throws during a flood wait for a free slot. */
  throwOne() {
    this.queued++;
    this.renderer.start();
  }

  frame(dt, ctx) {
    const now = performance.now();

    if (this.state === 'active') {
      const left = (this.endsAt - now) / 1000;
      this.timer.update(left);
      if (left <= 0) {
        this.state = 'landing';
        this.queued = 0;
        this.timer.hide();
      }
    }

    // Drain the queue a few at a time so a burst still arrives as a burst without
    // every tomato launching on the identical frame.
    if (this.state === 'active') {
      let budget = 6;
      while (this.queued > 0 && budget-- > 0 && !this.pool.full) {
        if (this.pool.spawn(this.width, this.height)) this.queued--;
        else break;
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
      this.pool.liveCount > 0 ||
      this.splatter.busy
    );
  }

  beginWipe() {
    this.state = 'wiping';
    const ms = this.config.wipeMs;
    this.splatCanvas.style.transition = `opacity ${ms}ms ease-out`;
    this.splatCanvas.style.opacity = '0';
    this.wipeTimer = setTimeout(() => {
      this.splatter.clear();
      this.splatCanvas.style.transition = '';
      this.splatCanvas.style.opacity = '1';
      this.state = 'idle';
      this.resize();
    }, ms + 40);
  }
}
