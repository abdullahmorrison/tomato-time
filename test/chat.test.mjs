import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessage, parseControl, canControl, countTriggers,
} from '../src/twitch-chat.js';

const mod = (text) => ({ login: 'somemod', text, isMod: true, isBroadcaster: false });
const viewer = (text, login = 'someviewer') => ({ login, text, isMod: false, isBroadcaster: false });

test('parseMessage reads a PRIVMSG with tags', () => {
  const line =
    '@badges=moderator/1;display-name=SomeMod;mod=1 :somemod!somemod@somemod.tmi.twitch.tv PRIVMSG #chan :!tomato 60';
  assert.deepEqual(parseMessage(line), {
    login: 'somemod',
    displayName: 'SomeMod',
    text: '!tomato 60',
    isMod: true,
    isBroadcaster: false,
  });
});

test('parseMessage flags the broadcaster, who is not mod=1', () => {
  const line =
    '@badges=broadcaster/1;display-name=Streamer;mod=0 :streamer!streamer@streamer.tmi.twitch.tv PRIVMSG #chan :!tomato';
  const msg = parseMessage(line);
  assert.equal(msg.isBroadcaster, true);
  assert.equal(msg.isMod, false);
  assert.equal(canControl(msg), true);
});

test('parseMessage unescapes tag values and ignores non-PRIVMSG lines', () => {
  const line = '@display-name=A\\sB :a!a@a.tmi.twitch.tv PRIVMSG #chan :hi';
  assert.equal(parseMessage(line).displayName, 'A B');
  assert.equal(parseMessage(':tmi.twitch.tv 001 justinfan1 :Welcome'), null);
  assert.equal(parseMessage('PING :tmi.twitch.tv'), null);
});

test('parseMessage keeps colons inside the message text', () => {
  const line = ':a!a@a.tmi.twitch.tv PRIVMSG #chan :see: https://example.com';
  assert.equal(parseMessage(line).text, 'see: https://example.com');
});

// --- reading a command ------------------------------------------------------
//
// parseControl decides what a message asks for in one pass, so each case here pins the
// kind and the seconds together. Splitting that across a predicate per command is what
// let `!tomato stop` and `!tomato +30` both read as starts.

const CONF = { command: '!tomato', cancel: '!wipe', duration: 30, allow: [] };
const control = (text, extra = {}) => parseControl(mod(text), { ...CONF, ...extra });

// --- starting a round -------------------------------------------------------

test('bare command uses the configured default duration', () => {
  assert.deepEqual(control('!tomato'), { kind: 'start', seconds: 30 });
});

test('an explicit duration is used instead of the default', () => {
  assert.deepEqual(control('!tomato 60'), { kind: 'start', seconds: 60 });
});

test('an explicit duration is clamped to the same 5-600 range as the URL param', () => {
  for (const [text, seconds] of [['1', 5], ['0', 5], ['-20', 5], ['99999', 600]]) {
    assert.deepEqual(control(`!tomato ${text}`), { kind: 'start', seconds }, text);
  }
});

test('an unparseable duration falls back to the default rather than NaN', () => {
  assert.deepEqual(control('!tomato soon'), { kind: 'start', seconds: 30 });
  assert.deepEqual(control('!tomato !!'), { kind: 'start', seconds: 30 });
});

test('trailing junk after the number is tolerated', () => {
  assert.deepEqual(control('!tomato 60s'), { kind: 'start', seconds: 60 });
  assert.deepEqual(control('!tomato 60 please'), { kind: 'start', seconds: 60 });
});

test('extra whitespace and casing do not matter', () => {
  assert.deepEqual(control('  !TOMATO   60  '), { kind: 'start', seconds: 60 });
});

test('the command must be the first word, not merely present', () => {
  assert.equal(control('hey !tomato 60'), null);
  assert.equal(control('!tomatoes'), null);
});

test('a custom command from the URL is honoured', () => {
  assert.deepEqual(control('!splat 45', { command: '!splat' }), { kind: 'start', seconds: 45 });
  assert.equal(control('!tomato 45', { command: '!splat' }), null);
});

// --- extending a round ------------------------------------------------------

test('a plus sign adds that many seconds', () => {
  assert.deepEqual(control('!tomato +30'), { kind: 'extend', seconds: 30 });
  assert.deepEqual(control('!tomato +60'), { kind: 'extend', seconds: 60 });
});

test('the word forms extend too, with or without a number', () => {
  for (const word of ['more', 'extend', 'add', 'longer']) {
    assert.deepEqual(control(`!tomato ${word}`), { kind: 'extend', seconds: 30 }, word);
    assert.deepEqual(control(`!tomato ${word} 45`), { kind: 'extend', seconds: 45 }, word);
  }
});

test('an extension with no readable number falls back to the default', () => {
  assert.deepEqual(control('!tomato +'), { kind: 'extend', seconds: 30 });
  assert.deepEqual(control('!tomato +soon'), { kind: 'extend', seconds: 30 });
  assert.deepEqual(control('!tomato more please'), { kind: 'extend', seconds: 30 });
});

test('an extension is bounded above like every other duration', () => {
  assert.deepEqual(control('!tomato +99999'), { kind: 'extend', seconds: 600 });
});

