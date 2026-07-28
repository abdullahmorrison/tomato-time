import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TwitchChat } from '../src/twitch-chat.js';

// A small deterministic scheduler rather than node:test's mock.timers: on Node 18 the
// latter drops any timer scheduled after a clearTimeout(null), which is precisely the
// shape expectTraffic uses on its first call. Everything driven here is synchronous,
// and the globals are restored before the test returns.
function fakeClock() {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let now = 0;
  let seq = 0;
  let pending = [];

  globalThis.setTimeout = (fn, ms = 0) => {
    const id = ++seq;
    pending.push({ id, at: now + ms, fn });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    pending = pending.filter((t) => t.id !== id);
  };

  return {
    tick(ms) {
      const target = now + ms;
      for (;;) {
        // Re-read each time: a callback may schedule or cancel further timers.
        const due = pending.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        pending = pending.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = target;
    },
    restore() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

const SILENCE_LIMIT = 360000;

// Browsers have had CustomEvent forever; Node only exposes it globally from v19.
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type, options);
      this.detail = options.detail;
    }
  };
}

/** Stand-in for the browser WebSocket, with the listeners exposed so tests can fire them. */
class FakeSocket {
  static last = null;
  constructor() {
    this.sent = [];
    this.closeCalls = 0;
    this.listeners = {};
    FakeSocket.last = this;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(line) { this.sent.push(line); }
  close() { this.closeCalls++; }
  fire(type, event) { for (const fn of this.listeners[type] || []) fn(event); }
  deliver(...lines) { this.fire('message', { data: lines.join('\r\n') }); }
}

function withFakes(run) {
  const realWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  const clock = fakeClock();
  try {
    run(clock);
  } finally {
    clock.restore();
    globalThis.WebSocket = realWebSocket;
    FakeSocket.last = null;
  }
}

test('an anonymous read-only session is opened on connect', () => {
  withFakes(() => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');

    assert.match(socket.sent[0], /^CAP REQ /);
    assert.match(socket.sent[1], /^NICK justinfan\d+$/, 'no OAuth, no bot account');
    assert.equal(socket.sent[2], 'JOIN #somechannel');
    assert.equal(chat.status, 'connected');
  });
});

test('a server PING is answered so Twitch does not drop the connection', () => {
  withFakes(() => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');
    socket.sent.length = 0;

    socket.deliver('PING :tmi.twitch.tv');
    assert.deepEqual(socket.sent, ['PONG :tmi.twitch.tv']);
  });
});

test('chat messages are dispatched to listeners', () => {
  withFakes(() => {
    const chat = new TwitchChat('somechannel');
    const seen = [];
    chat.addEventListener('chat', (e) => seen.push(e.detail.text));
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');

    socket.deliver(
      '@mod=1 :somemod!somemod@somemod.tmi.twitch.tv PRIVMSG #somechannel :!tomato 60',
      ':tmi.twitch.tv 001 justinfan1 :Welcome',
    );
    assert.deepEqual(seen, ['!tomato 60']);
  });
});

// Backoff caps at 30s and carries up to +20% jitter.
const MAX_JITTERED_BACKOFF = 30000 * 1.2;

test('a dropped connection is retried with backoff', () => {
  withFakes((clock) => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const first = FakeSocket.last;
    first.fire('open');
    first.fire('close');

    assert.equal(chat.status, 'reconnecting');
    clock.tick(MAX_JITTERED_BACKOFF);
    assert.notEqual(FakeSocket.last, first, 'a fresh socket should have been opened');
  });
});

// Regression: a half-open socket delivers nothing and fires neither `close` nor
// `error`, so nothing reconnected it. The overlay kept reporting "connected" while
// silently ignoring every command -- !tomato and !wipe both did nothing.
test('a silently dead socket is closed so the retry path can run', () => {
  withFakes((clock) => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');

    clock.tick(SILENCE_LIMIT - 1000);
    assert.equal(socket.closeCalls, 0, 'still within the silence budget');

    clock.tick(2000);
    assert.equal(socket.closeCalls, 1, 'the dead socket must be closed');

    socket.fire('close');
    assert.equal(chat.status, 'reconnecting');
  });
});

test('incoming traffic keeps the watchdog from firing', () => {
  withFakes((clock) => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');

    // A quiet channel still sees a PING every few minutes; that alone must count.
    for (let i = 0; i < 5; i++) {
      clock.tick(SILENCE_LIMIT - 1000);
      socket.deliver('PING :tmi.twitch.tv');
    }
    assert.equal(socket.closeCalls, 0, 'a live connection must never be torn down');
  });
});

test('closing the overlay stops the watchdog and the retries', () => {
  withFakes((clock) => {
    const chat = new TwitchChat('somechannel');
    chat.connect();
    const socket = FakeSocket.last;
    socket.fire('open');

    chat.close();
    const closedByUs = socket.closeCalls;
    socket.fire('close');

    clock.tick(SILENCE_LIMIT * 2);
    assert.equal(socket.closeCalls, closedByUs, 'no watchdog fire after an explicit close');
    assert.equal(FakeSocket.last, socket, 'and no reconnect attempt');
  });
});
