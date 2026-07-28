import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMessage, parseCommand, isCancel, canControl, hasTrigger,
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

// --- starting a round -------------------------------------------------------

test('bare command uses the configured default duration', () => {
  assert.equal(parseCommand(mod('!tomato'), '!tomato', 30), 30);
});

test('an explicit duration is used instead of the default', () => {
  assert.equal(parseCommand(mod('!tomato 60'), '!tomato', 30), 60);
});

test('an explicit duration is clamped to the same 5-600 range as the URL param', () => {
  assert.equal(parseCommand(mod('!tomato 1'), '!tomato', 30), 5);
  assert.equal(parseCommand(mod('!tomato 0'), '!tomato', 30), 5);
  assert.equal(parseCommand(mod('!tomato -20'), '!tomato', 30), 5);
  assert.equal(parseCommand(mod('!tomato 99999'), '!tomato', 30), 600);
});

test('an unparseable duration falls back to the default rather than NaN', () => {
  assert.equal(parseCommand(mod('!tomato soon'), '!tomato', 30), 30);
  assert.equal(parseCommand(mod('!tomato !!'), '!tomato', 30), 30);
});

test('trailing junk after the number is tolerated', () => {
  assert.equal(parseCommand(mod('!tomato 60s'), '!tomato', 30), 60);
  assert.equal(parseCommand(mod('!tomato 60 please'), '!tomato', 30), 60);
});

test('extra whitespace and casing do not matter', () => {
  assert.equal(parseCommand(mod('  !TOMATO   60  '), '!tomato', 30), 60);
});

test('a stop word is never read as a duration', () => {
  for (const word of ['stop', 'cancel', 'end', 'wipe', 'clear']) {
    assert.equal(parseCommand(mod(`!tomato ${word}`), '!tomato', 30), null, word);
  }
});

test('non-mods cannot start a round, with or without a duration', () => {
  assert.equal(parseCommand(viewer('!tomato'), '!tomato', 30), null);
  assert.equal(parseCommand(viewer('!tomato 60'), '!tomato', 30), null);
});

// Entries arrive already lowercased from readConfig, which is what makes comparing
// against a lowercased login enough; config.test.mjs pins that end of the contract.
test('an allow-listed viewer can start a round without a mod badge', () => {
  assert.equal(parseCommand(viewer('!tomato 60'), '!tomato', 30, ['someviewer']), 60);
  assert.equal(parseCommand(viewer('!tomato 60', 'SomeViewer'), '!tomato', 30, ['someviewer']), 60);
  assert.equal(parseCommand(viewer('!tomato 60'), '!tomato', 30, ['anotherperson']), null);
});

test('the command must be the first word, not merely present', () => {
  assert.equal(parseCommand(mod('hey !tomato 60'), '!tomato', 30), null);
  assert.equal(parseCommand(mod('!tomatoes'), '!tomato', 30), null);
});

test('a custom command from the URL is honoured', () => {
  assert.equal(parseCommand(mod('!splat 45'), '!splat', 30), 45);
  assert.equal(parseCommand(mod('!tomato 45'), '!splat', 30), null);
});

// --- ending a round ---------------------------------------------------------

test('the dedicated cancel command ends a round', () => {
  assert.equal(isCancel(mod('!wipe'), '!wipe', '!tomato'), true);
});

test('the start command plus a stop word also ends a round', () => {
  for (const word of ['stop', 'cancel', 'end', 'wipe', 'clear']) {
    assert.equal(isCancel(mod(`!tomato ${word}`), '!wipe', '!tomato'), true, word);
  }
});

test('a plain start command is not a cancel', () => {
  assert.equal(isCancel(mod('!tomato'), '!wipe', '!tomato'), false);
  assert.equal(isCancel(mod('!tomato 60'), '!wipe', '!tomato'), false);
});

test('non-mods cannot cancel', () => {
  assert.equal(isCancel(viewer('!wipe'), '!wipe', '!tomato'), false);
  assert.equal(isCancel(viewer('!wipe'), '!wipe', '!tomato', ['someviewer']), true);
});

// `!tomato stop` satisfies both predicates' command word, so the overlay's ordering
// (cancel checked first) is what stops it starting a round. Pin both halves.
test('!tomato stop cancels and never starts', () => {
  const msg = mod('!tomato stop');
  assert.equal(isCancel(msg, '!wipe', '!tomato'), true);
  assert.equal(parseCommand(msg, '!tomato', 30), null);
});

// --- the throw trigger ------------------------------------------------------

test('the trigger word matches only as a whole word', () => {
  assert.equal(hasTrigger('TomatoTime', 'TomatoTime'), true);
  assert.equal(hasTrigger('go TomatoTime go', 'TomatoTime'), true);
  assert.equal(hasTrigger('tomatotime', 'TomatoTime'), true);
  assert.equal(hasTrigger('xTomatoTime', 'TomatoTime'), false);
  assert.equal(hasTrigger('TomatoTimes', 'TomatoTime'), false);
  assert.equal(hasTrigger('', 'TomatoTime'), false);
});
