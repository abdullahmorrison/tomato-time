// Every setting lives in the overlay URL, so the streamer never edits a file and you
// can retune by changing the Browser Source URL.

const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

// Round length bounds. A duration can arrive from the URL, from chat as `!tomato 60`,
// or from the setup page, and all three must agree on what is in range.
const MIN_DURATION = 5;
const MAX_DURATION = 600;

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
  cancel: '!wipe',
  // No ceiling: if chat floods, all of it lands on screen.
  maxInFlight: Infinity,
  wipeMs: 800,
  debug: false,
  demo: false,
  allow: DEFAULT_ALLOW,
};

/**
 * Concurrent tomato cap. Unlimited unless a number is given, so it exists only as an
 * escape hatch for a machine that cannot keep up.
 */
function parseCap(value) {
  if (value === null || value === '') return Infinity;
  if (/^(0|none|off|unlimited)$/i.test(value.trim())) return Infinity;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return Infinity;
  return Math.max(1, n);
}

function int(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** A round length from any source, clamped to the one range they all share. */
export function clampDuration(value, fallback = DEFAULTS.duration) {
  return int(value, fallback, MIN_DURATION, MAX_DURATION);
}

export function readConfig(search = window.location.search) {
  const q = new URLSearchParams(search);
  const corner = (q.get('corner') || '').toLowerCase();

  return {
    ...DEFAULTS,
    channel: (q.get('channel') || '').trim().replace(/^#/, '').toLowerCase(),
    duration: clampDuration(q.get('duration')),
    corner: CORNERS.includes(corner) ? corner : DEFAULTS.corner,
    word: (q.get('word') || DEFAULTS.word).trim(),
    command: (q.get('command') || DEFAULTS.command).trim().toLowerCase(),
    cancel: (q.get('cancel') || DEFAULTS.cancel).trim().toLowerCase(),
    maxInFlight: parseCap(q.get('maxInFlight')),
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

export { CORNERS, DEFAULTS, DEFAULT_ALLOW, MIN_DURATION, MAX_DURATION };
