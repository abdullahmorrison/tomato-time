// Every setting lives in the overlay URL, so the streamer never edits a file and you
// can retune by changing the Browser Source URL.

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

// Logins that may start a round on any channel, whatever badges they hold. This is
// the overlay's author, so he can trigger it on a channel where he holds no mod
// badge. The `allow` URL param adds to this list rather than replacing it.
const DEFAULT_ALLOW = ['abdullahmorrison'];

const DEFAULTS = {
  channel: '',
  duration: 30,
  corner: 'bottom-right',
  word: 'TomatoTime',
  command: '!tomato',
  maxInFlight: 120,
  wipeMs: 800,
  debug: false,
  demo: false,
  allow: DEFAULT_ALLOW,
};

function int(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readConfig(search = window.location.search) {
  const q = new URLSearchParams(search);
  const corner = (q.get('corner') || '').toLowerCase();

  return {
    ...DEFAULTS,
    channel: (q.get('channel') || '').trim().replace(/^#/, '').toLowerCase(),
    duration: int(q.get('duration'), DEFAULTS.duration, 5, 600),
    corner: CORNERS.includes(corner) ? corner : DEFAULTS.corner,
    word: (q.get('word') || DEFAULTS.word).trim(),
    command: (q.get('command') || DEFAULTS.command).trim().toLowerCase(),
    maxInFlight: int(q.get('maxInFlight'), DEFAULTS.maxInFlight, 10, 400),
    wipeMs: int(q.get('wipeMs'), DEFAULTS.wipeMs, 0, 5000),
    debug: q.get('debug') === 'on' || q.get('debug') === '1',
    // Runs a round on its own, so the effect can be watched without chat.
    demo: q.get('demo') === 'on' || q.get('demo') === '1',
    allow: [
      ...DEFAULT_ALLOW,
      ...(q.get('allow') || '')
        .split(',')
        .map((name) => name.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean),
    ],
  };
}

export { CORNERS, DEFAULTS, DEFAULT_ALLOW };
