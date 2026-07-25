// Read-only Twitch chat over WebSocket.
//
// Anonymous access: a "justinfan" nickname needs no password, no OAuth and no bot
// account, which is what lets this whole overlay be a static page with no backend.

const ENDPOINT = 'wss://irc-ws.chat.twitch.tv:443';
const MAX_BACKOFF = 30000;

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
    });

    socket.addEventListener('message', (event) => {
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
      if (!this.closed) this.retry();
    });
    socket.addEventListener('error', () => socket.close());
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
    if (this.socket) this.socket.close();
  }
}

/** True when the message contains the trigger as a whole word. */
export function hasTrigger(text, word) {
  const target = word.toLowerCase();
  return text.split(/\s+/).some((token) => token.toLowerCase() === target);
}

/**
 * If this message is the start command from someone allowed to use it, return the
 * requested round length in seconds (or null).
 */
export function parseCommand(message, command, defaultDuration) {
  if (!message.isMod && !message.isBroadcaster) return null;
  const parts = message.text.trim().split(/\s+/);
  if (parts[0].toLowerCase() !== command) return null;
  const requested = parseInt(parts[1], 10);
  if (Number.isFinite(requested)) {
    return Math.min(600, Math.max(5, requested));
  }
  return defaultDuration;
}
