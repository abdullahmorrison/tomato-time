import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, DEFAULTS, DEFAULT_ALLOW, CORNERS } from '../src/config.js';

test('an empty URL yields the documented defaults', () => {
  const c = readConfig('');
  assert.equal(c.duration, 30);
  assert.equal(c.command, '!tomato');
  assert.equal(c.cancel, '!wipe');
  assert.equal(c.corner, 'bottom-right');
  assert.equal(c.word, 'TomatoTime');
  assert.equal(c.wipeMs, 800);
  assert.equal(c.maxInFlight, Infinity);
  assert.equal(c.debug, false);
  assert.equal(c.channel, '');
});

test('channel is normalised: leading #, case and stray spaces', () => {
  assert.equal(readConfig('?channel=%23SomeOne%20').channel, 'someone');
});

// parseCommand clamps a chat-supplied duration to the same range; if these two ever
// disagree, `!tomato 900` and ?duration=900 start behaving differently.
test('duration is clamped to 5-600', () => {
  assert.equal(readConfig('?duration=60').duration, 60);
  assert.equal(readConfig('?duration=1').duration, 5);
  assert.equal(readConfig('?duration=99999').duration, 600);
  assert.equal(readConfig('?duration=abc').duration, DEFAULTS.duration);
});

test('an unknown corner falls back rather than breaking layout', () => {
  for (const corner of CORNERS) {
    assert.equal(readConfig(`?corner=${corner}`).corner, corner);
  }
  assert.equal(readConfig('?corner=TOP-LEFT').corner, 'top-left');
  assert.equal(readConfig('?corner=middle').corner, DEFAULTS.corner);
});

test('commands are lowercased, matching how chat text is compared', () => {
  const c = readConfig('?command=!SPLAT&cancel=!CLEANUP');
  assert.equal(c.command, '!splat');
  assert.equal(c.cancel, '!cleanup');
});

test('maxInFlight is unlimited unless a positive number is given', () => {
  assert.equal(readConfig('?maxInFlight=250').maxInFlight, 250);
  for (const v of ['', '0', 'none', 'off', 'unlimited', 'OFF', '-5', 'abc']) {
    assert.equal(readConfig(`?maxInFlight=${v}`).maxInFlight, Infinity, v);
  }
});

test('wipeMs is clamped to 0-5000', () => {
  assert.equal(readConfig('?wipeMs=0').wipeMs, 0);
  assert.equal(readConfig('?wipeMs=99999').wipeMs, 5000);
});

test('debug and demo accept on or 1 only', () => {
  assert.equal(readConfig('?debug=on').debug, true);
  assert.equal(readConfig('?debug=1').debug, true);
  assert.equal(readConfig('?debug=true').debug, false);
  assert.equal(readConfig('?demo=on').demo, true);
});

test('allow adds to the built-in list instead of replacing it', () => {
  const c = readConfig('?allow=@Someone,%20other%20');
  for (const name of DEFAULT_ALLOW) assert.ok(c.allow.includes(name), name);
  assert.ok(c.allow.includes('someone'));
  assert.ok(c.allow.includes('other'));
});

test('an empty allow list leaves the built-in list intact', () => {
  assert.deepEqual(readConfig('?allow=').allow, [...DEFAULT_ALLOW]);
});
