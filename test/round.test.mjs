import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, makeCanvas, makeTimerEl, sleep, waitFor } from './helpers.mjs';

installBrowser({ width: 1280, height: 720 });
const { TomatoShow } = await import('../src/round.js');

function makeShow(overrides = {}) {
  const timerEl = makeTimerEl();
  const show = new TomatoShow({
    frontCanvas: makeCanvas(),
    splatCanvas: makeCanvas(),
    timerEl,
    config: {
      maxInFlight: Infinity, wipeMs: 20, corner: 'bottom-right', duration: 30, ...overrides,
    },
  });
  return { show, timerEl };
}

// State returns to idle inside the wipe timer, but the loop only notices on its next
// frame -- wait for both, or an assertion about the loop can land in that gap.
const idle = (show) => () => show.state === 'idle' && !show.renderer.running;

test('a round runs to its own end and returns to idle', async () => {
  const { show, timerEl } = makeShow();
  assert.equal(show.start(0.15), true);
  assert.equal(show.state, 'active');
  assert.ok(timerEl.classes.has('is-visible'));

  await waitFor(idle(show), { label: 'round to finish' });
  assert.equal(show.renderer.running, false, 'the loop must stop when idle');
  assert.equal(show.pool.liveCount, 0);
  assert.ok(!timerEl.classes.has('is-visible'), 'the badge must be hidden again');
});

test('a second round cannot start while one is running', () => {
  const { show } = makeShow();
  assert.equal(show.start(30), true);
  assert.equal(show.start(30), false);
  show.reset();
});

test('throws are ignored outside an active round', () => {
  const { show } = makeShow();
  show.throwOne();
  assert.equal(show.pool.liveCount, 0);

  show.start(30);
  show.throwOne();
  assert.equal(show.pool.liveCount, 1);
  show.reset();
});

test('cancel ends a running round, hides the badge and returns to idle', async () => {
  const { show, timerEl } = makeShow();
  show.start(60);
  for (let i = 0; i < 5; i++) show.throwOne();
  await sleep(50);

  assert.equal(show.cancel(), true);
  assert.equal(show.state, 'wiping');
  assert.ok(!timerEl.classes.has('is-visible'), 'the badge goes at once, not after the wipe');

  await waitFor(idle(show), { label: 'wipe to finish' });
  assert.equal(show.pool.liveCount, 0);
  assert.equal(show.splatter.pops.length, 0);
  assert.equal(show.frontCanvas.style.opacity, '1', 'layers must be visible again');
});

test('cancel is a no-op when idle or already wiping', async () => {
  const { show } = makeShow();
  assert.equal(show.cancel(), false);

  show.start(60);
  assert.equal(show.cancel(), true);
  assert.equal(show.cancel(), false, 'a second cancel during the wipe changes nothing');
  await waitFor(idle(show), { label: 'wipe to finish' });
});

test('a new round starts normally after a cancelled one', async () => {
  const { show, timerEl } = makeShow();
  show.start(60);
  show.throwOne();
  await sleep(50);
  show.cancel();
  await waitFor(idle(show), { label: 'wipe to finish' });

  assert.equal(show.start(60), true, '!tomato must work again after !wipe');
  assert.equal(show.state, 'active');
  assert.ok(timerEl.classes.has('is-visible'));
  show.reset();
});

// Regression: the frame loop is the only thing that moves a round out of `active` or
// `landing`. When the loop died the state stayed put, so start() returned false for
// the rest of the stream and !tomato silently did nothing.
test('a round stranded by a dead loop is recovered by the next start', () => {
  const { show, timerEl } = makeShow();
  show.start(60);
  show.throwOne();

  // Exactly what a failed frame leaves behind: loop gone, state still active.
  show.renderer.running = false;
  assert.equal(show.state, 'active');

  assert.equal(show.start(30), true, 'the next !tomato must recover the overlay');
  assert.equal(show.state, 'active');
  assert.equal(show.renderer.running, true);
  assert.ok(timerEl.classes.has('is-visible'));
  show.reset();
});

test('reset drops everything and restores the layers', () => {
  const { show, timerEl } = makeShow();
  show.start(60);
  for (let i = 0; i < 3; i++) show.throwOne();
  show.reset();

  assert.equal(show.state, 'idle');
  assert.equal(show.pool.liveCount, 0);
  assert.ok(!timerEl.classes.has('is-visible'));
  assert.equal(show.frontCanvas.style.opacity, '1');
});

test('landed tomatoes are recycled rather than reallocated', async () => {
  const { show } = makeShow();
  show.start(60);
  for (let i = 0; i < 20; i++) show.throwOne();
  const created = show.pool.created;

  await waitFor(() => show.pool.liveCount === 0, { label: 'tomatoes to land' });
  for (let i = 0; i < 20; i++) show.throwOne();
  assert.equal(show.pool.created, created, 'a second wave must reuse the pool');
  show.reset();
});

test('an explicit cap limits concurrent tomatoes', () => {
  const { show } = makeShow({ maxInFlight: 3 });
  show.start(60);
  for (let i = 0; i < 10; i++) show.throwOne();
  assert.equal(show.pool.liveCount, 3);
  show.reset();
});
