import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, makeCanvas, waitFor } from './helpers.mjs';

installBrowser();
const { Renderer } = await import('../src/renderer.js');

test('the loop stops on its own once a frame says it is done', async () => {
  let frames = 0;
  const r = new Renderer(makeCanvas(), () => {
    frames++;
    return frames < 3;
  });
  r.start();
  await waitFor(() => !r.running, { label: 'loop to stop' });
  assert.equal(frames, 3);
});

test('start() while already running does not open a second loop', async () => {
  const realRaf = globalThis.requestAnimationFrame;
  let scheduled = 0;
  globalThis.requestAnimationFrame = (fn) => {
    scheduled++;
    return realRaf(fn);
  };

  try {
    let frames = 0;
    const r = new Renderer(makeCanvas(), () => {
      frames++;
      return frames < 5;
    });

    r.start();
    r.start();
    r.start();
    assert.equal(scheduled, 1, 'three starts must queue one frame, not three');

    await waitFor(() => !r.running, { label: 'loop to stop' });
    // Each frame queues exactly one successor, and the last queues none.
    assert.equal(scheduled, frames, 'a second loop would double the frames queued');
  } finally {
    globalThis.requestAnimationFrame = realRaf;
  }
});

test('the first frame gets a zero delta, never a negative one', async () => {
  const deltas = [];
  const r = new Renderer(makeCanvas(), (dt) => {
    deltas.push(dt);
    return deltas.length < 4;
  });
  r.start();
  await waitFor(() => !r.running, { label: 'loop to stop' });
  assert.equal(deltas[0], 0);
  assert.ok(deltas.every((d) => d >= 0 && d <= 100), `deltas out of range: ${deltas}`);
});

// Regression: a frame that threw used to leave the rAF chain unscheduled *and*
// `running` true, so every later start() returned early -- the overlay was dead for
// the rest of the stream and only a source reload brought it back.
test('a thrown frame stops the loop cleanly and leaves it restartable', async () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a);

  let frames = 0;
  let explode = true;
  const r = new Renderer(makeCanvas(), () => {
    frames++;
    if (explode) throw new Error('bad frame');
    return frames < 6;
  });

  try {
    r.start();
    await waitFor(() => !r.running, { label: 'loop to stop after throwing' });
    assert.equal(frames, 1);
    assert.equal(r.running, false, 'running must be cleared so start() can revive it');
    assert.equal(errors.length, 1, 'the failure should be logged, not swallowed');

    explode = false;
    r.start();
    await waitFor(() => frames >= 6, { label: 'loop to resume' });
    assert.ok(frames >= 6, 'a later round must be able to draw again');
  } finally {
    console.error = realError;
    r.running = false;
  }
});
