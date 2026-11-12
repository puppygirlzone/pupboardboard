// Browser entry point: fetching, routing, refresh loop, clock.

import { ROUTES, resolveRoute, SOURCES } from './views.js';
import { greeting, timeAgo, formatClock, formatLongDate } from './format.js';
import { preload, enter, refresh, pulse, leave, moveNavIndicator, initHoverEffects } from './motion.js';
import { initThemeControls } from './theme-controls.js';
import { initPuppyMode, isPuppy } from './puppy-mode.js';
import { startBackdrop } from './backdrop.js';
import { mergeNowPlaying, fetchNowPlaying } from './live.js';
import { puppyGreeting, syncVerb } from './puppy.js';

const REFRESH_MS = 60_000;
const LOADING_RETRY_MS = 4_000;
const STORE_KEY = 'pupboard:last-summary';
const KEYS = Object.keys(SOURCES);

const $ = (sel) => document.querySelector(sel);
const view = $('#view');
const syncDot = $('#sync-dot');
const syncText = $('#sync-text');

let summary = null;
let lastPayload = '';
let lastSuccess = null;
let serverOffline = false;
let refreshTimer = null;
// Clock settings from the server (TIME_ZONE / CLOCK_FORMAT in .env).
let display = { timeZone: null, hour12: false };

/** Load clock settings; quick timeout, defaults on any failure. */
async function loadDisplay() {
  try {
    const res = await fetch('/api/display', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    const d = await res.json();
    display = { timeZone: typeof d.timeZone === 'string' ? d.timeZone : null, hour12: d.hour12 === true };
    formatClock(new Date(), display); // throws if this browser doesn't know the zone
  } catch {
    display = { timeZone: null, hour12: display.hour12 };
  }
}

/* ------------------------------------------------------------ storage */

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function save(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* private mode or storage full: fine */
  }
}

/* ------------------------------------------------------------ data */

async function fetchSummary() {
  const res = await fetch('/api/summary', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || typeof json !== 'object') throw new Error('Bad response');
  return json;
}

/** Used when the dashboard server itself can't be reached. */
function offlineCopy(saved) {
  const copy = { ...saved };
  for (const k of KEYS) {
    const env = saved?.[k];
    copy[k] = env?.data ? { ...env, status: 'offline' } : { source: k, status: 'error', data: null, error: 'Dashboard server unreachable' };
  }
  return copy;
}

async function load({ animate }) {
  clearTimeout(refreshTimer);
  // Ask Navidrome for the current song at the same time (never cached).
  const live = fetchNowPlaying(2500);
  let next;
  try {
    next = mergeNowPlaying(await fetchSummary(), await live);
    serverOffline = false;
    lastSuccess = Date.now();
    // Remember the good parts for when the server is down.
    const saved = readSaved() ?? {};
    for (const k of KEYS) if (next[k]?.data) saved[k] = next[k];
    save(saved);
  } catch (err) {
    console.warn('[dashboard] could not reach server', err);
    serverOffline = true;
    next = summary && !Object.values(summary).some((v) => v?.status === 'offline') ? offlineCopy(summary) : offlineCopy(readSaved() ?? {});
  }

  const payload = JSON.stringify(next);
  const changed = payload !== lastPayload;
  summary = next;
  lastPayload = payload;
  if (animate) render(true);
  else if (changed) render(false);
  updateSync(true);

  const stillLoading = KEYS.some((k) => summary?.[k]?.status === 'loading');
  refreshTimer = setTimeout(() => load({ animate: false }), stillLoading || serverOffline ? LOADING_RETRY_MS * (serverOffline ? 3 : 1) : REFRESH_MS);
}

/* ------------------------------------------------------------ rendering */

function render(withEntrance) {
  const name = resolveRoute(location.hash);
  const route = ROUTES[name];
  try {
    view.innerHTML = route.render(summary, Date.now());
  } catch (err) {
    console.error('[dashboard] render failed', err);
    view.innerHTML = '<div class="empty"><p><strong>Something went wrong drawing this page.</strong></p><p class="muted">The next refresh will try again.</p></div>';
  }
  wireImages(view);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', resolveRoute(a.getAttribute('href')) === name));
  moveNavIndicator(document.querySelector('.nav'));
  document.title = name ? `${SOURCES[route.key].title} · pupboard` : 'pupboard';
  if (withEntrance) enter(view);
  else refresh(view);
}

/** Swap broken images for a neutral placeholder. */
function wireImages(root) {
  root.querySelectorAll('img[data-fallback]').forEach((img) => {
    const swap = () => {
      const ph = document.createElement('div');
      ph.className = `${img.className} img-missing`;
      ph.setAttribute('role', 'img');
      ph.setAttribute('aria-label', img.alt);
      img.replaceWith(ph);
    };
    if (img.complete && img.naturalWidth === 0 && img.src) swap();
    else img.addEventListener('error', swap, { once: true });
  });
}

function updateSync(tick = false) {
  if (serverOffline) {
    syncDot.className = 'sync-dot offline';
    syncText.textContent = lastSuccess ? `Server offline · last update ${timeAgo(new Date(lastSuccess).toISOString())}` : 'Server offline · retrying';
  } else {
    syncDot.className = 'sync-dot';
    syncText.textContent = `${syncVerb(isPuppy())} ${timeAgo(new Date(lastSuccess).toISOString())}`;
    if (tick) pulse(syncDot);
  }
}

/* ------------------------------------------------------------ clock */

function tickClock() {
  const now = new Date();
  $('#clock').textContent = formatClock(now, display);
  $('#date').textContent = formatLongDate(now, display);
  $('#greeting').textContent = isPuppy() ? puppyGreeting(now, display.timeZone) : greeting(now, display.timeZone);
}

/* ------------------------------------------------------------ boot */

// Page switch: quick fade-out, then the new page's entrance. A newer click
// cancels an older one that is still fading out.
let navigation = 0;
window.addEventListener('hashchange', async () => {
  const id = ++navigation;
  // Fetch the current song while the old page fades out.
  const [live] = await Promise.all([fetchNowPlaying(800), leave(view)]);
  if (id !== navigation) return;
  if (!serverOffline && summary) {
    summary = mergeNowPlaying(summary, live);
    lastPayload = JSON.stringify(summary);
  }
  render(true);
  window.scrollTo({ top: 0 });
});

window.addEventListener('resize', () => moveNavIndicator(document.querySelector('.nav'), { instant: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lastSuccess && Date.now() - lastSuccess > 30_000) load({ animate: false });
});

window.addEventListener('error', (e) => console.error('[dashboard] uncaught', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[dashboard] unhandled', e.reason));

async function boot() {
  await loadDisplay();
  try {
    initThemeControls();
  } catch (err) {
    console.warn('[dashboard] theme controls unavailable', err);
  }
  try {
    startBackdrop(document.querySelector('.dot-grid'));
  } catch (err) {
    console.warn('[dashboard] background unavailable', err);
  }
  try {
    initPuppyMode({
      onChange: () => {
        tickClock();
        if (lastSuccess) updateSync();
      },
    });
  } catch (err) {
    console.warn('[dashboard] puppy mode unavailable', err);
  }
  tickClock();
  setInterval(tickClock, 1_000);
  initHoverEffects();
  // Link widths change once Monoid loads; re-measure the nav highlight then.
  document.fonts?.ready.then(() => moveNavIndicator(document.querySelector('.nav'), { instant: true }));
  setInterval(() => lastSuccess && updateSync(), 15_000);
  await preload();
  render(true); // loading skeleton
  await load({ animate: true });
}

boot();
