# tomatod

A Twitch chat overlay for OBS: chat throws tomatoes at the streamer. Static site, no
backend, no build step, no dependencies — the files in this repo *are* the deployed
site, served by GitHub Pages from `main`. A push goes live; a loaded browser source
keeps its old copy until it is refreshed, and each `src/*.js` module is cached
separately, so HTML and JS can drift out of step after an update.

## Commands

```
node serve.js   # http://localhost:4747
npm test        # node --test, no dependencies, no config
```

## Tests: keep them narrow

Two files, both deliberately cheap:

- `test/chat.test.mjs` — command parsing, permissions, trigger counting
- `test/config.test.mjs` — URL settings, clamps, normalization

**Do not add tests that stub the browser.** A suite covering the renderer, the round
state machine and the WebSocket reconnect existed and was deleted. It needed stub
canvases, a fake clock and polling helpers, it never caught a bug, and every failure
this project has actually hit in production was invisible to it.

Real failures here are OBS and CEF problems: frame loops stalling, sources suspended
mid-round, compositing cost during the wipe, cached modules drifting. No unit test
sees any of that. Use `debug=on` and the real app for the visual and runtime layers.

What the remaining tests are for is the opposite case — logic regressions that raise
no error and just quietly do the wrong thing on stream. `!tomato stop` once parsed as
a *start* whose duration failed to parse, so asking to stop began a fresh round
(fixed in `c58064a`). Both halves of that are pinned now, along with the permission
checks and the fact that a duration means the same thing from chat as from the URL.

The rule: add a test when the failure would be silent and user-facing. Otherwise don't.

## Settings live in the URL

Every setting is a query param on the browser-source URL, parsed in `src/config.js`,
so the streamer never edits a file. `normalizeChannel` and `clampDuration` are shared
on purpose — the same value arrives from the URL, from chat, and from the setup page,
and if those ever disagree a link points at a channel nobody is talking in, with no
error anywhere. Twitch accepts a JOIN to a channel that does not exist.
