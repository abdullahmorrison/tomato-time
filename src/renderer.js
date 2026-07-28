// The frame loop.
//
// The overlay sits loaded for the whole stream but is idle almost all of it, so the
// loop stops completely when there is nothing to draw and restarts on demand. Timing
// is delta-based rather than assuming 60fps, so motion stays correct when OBS drops
// frames under encoder load.

export class Renderer {
  constructor(canvas, onFrame) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.onFrame = onFrame;
    this.running = false;
    this.last = 0;
    this.tick = this.tick.bind(this);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Seeded from the first animation frame rather than performance.now(): the two
    // clocks can have different origins, and a negative delta would run flights
    // backwards.
    this.last = -1;
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  tick(now) {
    if (!this.running) return;
    if (this.last < 0) this.last = now;
    // Clamped at both ends: an upper bound so a long stall (a scene switch, a GC
    // pause) cannot teleport everything across the screen in one frame, and a lower
    // bound of zero so a clock adjustment can never rewind a flight.
    const dt = Math.max(0, Math.min(100, now - this.last));
    this.last = now;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    let keepGoing = false;
    try {
      keepGoing = this.onFrame(dt, this.ctx);
    } catch (err) {
      // One bad frame must not cost the rest of the stream. Without this the chain is
      // never rescheduled *and* `running` stays true, so every later start() returns
      // early and nothing can ever draw again -- only reloading the source recovers.
      // Stopping properly leaves the loop restartable by the next round.
      console.error('[tomatod] frame failed, stopping the loop', err);
      this.stop();
      return;
    }

    if (keepGoing) {
      requestAnimationFrame(this.tick);
    } else {
      this.stop();
    }
  }
}