// An extension is a delta, not a round length, so it does NOT get the MIN_DURATION
// floor. It did at first, and `!tomato +2` silently added five seconds instead of two
// -- the command appeared to work, just not by the amount that was asked for.
test('a small extension adds what was asked, not a five-second minimum', () => {
  for (const [text, seconds] of [['+1', 1], ['+2', 2], ['+4', 4], ['add 3', 3]]) {
    assert.deepEqual(control(`!tomato ${text}`), { kind: 'extend', seconds }, text);
  }
});

// A round length still has the floor: the two clamps must not drift back together.
test('a round length keeps its five-second floor', () => {
  assert.deepEqual(control('!tomato 2'), { kind: 'start', seconds: 5 });
});

test('a plain start command is never read as an extension', () => {
  for (const text of ['!tomato', '!tomato 60', '!tomato stop']) {
    assert.notEqual(control(text)?.kind, 'extend', text);
  }
});

// --- ending a round ---------------------------------------------------------

test('the dedicated cancel command ends a round', () => {
  assert.deepEqual(control('!wipe'), { kind: 'cancel' });
});

test('the start command plus a stop word also ends a round', () => {
  for (const word of ['stop', 'cancel', 'end', 'wipe', 'clear']) {
    assert.deepEqual(control(`!tomato ${word}`), { kind: 'cancel' }, word);
  }
});

test('a plain start command is not a cancel', () => {
  assert.equal(control('!tomato').kind, 'start');
  assert.equal(control('!tomato 60').kind, 'start');
});

// The whole point of one parser: a subcommand cannot also be seen as a duration, so
// `!tomato stop` and `!tomato +30` can never start a round no matter what order a
// caller checks things in.
test('a subcommand is never also a start', () => {
  assert.equal(control('!tomato stop').kind, 'cancel');
  assert.equal(control('!tomato +30').kind, 'extend');
  assert.equal(control('!tomato more').kind, 'extend');
});

// --- permissions ------------------------------------------------------------

test('non-mods cannot start, extend or cancel', () => {
  for (const text of ['!tomato', '!tomato 60', '!tomato +30', '!wipe']) {
    assert.equal(parseControl(viewer(text), CONF), null, text);
  }
});

// Entries arrive already lowercased from readConfig, which is what makes comparing
// against a lowercased login enough; config.test.mjs pins that end of the contract.
test('an allow-listed viewer controls the overlay without a mod badge', () => {
  const allowed = { ...CONF, allow: ['someviewer'] };
  assert.deepEqual(parseControl(viewer('!tomato 60'), allowed), { kind: 'start', seconds: 60 });
  assert.deepEqual(parseControl(viewer('!tomato 60', 'SomeViewer'), allowed), { kind: 'start', seconds: 60 });
  assert.deepEqual(parseControl(viewer('!wipe'), allowed), { kind: 'cancel' });
  assert.equal(parseControl(viewer('!tomato 60'), { ...CONF, allow: ['anotherperson'] }), null);
});

// --- the throw trigger ------------------------------------------------------

test('the trigger word counts only as a whole word', () => {
  assert.equal(countTriggers('TomatoTime', 'TomatoTime'), 1);
  assert.equal(countTriggers('go TomatoTime go', 'TomatoTime'), 1);
  assert.equal(countTriggers('tomatotime', 'TomatoTime'), 1);
  assert.equal(countTriggers('xTomatoTime', 'TomatoTime'), 0);
  assert.equal(countTriggers('TomatoTimes', 'TomatoTime'), 0);
  assert.equal(countTriggers('', 'TomatoTime'), 0);
});

// Twitch rejects a message identical to the sender's previous one, so repeating the
// trigger in one message is the only way a single chatter can keep throwing.
test('each repeat of the trigger in one message throws another tomato', () => {
  assert.equal(countTriggers('TomatoTime TomatoTime', 'TomatoTime'), 2);
  assert.equal(countTriggers('TomatoTime TomatoTime TomatoTime', 'TomatoTime'), 3);
  assert.equal(countTriggers('TomatoTime lol TomatoTime', 'TomatoTime'), 2);
});

test('repeats are counted case-insensitively, like a single one', () => {
  assert.equal(countTriggers('tomatotime TOMATOTIME TomatoTime', 'TomatoTime'), 3);
});

test('odd spacing between repeats does not lose throws', () => {
  assert.equal(countTriggers('  TomatoTime   TomatoTime  ', 'TomatoTime'), 2);
  assert.equal(countTriggers('TomatoTime\nTomatoTime\tTomatoTime', 'TomatoTime'), 3);
});

test('near-misses beside a real one do not add throws', () => {
  assert.equal(countTriggers('TomatoTime TomatoTimes xTomatoTime', 'TomatoTime'), 1);
});

test('a custom trigger word counts the same way', () => {
  assert.equal(countTriggers('splat splat splat', 'splat'), 3);
  assert.equal(countTriggers('splat splat', 'TomatoTime'), 0);
});

test('a cap limits how much one message can throw', () => {
  const spam = Array(9).fill('TomatoTime').join(' ');
  assert.equal(countTriggers(spam, 'TomatoTime', 5), 5);
  assert.equal(countTriggers(spam, 'TomatoTime', 1), 1);
  assert.equal(countTriggers(spam, 'TomatoTime', Infinity), 9);
});

test('a message under the cap is unaffected by it', () => {
  assert.equal(countTriggers('TomatoTime TomatoTime', 'TomatoTime', 5), 2);
  assert.equal(countTriggers('TomatoTime', 'TomatoTime', 5), 1);
  assert.equal(countTriggers('nothing here', 'TomatoTime', 5), 0);
});
