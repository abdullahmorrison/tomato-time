// Minimal browser stubs so the overlay modules can run under `node --test`.
//
// Real timers and a real clock are used throughout rather than a fake scheduler:
// replacing global setTimeout would also replace the one the test runner itself
// depends on. Rounds in tests are therefore short and waits are poll-based.

const ctxStub = () => ({
  imageSmoothingEnabled: false,
  fillStyle: '',
  clearRect() {}, fillRect() {}, save() {}, restore() {},
  translate() {}, rotate() {}, scale() {}, drawImage() {},
});

export function makeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: ctxStub };
}

export function makeTimerEl() {
  const el = {
    classes: new Set(),
    dataset: {},
    value: { textContent: '' },
  };
  el.classList = {
    add: (...c) => c.forEach((x) => el.classes.add(x)),
    remove: (...c) => c.forEach((x) => el.classes.delete(x)),
    toggle: (c, on) => (on ? el.classes.add(c) : el.classes.delete(c)),
  };
  el.querySelector = () => el.value;
  return el;
}

/** Install the globals the modules reach for. Safe to call once per test file. */
export function installBrowser({ width = 1280, height = 720 } = {}) {
  globalThis.document = { createElement: () => makeCanvas() };
  globalThis.window = {
    innerWidth: width,
    innerHeight: height,
    addEventListener() {},
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until `predicate` holds, or fail after `timeout`. */
export async function waitFor(predicate, { timeout = 4000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(16);
  }
  throw new Error(`timed out waiting for ${label}`);
}
