// HTTP app: JSON API, image proxy, and static frontend. No framework needed.

import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isConfigured, loadConfig, resolveSlots } from './config.js';
import { readSettings, writeSettings, mergeSettings, describeSettings, applyChanges, MAX_FEEDS_TEXT } from './settings.js';
import { createCachedSource, hostOf, safeMessage, readCapped } from './resilience.js';
import { createSteamLoader } from './sources/steam.js';
import { createSteamHistory } from './sources/steam-history.js';
import { createNavidromeLoader, createNowPlayingFetcher, navidromeCoverUrl } from './sources/navidrome.js';
import { createJellyfinLoader, jellyfinImageUrl, jellyfinHeaders } from './sources/jellyfin.js';
import { createRssLoader } from './sources/rss.js';
import { createListenBrainzLoader } from './sources/listenbrainz.js';
import { createSpotifyAuth, createSpotifyLoader } from './sources/spotify.js';
import { createDealsLoader } from './sources/deals.js';
import { createLetterboxdLoader } from './sources/letterboxd.js';
import { demoArtSvg } from './demo/fake-upstreams.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const VENDOR = {
  '/vendor/anime.esm.min.js': path.join(ROOT, 'node_modules/animejs/dist/bundles/anime.esm.min.js'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
// Upstream ids are alphanumeric with - and _ ; anything else is rejected
// so the proxy can't be pointed at arbitrary paths.
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
// Proxied images: refuse anything huge, and lock down SVGs (no scripts, no
// loading other resources) in case an upstream ever serves a hostile one.
const MAX_IMAGE_BYTES = 10_000_000;
const IMAGE_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_SETUP_BODY = 64_000;

/**
 * Who may use the setup API: only a browser on the same computer (checked by
 * socket address AND Host header, which stops DNS-rebinding tricks), and only
 * with the code printed when pupboard starts (which stops anything reaching it
 * through a reverse proxy on the same machine). Returns null if allowed, else
 * a reason the page can explain.
 */
/** True when the Host header names this computer (localhost, 127.0.0.1, [::1]). */
export function loopbackHostHeader(req) {
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${req.headers.host ?? ''}`).hostname);
  } catch {
    return false;
  }
}
const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1', 'localhost']);

export function setupRefusal(req, { config, setup }) {
  if (!setup || !config.setupEnabled) return 'disabled';
  if (config.demo) return 'demo';
  if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress)) return 'not-local';
  let host;
  try {
    host = new URL(`http://${req.headers.host ?? ''}`).hostname;
  } catch {
    return 'not-local';
  }
  if (!LOOPBACK_HOSTS.has(host)) return 'not-local';
  const given = Buffer.from(String(req.headers['x-setup-code'] ?? ''));
  const want = Buffer.from(setup.code);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return 'code';
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Past the limit, keep draining (and discarding) so the client gets a
    // clean 413 instead of a reset connection.
    req.on('data', (c) => {
      size += c.length;
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => (size > limit ? reject(Object.assign(new Error('too large'), { status: 413 })) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

/**
 * setup (optional): { code, env, file } enables the /setup page's API.
 *   code: secret printed at startup; env: the real environment; file: settings.json path.
 */
const activeNames = (slots) => [...new Set(['steam', slots.music, slots.media, 'rss'])];

export function createApp({ config, fetchImpl = globalThis.fetch, now = Date.now, retryDelayMs = 300, summaryBudgetMs = 4000, setup = null }) {
  // Callers (tests, older configs) may leave out the newer sections: fill in defaults.
  const defaults = loadConfig({ RSS_FEEDS: 'off' });
  for (const key of ['listenbrainz', 'spotify', 'letterboxd', 'deals', 'slots']) config[key] ??= defaults[key];
  const history = createSteamHistory({ dataDir: config.dataDir, fileName: config.demo ? 'steam-history.demo.json' : 'steam-history.json' });
  const common = { config, fetchImpl, now };
  // Lives across rebuilds so a sign-in in progress survives a settings save.
  const spotifyAuth = createSpotifyAuth({ config, fetchImpl, now, file: path.join(config.dataDir, 'spotify.json'), demo: config.demo });
  let sources;
  let nowPlaying;
  let lb;
  let letterboxd;
  const cached = (name, load, extra = {}) =>
    createCachedSource({ name, ttlMs: config[name].ttlMs, isConfigured: () => isConfigured[name](config), load, now, retryDelayMs, ...extra });
  // Built again when the setup page saves new settings.
  const build = () => {
    config.spotify.isConnected = spotifyAuth.isConnected;
    sources = {
      steam: createCachedSource({
        name: 'steam',
        ttlMs: config.steam.ttlMs,
        isConfigured: () => isConfigured.steam(config),
        load: createSteamLoader({ ...common, history }),
        now,
        retryDelayMs,
      }),
      navidrome: createCachedSource({
        name: 'navidrome',
        ttlMs: config.navidrome.ttlMs,
        isConfigured: () => isConfigured.navidrome(config),
        load: createNavidromeLoader(common),
        now,
        retryDelayMs,
      }),
      jellyfin: createCachedSource({
        name: 'jellyfin',
        ttlMs: config.jellyfin.ttlMs,
        isConfigured: () => isConfigured.jellyfin(config),
        load: createJellyfinLoader(common),
        now,
        retryDelayMs,
      }),
      rss: createCachedSource({
        name: 'rss',
        ttlMs: config.rss.ttlMs,
        isConfigured: () => isConfigured.rss(config),
        load: createRssLoader(common),
        version: () => config.rss.list().feeds.map((f) => `${f.name}|${f.url}`).join('\n'),
        now,
        retryDelayMs,
      }),
      listenbrainz: cached('listenbrainz', (...a) => lb(...a)),
      spotify: cached('spotify', createSpotifyLoader({ ...common, auth: spotifyAuth })),
      letterboxd: cached('letterboxd', (...a) => letterboxd(...a)),
      deals: cached('deals', createDealsLoader(common)),
    };
    // Username-based loaders read the name when created, so only make them when set.
    const lbLoad = config.listenbrainz.user ? createListenBrainzLoader(common) : null;
    const lboxdLoad = config.letterboxd.user ? createLetterboxdLoader(common) : null;
    lb = () => lbLoad();
    letterboxd = () => lboxdLoad();
    nowPlaying = createNowPlayingFetcher({ config, fetchImpl });
  };
  build();

  const send = (res, status, body, headers = {}) => {
    if (res.headersSent) return;
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  };
  const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

  async function proxyImage(res, upstreamUrl, headers) {
    try {
      const upstream = await fetchImpl(upstreamUrl, { headers, signal: AbortSignal.timeout(config.timeoutMs) });
      const type = upstream.headers.get('content-type') ?? '';
      if (!upstream.ok || !type.startsWith('image/')) return send(res, 404, 'image unavailable');
      const buf = await readCapped(upstream, MAX_IMAGE_BYTES, hostOf(upstreamUrl)); // throws past the cap: 404 below
      send(res, 200, buf, { 'content-type': type, 'cache-control': 'public, max-age=86400', 'content-security-policy': IMAGE_CSP });
    } catch (err) {
      console.warn(`[image] ${hostOf(upstreamUrl)}: ${err?.name ?? 'error'}`);
      send(res, 404, 'image unavailable');
    }
  }

  async function serveFile(res, filePath, cache = 'no-cache') {
    try {
      const body = await readFile(filePath);
      send(res, 200, body, { 'content-type': TYPES[path.extname(filePath)] ?? 'application/octet-stream', 'cache-control': cache });
    } catch {
      send(res, 404, 'not found', { 'content-type': 'text/plain' });
    }
  }

  async function readFeedsText() {
    try {
      return await readFile(config.rss.file, 'utf8');
    } catch {
      return null;
    }
  }

  const portOf = (req) => {
    try {
      return new URL(`http://${req.headers.host}`).port || '80';
    } catch {
      return String(config.port);
    }
  };
  // Spotify only allows http redirects to 127.0.0.1 (never "localhost").
  const spotifyRedirect = (req) => `http://127.0.0.1:${portOf(req)}/api/spotify/callback`;

  /** Shared checks for POSTs from the setup page. Returns the parsed body, or null after answering. */
  async function setupPostBody(req, res) {
    const refused = setupRefusal(req, { config, setup });
    if (refused) return sendJson(res, 403, { error: refused }), null;
    if (req.method !== 'POST') return send(res, 405, 'method not allowed'), null;
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, 415, { error: 'expected JSON' }), null;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return sendJson(res, 403, { error: 'not-local' }), null;
    let parsed;
    try {
      parsed = JSON.parse((await readBody(req, MAX_SETUP_BODY)) || '{}');
    } catch (err) {
      return sendJson(res, err.status ?? 400, { error: err.status === 413 ? 'too large' : 'invalid JSON' }), null;
    }
    // Only a JSON object is a valid request (0, false, "" or [] would otherwise look like "already answered").
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return sendJson(res, 400, { error: 'expected a JSON object' }), null;
    return parsed;
  }

  async function handleSpotify(req, res, p, url) {
    if (p === '/api/spotify/callback') {
      // Spotify sends the browser here; the one-time state proves it started from our setup page.
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress)) return send(res, 403, 'forbidden', { 'content-type': 'text/plain' });
      const state = url.searchParams.get('state');
      const back = spotifyAuth.returnFor(state);
      const goBack = (result) => send(res, 302, '', { location: `${back}?spotify=${result}`, 'cache-control': 'no-store' });
      if (!back) return send(res, 400, 'This sign-in link expired or was already used. Go back to the pupboard Settings page and press "Connect Spotify" again.', { 'content-type': 'text/plain; charset=utf-8' });
      if (url.searchParams.get('error')) {
        spotifyAuth.cancelLogin(state);
        return goBack('denied');
      }
      try {
        await spotifyAuth.finishLogin({ state, code: url.searchParams.get('code') });
        console.log('[spotify] connected');
        warm().catch(() => {});
        return goBack('connected');
      } catch (err) {
        console.warn(`[spotify] sign-in failed: ${safeMessage(err)}`);
        return goBack('error');
      }
    }
    const body = await setupPostBody(req, res);
    if (!body) return;
    if (p === '/api/spotify/login') {
      try {
        const authorizeUrl = spotifyAuth.startLogin({ redirectUri: spotifyRedirect(req), returnTo: `http://${req.headers.host}/setup.html` });
        return sendJson(res, 200, { url: authorizeUrl });
      } catch (err) {
        return sendJson(res, 400, { error: safeMessage(err) });
      }
    }
    if (p === '/api/spotify/disconnect') {
      await spotifyAuth.disconnect().catch(() => {});
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: 'not found' });
  }

  async function handleSetup(req, res) {
    if (req.method === 'GET') {
      const refused = setupRefusal(req, { config, setup });
      if (refused) return sendJson(res, 403, { error: refused });
      const saved = readSettings(setup.file);
      const feedsText = await readFeedsText();
      // No feeds file yet: show the list in use (defaults or RSS_FEEDS) so it can be edited.
      const current = config.rss.list().feeds.map((f) => (f.name ? `${f.name} | ${f.url}` : f.url)).join('\n');
      return sendJson(res, 200, {
        fields: describeSettings(setup.env, saved),
        feeds: { text: feedsText ?? current, exists: feedsText !== null },
        host: config.host,
        spotify: { connected: spotifyAuth.isConnected(), connectedAt: spotifyAuth.connectedAt(), redirectUri: spotifyRedirect(req) },
        slots: resolveSlots(config),
      });
    }
    const body = await setupPostBody(req, res);
    if (!body) return;
    const { settings, errors } = applyChanges(readSettings(setup.file), body, setup.env);
    const feeds = body?.feeds;
    if (feeds !== undefined && (typeof feeds !== 'string' || feeds.length > MAX_FEEDS_TEXT)) errors.push({ key: 'feeds', message: 'The feed list is too long' });
    if (errors.length) return sendJson(res, 400, { errors });
    try {
      await writeSettings(setup.file, settings);
      if (typeof feeds === 'string') {
        await mkdir(path.dirname(config.rss.file), { recursive: true });
        await writeFile(config.rss.file, feeds.endsWith('\n') || !feeds ? feeds : `${feeds}\n`);
      }
    } catch (err) {
      console.warn(`[setup] could not save: ${err.code ?? err.message}`);
      return sendJson(res, 500, { errors: [{ key: null, message: `Couldn't save the settings (${err.code ?? 'write failed'}). Is the folder read-only?` }] });
    }
    // Apply straight away (except the listening address, which needs a restart).
    const next = loadConfig(mergeSettings(setup.env, settings));
    Object.assign(config, { ...next, port: config.port, host: config.host, dataDir: config.dataDir, demo: config.demo, setupEnabled: config.setupEnabled });
    build();
    warm().catch(() => {});
    console.log('[setup] settings saved and applied');
    return sendJson(res, 200, { ok: true, restartNeeded: (next.host !== config.host) });
  }

  async function handle(req, res) {
    // Only listening on this computer (the download's default)? Then only answer
    // requests addressed to this computer: stops a web page using DNS rebinding
    // to read your stats through the browser.
    if (LOOPBACK_BINDS.has(config.host) && !loopbackHostHeader(req)) return send(res, 403, 'forbidden', { 'content-type': 'text/plain' });
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p === '/api/setup') return handleSetup(req, res);
    if (p.startsWith('/api/spotify/')) return handleSpotify(req, res, p, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    if (p === '/api/display') {
      return sendJson(res, 200, { timeZone: config.display?.timeZone ?? null, hour12: Boolean(config.display?.hour12) });
    }
    if (p === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        demo: config.demo,
        sources: Object.fromEntries(Object.keys(sources).map((k) => [k, isConfigured[k](config)])),
      });
    }
    if (p === '/api/summary') {
      // Don't let one slow upstream hold up the whole page: after the budget,
      // answer with whatever that source has (the fetch keeps going).
      const withBudget = (src) => {
        let timer;
        const fallback = new Promise((resolve) => {
          timer = setTimeout(() => resolve(src.peek()), summaryBudgetMs);
        });
        return Promise.race([src.get(), fallback]).finally(() => clearTimeout(timer));
      };
      // Only the sources on screen: the chosen Music and Media ones, plus Gaming and News.
      const slots = resolveSlots(config);
      const names = activeNames(slots);
      const envelopes = await Promise.all(names.map((n) => withBudget(sources[n])));
      return sendJson(res, 200, { generatedAt: new Date(now()).toISOString(), demo: config.demo, slots, ...Object.fromEntries(names.map((n, i) => [n, envelopes[i]])) });
    }
    // Live now-playing (no cache). Always 200; the page keeps what it has
    // if this fails.
    if (p === '/api/navidrome/now-playing') {
      if (!isConfigured.navidrome(config)) return sendJson(res, 200, { status: 'unconfigured', nowPlaying: null });
      try {
        const list = await nowPlaying();
        return sendJson(res, 200, { status: 'ok', nowPlaying: list, fetchedAt: new Date(now()).toISOString() });
      } catch (err) {
        return sendJson(res, 200, { status: 'error', nowPlaying: null, error: safeMessage(err) });
      }
    }
    const sourceMatch = p.match(/^\/api\/([a-z]+)$/);
    if (sourceMatch && Object.hasOwn(sources, sourceMatch[1])) return sendJson(res, 200, await sources[sourceMatch[1]].get());

    const img = p.match(/^\/api\/img\/(navidrome|jellyfin)\/([^/]+)$/);
    if (img) {
      const [, which, id] = img;
      if (!SAFE_ID.test(id) || !isConfigured[which](config)) return send(res, 404, 'not found');
      const size = Math.min(Math.max(Number(url.searchParams.get('size')) || 300, 32), 800);
      return which === 'navidrome'
        ? proxyImage(res, navidromeCoverUrl(config, id, size))
        : proxyImage(res, jellyfinImageUrl(config, id, size), jellyfinHeaders(config.jellyfin.apiKey));
    }
    // Demo mode only: placeholder art for the invented games.
    const art = config.demo && p.match(/^\/api\/demo-art\/([^/]+)$/);
    if (art && SAFE_ID.test(art[1])) {
      const dim = (name, fallback) => Math.min(Math.max(Number(url.searchParams.get(name)) || fallback, 16), 800);
      return send(res, 200, demoArtSvg(art[1], { width: dim('w', 300), height: dim('h', 300) }), { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400', 'content-security-policy': IMAGE_CSP });
    }
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

    if (VENDOR[p]) return serveFile(res, VENDOR[p], 'public, max-age=604800');

    // Static files. Resolve and confirm the result stays inside public/.
    let rel;
    try {
      rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    } catch {
      return send(res, 400, 'bad request', { 'content-type': 'text/plain' }); // malformed %-escape
    }
    if (rel.includes('\0')) return send(res, 404, 'not found');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'not found');
    // Fonts never change in place, so browsers can keep them for a month.
    return serveFile(res, filePath, rel.startsWith('fonts/') ? 'public, max-age=2592000, immutable' : 'no-cache');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[http] unexpected error', err);
      sendJson(res, 500, { error: 'internal error' });
    });
  });

  /** Refresh the sources on screen (keeps caches warm and Steam history ticking). */
  const warm = () => Promise.all(activeNames(resolveSlots(config)).map((n) => sources[n].get()));

  return {
    server,
    get sources() {
      return sources;
    },
    warm,
  };
}
