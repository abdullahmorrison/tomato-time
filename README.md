# Tomato Time

Let Twitch chat throw tomatoes at you, live on stream.

A mod (or the broadcaster) types `!tomato`. A countdown appears in the corner, and for
the next 30 seconds anyone who types `TomatoTime` hurls a tomato from the viewer's side
of the screen at the streamer, where it splatters. A busy chat buries the shot. When the
timer runs out, the screen wipes clean.

![Tomatoes splattered across a stream](docs/screenshot.png)

## For the streamer

Add one **Browser Source** in OBS. That's the whole setup.

1. **Sources → + → Browser**
2. Paste your link, set **Width 1920**, **Height 1080**, click OK
3. Drag the layer to the top of your source list

No download, no login, no account to connect, nothing to install.

Get your link from the setup page, or use it directly:

```
https://abdullahmorrison.github.io/tomato-time/overlay.html?channel=YOUR_CHANNEL
```

Only mods and the broadcaster can start a round — regular chatters can't.

`abdullahmorrison` can also start one on any channel without holding a badge (it's in
`DEFAULT_ALLOW` in `src/config.js`). Add more people with `&allow=name1,name2`, which
extends that list rather than replacing it.

## How it works

The page connects straight to Twitch chat over WebSocket using an anonymous `justinfan`
nickname. That needs no OAuth, no token and no bot account, which is what lets the whole
thing be a static site with no backend — free to host and nothing to keep running.

Moderator and broadcaster status arrive as tags on every chat message, so the `!tomato`
gate needs no API call. Note the broadcaster is *not* flagged `mod=1`, so both are
checked; otherwise the streamer couldn't trigger their own overlay. Logins in the
allow-list are matched case-insensitively against the sender's exact login, so a
lookalike name like `someone2` does not get in.

Everything is drawn in two stacked canvases:

- **Splatter layer.** Each splat is stamped once and then left alone, so a screen buried
  in splatter still costs nothing per frame. Cleared by the round-end wipe.
- **Tomato layer.** Cleared and redrawn each frame; airborne tomatoes only.

Tomatoes are pooled and pre-allocated, so a flood never triggers garbage collection
mid-round. The frame loop stops completely when nothing is happening — the source sits
loaded for an entire stream and must cost nothing between rounds.

The art is generated in code: a 16×16 pixel tomato and procedural pixel splats, drawn
upscaled with smoothing off. No image files, no CDN, nothing to fail mid-stream.

### The throw

The tomato travels *away* from the viewer, at the streamer. It enters large and close at
the bottom of the frame and shrinks as it recedes, along an arc, spinning. Depth is
derived from a notional distance closing at a constant rate, which gives the right
perspective falloff for free. Something landing high on screen is further away, so it
arrives smaller and leaves a smaller splat.

## Settings

All settings live in the overlay URL — the setup page writes them for you.

| Param | Default | Meaning |
|---|---|---|
| `channel` | *(required)* | Twitch channel to read |
| `duration` | `30` | Round length in seconds |
| `corner` | `bottom-right` | Timer position (`bottom-left`, `top-right`, `top-left`) |
| `word` | `TomatoTime` | Trigger text, matched case-insensitively as a whole word |
| `command` | `!tomato` | Command that starts a round |
| `maxInFlight` | `120` | Concurrent airborne tomato cap |
| `wipeMs` | `800` | Screen wipe duration at round end |
| `debug` | `off` | Status panel plus keyboard tests |
| `demo` | `off` | Runs a round by itself, to watch the effect without chat |
| `allow` | *(none)* | Extra logins that may start a round without being a mod, comma-separated |

A mod can also start a longer round with `!tomato 60`.

## Development

```
node serve.js       # http://localhost:4747
```

No dependencies and no build step — the files in this repo are the deployed site.

With `debug=on`, the overlay shows live state and binds keys so the whole visual path
can be exercised with no chat and no mod:

| Key | Does |
|---|---|
| `R` | Start a round |
| `T` | Throw one tomato |
| `Y` | Throw 50 at once |

```
http://localhost:4747/overlay.html?channel=tenzinniznet&debug=on
```

To watch it run with no chat and no keypresses — useful for checking it inside OBS —
append `&demo=1` to the overlay URL.

If OBS runs on Windows while this serves from WSL, `localhost` forwards automatically —
no extra setup.

## Notes

Twitch recommends EventSub for new chat bots, but that needs OAuth *and* a server. Anonymous
IRC works today and has no announced end-of-life; if it were ever withdrawn, only
`src/twitch-chat.js` would change, though the replacement would cost the zero-setup
install.

Twitch also rejects identical repeated messages from the same user, so "unlimited" throws
are self-limiting in practice — chatters have to vary their messages to keep firing.
