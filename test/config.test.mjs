import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readConfig, clampDuration, DEFAULTS, DEFAULT_ALLOW, CORNERS, MIN_DURATION, MAX_DURATION,
} from '../src/config.js';
import { parseCommand } from '../src/twitch-chat.js';

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

test('clampDuration holds any source to one range', () => {
  assert.equal(clampDuration('60'), 60);
  assert.equal(clampDuration(60), 60);
  assert.equal(clampDuration('1'), MIN_DURATION);
  assert.equal(clampDuration('99999'), MAX_DURATION);
  assert.equal(clampDuration('abc'), DEFAULTS.duration);
  assert.equal(clampDuration('', 45), 45, 'the fallback is used, not the default');
  assert.equal(clampDuration(null, 45), 45);
});

// The URL param and the chat command are separate entry points into the same setting.
// They shared a hand-copied clamp until this was pulled into one helper; pin that they
// still agree, so `!tomato 900` and ?duration=900 can never mean different things.
test('a duration means the same thing from the URL as from chat', () => {
  const fromChat = (text) =>
    parseCommand({ login: 'm', text, isMod: true, isBroadcaster: false }, '!tomato', 30);
  for (const value of ['5', '30', '60', '600', '1', '0', '99999']) {
    assert.equal(
      readConfig(`?duration=${value}`).duration,
      fromChat(`!tomato ${value}`),
      `duration=${value}`,
    );
  }
});

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
