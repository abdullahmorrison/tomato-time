import { readConfig } from './config.js';
import { TwitchChat, countTriggers, parseControl } from './twitch-chat.js';
import { TomatoShow } from './round.js';
import { tomatoSprite } from './sprite.js';

const config = readConfig();

const show = new TomatoShow({
  frontCanvas: document.getElementById('front'),
  splatCanvas: document.getElementById('splat'),
  timerEl: document.getElementById('timer'),
  config,
});

// The badge shows the same pixel tomato that gets thrown.
const icon = document.getElementById('timerIcon');
icon.getContext('2d').drawImage(tomatoSprite(), 0, 0);

// --- status toast ---------------------------------------------------------
// Visible only for the first few seconds so setup can be confirmed, then gone for
// good. It must never appear on stream once things are running.

const statusEl = document.getElementById('status');
let statusLocked = false;
let messagesSeen = 0;

function setStatus(text, sticky = false) {
  if (statusLocked && !sticky) return;
  statusEl.hidden = false;
  statusEl.textContent = text;
}

if (!config.channel) {
  setStatus('No channel set. Add ?channel=yourname to the URL.', true);
  statusLocked = true;
} else {
  setStatus(`Connecting to #${config.channel}…`);
  setTimeout(() => {
    if (statusLocked) return;
    statusLocked = true;
    statusEl.style.opacity = '0';
    setTimeout(() => { statusEl.hidden = true; }, 600);
  }, 10000);
}

// --- chat -----------------------------------------------------------------

if (config.channel) {
  const chat = new TwitchChat(config.channel);

  chat.addEventListener('status', (e) => {
    if (e.detail === 'connected') {
      setStatus(`Connected to #${config.channel}. Waiting for chat…`);
    } else if (e.detail === 'reconnecting') {
      setStatus('Reconnecting…');
    }
  });

  chat.addEventListener('chat', (e) => {
    const message = e.detail;
    messagesSeen++;
    if (messagesSeen === 1) {
      setStatus(`Ready — reading #${config.channel}. Type ${config.command} to start.`);
    }

    const control = parseControl(message, config);
    if (control) {
      if (control.kind === 'cancel') show.cancel();
      else if (control.kind === 'extend') show.extend(control.seconds);
      else show.start(control.seconds);
      return;
    }

    // One tomato per trigger in the message, so saying it three times throws three,
    // up to maxPerMessage.
    if (show.active) {
      let n = countTriggers(message.text, config.word, config.maxPerMessage);
      for (; n > 0; n--) show.throwOne();
    }
  });

  chat.connect();
}

// --- demo -----------------------------------------------------------------
// Runs a round with a steady stream of throws, so the effect can be checked in OBS
// without waiting for chat.

if (config.demo) {
  show.start(config.duration);
  setInterval(() => show.throwOne(), 90);
}

// --- debug ----------------------------------------------------------------
// Lets the whole visual path be exercised without a mod, a round, or even a chat.

if (config.debug) {
  const panel = document.createElement('div');
  panel.className = 'status';
  panel.style.top = 'auto';
  panel.style.bottom = '20px';
  panel.style.left = '20px';
  document.body.appendChild(panel);

  const refresh = () => {
    const cap = Number.isFinite(config.maxInFlight) ? config.maxInFlight : '∞';
    panel.textContent =
      `state: ${show.state} · in flight: ${show.pool.liveCount}/${cap}` +
      ` · pooled: ${show.pool.created} · chat msgs: ${messagesSeen}` +
      ' · [R] round  [E] +15s  [T] throw  [Y] throw 50  [C] cancel';
  };
  refresh();
  setInterval(refresh, 200);

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'r') show.start(config.duration);
    if (key === 'e') show.extend(15);
    if (key === 't') show.throwOne();
    if (key === 'y') for (let i = 0; i < 50; i++) show.throwOne();
    if (key === 'c') show.cancel();
  });
}
