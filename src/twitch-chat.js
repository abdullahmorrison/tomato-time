// Read-only Twitch chat over WebSocket.
//
// Anonymous access: a "justinfan" nickname needs no password, no OAuth and no bot
// account, which is what lets this whole overlay be a static page with no backend.

import { clampDuration } from './config.js';

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

/**
 * If this message is the start command from someone allowed to use it, return the
 * requested round length in seconds (or null).
 *
 * `allow` lists logins that may start a round whatever badges they hold, so the
 * overlay can be triggered on a channel where they are not a moderator.
 */
export function parseCommand(message, command, defaultDuration, allow = []) {
  if (!canControl(message, allow)) return null;
  const parts = words(message.text);
  if (parts[0] !== command) return null;
  // `!tomato stop` ends a round. Without this it would fall through and read as a
  // start with an unparseable duration, i.e. the exact opposite of what was asked.
  if (STOP_WORDS.includes(parts[1])) return null;
  // Same trap for `!tomato +30`: parseInt reads "+30" happily, so without this an
  // extend would start a fresh 30-second round the moment one was not already running.
  if (extendArg(parts) !== null) return null;

  // Same clamp as the URL param, so `!tomato 900` and ?duration=900 cannot disagree.
  return clampDuration(parts[1], defaultDuration);
}

/**
 * If this message asks for the round in progress to run longer, return how many extra
 * seconds it should get (or null).
 *
 * Accepts `!tomato +30`, a bare `!tomato more`, and `!tomato extend 15`. A round is
 * routinely worth more time than it was given, and the alternative -- wiping and
 * starting again -- clears the screen, which is the opposite of what is wanted.
 */
export function parseExtend(message, command, defaultDuration, allow = []) {
  if (!canControl(message, allow)) return null;
  const parts = words(message.text);
  if (parts[0] !== command) return null;
  const arg = extendArg(parts);
  if (arg === null) return null;
  // Clamped like every other duration, so `!tomato +99999` is bounded the same way
  // `!tomato 99999` is.
  return clampDuration(arg, defaultDuration);
}

/**
 * The seconds argument of an extend request, or null if this is not one. `+30` carries
 * its own number; a word form takes the next word, and either yields '' when the number
 * is missing so the caller falls back to the default.
 *
 * Absent has to read as '' and not as null: a bare `!tomato more` is a real extend
 * request, and sharing one sentinel with "not an extend request" would send it on to be
 * read as a start -- wiping the screen instead of adding to what is on it.
 */
function extendArg(parts) {
  const arg = parts[1] || '';
  if (arg.startsWith('+')) return arg.slice(1);
  if (EXTEND_WORDS.includes(arg)) return parts[2] || '';
  return null;
}

const STOP_WORDS = ['stop', 'cancel', 'end', 'wipe', 'clear'];
const EXTEND_WORDS = ['more', 'extend', 'add', 'longer'];

function words(text) {
  return text.trim().toLowerCase().split(/\s+/);
}

/** Whether this person is allowed to start or end a round. */
export function canControl(message, allow = []) {
  return (
    message.isMod ||
    message.isBroadcaster ||
    allow.includes(message.login.toLowerCase())
  );
}

/**
 * True if this message ends the round early. Accepts the dedicated cancel command
 * and, for convenience, `<start command> stop` and its synonyms.
 */
export function isCancel(message, cancelCommand, startCommand, allow = []) {
  if (!canControl(message, allow)) return false;
  const parts = words(message.text);
  if (parts[0] === cancelCommand) return true;
  return parts[0] === startCommand && STOP_WORDS.includes(parts[1]);
}
