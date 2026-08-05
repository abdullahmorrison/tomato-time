// Read-only Twitch chat over WebSocket.
//
// Anonymous access: a "justinfan" nickname needs no password, no OAuth and no bot
// account, which is what lets this whole overlay be a static page with no backend.

import { clampDuration, clampExtension } from './config.js';

const ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_BACKOFF = 30000;
// Twitch PINGs roughly every five minutes, so on even the quietest channel something
// should arrive well inside this. Longer than that means the socket is gone.
const SILENCE_LIMIT = 360000;

const TAG_UNESCAPE = { '\\s': ' ', '\\:': ';', '\\\\': '\\', '\\r': '\r', '\\n': '\n' };

function parseTags(raw) {
  const tags = {};
  for (const pair of raw.split(';')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    tags[key] = value.replace(/\\[s:\\rn]/g, (m) => TAG_UNESCAPE[m] ?? m);
  }
  return tags;
}

/**
 * Parse one IRC line. Returns null for anything that is not a chat message.
 * Shape: `@tags :nick!user@host PRIVMSG #channel :text`
 */
export function parseMessage(line) {
  let rest = line;
  let tags = {};

  if (rest.startsWith('@')) {
    const sp = rest.indexOf(' ');
    tags = parseTags(rest.slice(1, sp));
    rest = rest.slice(sp + 1);
  }

  let prefix = '';
  if (rest.startsWith(':')) {
    const sp = rest.indexOf(' ');
    prefix = rest.slice(1, sp);
    rest = rest.slice(sp + 1);
  }

  if (!rest.startsWith('PRIVMSG ')) return null;

  const textAt = rest.indexOf(' :');
  if (textAt === -1) return null;
  const text = rest.slice(textAt + 2);

  const login = prefix.split('!')[0];
  const badges = tags.badges || '';

  return {
    login,
    displayName: tags['display-name'] || login,
    text,
    isMod: tags.mod === '1',
    // The broadcaster is NOT flagged mod=1, so it must be checked separately or the
    // streamer cannot trigger their own overlay.
    isBroadcaster: badges.split(',').some((b) => b.startsWith('broadcaster/')),
  };
}

export class TwitchChat extends EventTarget {
  constructor(channel) {
    super();
    this.channel = channel;
    this.socket = null;
    this.attempts = 0;
    this.closed = false;
    this.retryTimer = null;
    this.silenceTimer = null;
  }

  connect() {
    this.closed = false;
    this.open();
  }

  open() {
    this.setStatus('connecting');
    let socket;
    try {
      socket = new WebSocket(ENDPOINT);
    } catch {
      this.retry();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempts = 0;
      // No PASS is needed for an anonymous read-only connection. membership is
      // deliberately not requested: it only adds JOIN/PART noise for every viewer.
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send(`NICK justinfan${10000 + Math.floor(Math.random() * 89999)}`);
      socket.send(`JOIN #${this.channel}`);
      this.setStatus('connected');
      this.expectTraffic(socket);
    });

    socket.addEventListener('message', (event) => {
      this.expectTraffic(socket);
      for (const line of event.data.split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) {
          socket.send('PONG :tmi.twitch.tv');
          continue;
        }
        const message = parseMessage(line);
        if (message) {
          this.dispatchEvent(new CustomEvent('chat', { detail: message }));
        }
      }
    });

    socket.addEventListener('close', () => {
      clearTimeout(this.silenceTimer);
      if (!this.closed) this.retry();
    });
    socket.addEventListener('error', () => socket.close());
  }

  /**
   * Watchdog for a socket that has stopped delivering without closing.
   *
   * A half-open connection -- the far side gone, no FIN ever seen -- fires neither
   * `close` nor `error`, so nothing here would reconnect it. The overlay would keep
   * reporting "connected" while silently ignoring every command for the rest of the
   * stream. Closing it ourselves hands it to the existing retry path.
   */
  expectTraffic(socket) {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.socket === socket && !this.closed) socket.close();
    }, SILENCE_LIMIT);
  }

  // Twitch resets connections periodically over a long stream. Without this the
  // overlay would silently go dead and the streamer would have no way to tell.
  retry() {
    this.setStatus('reconnecting');
    this.attempts++;
    const backoff = Math.min(MAX_BACKOFF, 1000 * 2 ** (this.attempts - 1));
    const delay = backoff * (0.6 + Math.random() * 0.6);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  setStatus(status) {
    this.status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: status }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.silenceTimer);
    if (this.socket) this.socket.close();
  }
}

/**
 * How many tomatoes this message throws: one per whole-word occurrence of the
 * trigger, up to `cap`.
 *
 * Counting rather than testing matters because Twitch rejects a message identical to
 * the sender's last one, so repeating the trigger inside a single message is the only
 * way one chatter can keep throwing during a round. The cap stops that becoming a
 * single message that buries the screen on its own.
 */
export function countTriggers(text, word, cap = Infinity) {
  const target = word.toLowerCase();
  let count = 0;
  for (const token of text.split(/\s+/)) {
    if (token.toLowerCase() === target) count++;
  }
  return Math.min(count, cap);
}

// --- commands ---------------------------------------------------------------
//
// One parser, not a predicate per command. Both bugs this has had were a subcommand
// falling through to be read as a duration: `!tomato stop` started a round whose
// duration failed to parse, and `!tomato +30` did the same, because parseInt takes
// "+30" happily. Guarding a start parser against each new subcommand only holds as
// long as every caller also asks the other parsers first, in the right order -- and
// that ordering is invisible at the call site. Deciding once, here, is what makes the
// whole class impossible rather than patched; the next subcommand is a line in this
// function instead of a guard elsewhere plus a rule nobody can see.

const STOP_WORDS = ['stop', 'cancel', 'end', 'wipe', 'clear'];
const EXTEND_WORDS = ['more', 'extend', 'add', 'longer'];

/**
 * What this message asks the overlay to do, or null if it asks for nothing.
 *
 *   { kind: 'cancel' }           end the round now and wipe the screen
 *   { kind: 'extend', seconds }  give the round in progress more time
 *   { kind: 'start', seconds }   begin a round
 *
 * Reads `command`, `cancel`, `duration` and `allow` off the overlay config. `allow`
 * lists logins that may control the overlay whatever badges they hold, so it can be
 * triggered on a channel where they are not a moderator.
 */
export function parseControl(message, { command, cancel, duration, allow = [] }) {
  if (!canControl(message, allow)) return null;

  const [name, arg, arg2] = message.text.trim().toLowerCase().split(/\s+/);
  if (name === cancel) return { kind: 'cancel' };
  if (name !== command) return null;

  // Subcommands are matched before anything reaches a clamp, so a word can never be
  // read as a number and come back as the default.
  if (STOP_WORDS.includes(arg)) return { kind: 'cancel' };
  // `!tomato +30` carries its number; the word forms take the next token. Either way a
  // missing or unreadable number falls back to the default round length.
  if (arg?.startsWith('+')) return extendBy(arg.slice(1), duration);
  if (EXTEND_WORDS.includes(arg)) return extendBy(arg2, duration);

  // Same clamp as the URL param, so `!tomato 900` and ?duration=900 cannot disagree.
  return { kind: 'start', seconds: clampDuration(arg, duration) };
}

// Bounded above like a round length, but with no five-second floor: see clampExtension.
function extendBy(value, duration) {
  return { kind: 'extend', seconds: clampExtension(value, duration) };
}

/** Whether this person is allowed to control the overlay at all. */
export function canControl(message, allow = []) {
  return (
    message.isMod ||
    message.isBroadcaster ||
    allow.includes(message.login.toLowerCase())
  );
}
