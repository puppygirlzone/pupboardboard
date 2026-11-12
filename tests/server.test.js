// End-to-end tests against the real HTTP server, with fake (and flaky) upstreams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createFakeFetch, seededRandom } from '../server/demo/fake-upstreams.js';
import { loadConfig } from '../server/config.js';
import { tempDir, baseConfig, stubFetch, NO_FEEDS_FILE } from './helpers.js';

async function start(appOpts) {
  const app = createApp({ retryDelayMs: 0, ...appOpts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, stop: () => new Promise((r) => app.server.close(r)) };
}

/** Everything the browser requests on a page load. */
const PAGE_ASSETS = [
  '/',
  '/css/fonts.css',
  '/fonts/monoid/Monoid-Regular.ttf',
  '/fonts/monoid/Monoid-Retina.ttf',
  '/css/themes.css',
  '/css/styles.css',
  '/js/theme-boot.js',
  '/js/app.js',
  '/js/views.js',
  '/js/format.js',
  '/js/motion.js',
  '/js/themes.js',
  '/js/theme-controls.js',
  '/js/menu.js',
  '/js/puppy.js',
  '/js/puppy-mode.js',
  '/js/backdrop.js',
  '/js/live.js',
  '/vendor/anime.esm.min.js',
  '/favicon.svg',
];

async function loadPageLikeABrowser(base) {
  for (const asset of PAGE_ASSETS) {
    const res = await fetch(base + asset);
    assert.equal(res.status, 200, `${asset} should load`);
    await res.arrayBuffer();
  }
  const res = await fetch(`${base}/api/summary`);
  assert.equal(res.status, 200);
  return res.json();
}

test('dashboard loads 3 times in a row against flaky upstreams without failing', async () => {
  const { dir, cleanup } = await tempDir();
  const config = { ...loadConfig({ DEMO_MODE: '1' }), dataDir: dir, timeoutMs: 150 };
  // 50% of upstream calls fail (HTTP 500, hang until timeout, or bad JSON).
  const fetchImpl = createFakeFetch({ failureRate: 0.5, latencyMs: [0, 20], random: seededRandom(7) });
  const app = await start({ config, fetchImpl, summaryBudgetMs: 2000 });
  try {
    for (let i = 1; i <= 3; i++) {
      const summary = await loadPageLikeABrowser(app.base);
      for (const key of ['steam', 'navidrome', 'jellyfin', 'rss']) {
        const env = summary[key];
        assert.ok(['ok', 'stale', 'error', 'loading'].includes(env.status), `load ${i}: ${key} status ${env.status}`);
        if (env.status === 'ok' || env.status === 'stale') assert.ok(env.data, `${key} has data`);
      }
    }
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('every upstream down: still 200 with error envelopes', async () => {
  const { dir, cleanup } = await tempDir();
  const fetchImpl = async () => {
    throw new TypeError('fetch failed');
  };
  const app = await start({ config: baseConfig({ dataDir: dir }), fetchImpl });
  try {
    const summary = await (await fetch(`${app.base}/api/summary`)).json();
    for (const key of ['steam', 'navidrome', 'jellyfin', 'rss']) assert.equal(summary[key].status, 'error');
    assert.ok(!JSON.stringify(summary).match(/SECRETKEY|JFKEY|"pw"/), 'no secrets leak into responses');
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('nothing configured: zero-setup sources still fill the page', async () => {
  const { dir, cleanup } = await tempDir();
  const config = { ...loadConfig({ ...NO_FEEDS_FILE }), dataDir: dir };
  const app = await start({ config, fetchImpl: stubFetch([]) });
  try {
    const summary = await loadPageLikeABrowser(app.base);
    // Music falls back to ListenBrainz's "how to connect" card; Media to game deals (no setup needed).
    assert.deepEqual(summary.slots, { music: 'listenbrainz', media: 'deals' });
    for (const key of ['steam', 'listenbrainz']) assert.equal(summary[key].status, 'unconfigured');
    assert.notEqual(summary.deals.status, 'unconfigured', 'deals need no setup');
    assert.notEqual(summary.rss.status, 'unconfigured', 'RSS has default feeds');
    assert.ok(!('jellyfin' in summary) && !('navidrome' in summary), 'sources not on screen are not fetched');
    const health = await (await fetch(`${app.base}/api/health`)).json();
    assert.deepEqual(health.sources, { steam: false, navidrome: false, jellyfin: false, rss: true, listenbrainz: false, spotify: false, letterboxd: false, deals: true });
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('a hanging upstream does not hold the summary past its budget', async () => {
  const { dir, cleanup } = await tempDir();
  const config = baseConfig({ dataDir: dir, timeoutMs: 5000 });
  const hang = (_u, { signal } = {}) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason)));
  const app = await start({ config, fetchImpl: hang, summaryBudgetMs: 150 });
  try {
    const t0 = Date.now();
    const summary = await (await fetch(`${app.base}/api/summary`)).json();
    assert.ok(Date.now() - t0 < 2000, 'answered quickly');
    assert.equal(summary.steam.status, 'loading');
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('security headers, path traversal and unknown routes', async () => {
  const { dir, cleanup } = await tempDir();
  const app = await start({ config: baseConfig({ dataDir: dir }), fetchImpl: stubFetch([]) });
  try {
    const home = await fetch(`${app.base}/`);
    assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    for (const bad of ['/..%2fpackage.json', '/%2e%2e/server/config.js', '/nope.html', '/api/nope']) {
      assert.equal((await fetch(app.base + bad)).status, 404, bad);
    }
    assert.equal((await fetch(`${app.base}/api/health`, { method: 'POST' })).status, 405);
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('image proxy: rejects unsafe ids, passes images through, hides upstream errors', async () => {
  const { dir, cleanup } = await tempDir();
  const fetchImpl = stubFetch([
    [(u) => u.includes('getCoverArt') && u.includes('id=good'), () => new Response('PNGDATA', { headers: { 'content-type': 'image/png' } })],
    [(u) => u.includes('getCoverArt'), () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
    [(u) => u.includes('/Images/Primary'), () => new Response('', { status: 500 })],
  ]);
  const app = await start({ config: baseConfig({ dataDir: dir }), fetchImpl });
  try {
    const ok = await fetch(`${app.base}/api/img/navidrome/good?size=99999`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'image/png');
    assert.match(fetchImpl.calls.at(-1).url, /size=800/, 'size is clamped');
    assert.equal((await fetch(`${app.base}/api/img/navidrome/notimage`)).status, 404, 'non-image content refused');
    assert.equal((await fetch(`${app.base}/api/img/jellyfin/abc123`)).status, 404);
    const before = fetchImpl.calls.length;
    assert.equal((await fetch(`${app.base}/api/img/jellyfin/..%2F..%2Fetc`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/img/navidrome/a.b`)).status, 404);
    assert.equal(fetchImpl.calls.length, before, 'unsafe ids never reach upstream');
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('malformed paths get a 400, not a crash', async () => {
  const { dir, cleanup } = await tempDir();
  const app = await start({ config: baseConfig({ dataDir: dir }), fetchImpl: stubFetch([]) });
  try {
    assert.equal((await fetch(`${app.base}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${app.base}/index.html%00.js`)).status, 404);
    assert.equal((await fetch(`${app.base}/`)).status, 200, 'still serving afterwards');
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('image proxy: sandboxes images and refuses oversized ones', async () => {
  const { dir, cleanup } = await tempDir();
  const big = 'x'.repeat(10_000_001);
  const fetchImpl = stubFetch([
    [(u) => u.includes('id=huge'), () => new Response(big, { headers: { 'content-type': 'image/png' } })],
    [(u) => u.includes('id=liar'), () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': '99999999' } })],
    [(u) => u.includes('getCoverArt'), () => new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', { headers: { 'content-type': 'image/svg+xml' } })],
  ]);
  const app = await start({ config: baseConfig({ dataDir: dir }), fetchImpl });
  try {
    const svg = await fetch(`${app.base}/api/img/navidrome/svg1`);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get('content-security-policy'), /default-src 'none'.*sandbox/);
    assert.equal((await fetch(`${app.base}/api/img/navidrome/huge`)).status, 404);
    assert.equal((await fetch(`${app.base}/api/img/navidrome/liar`)).status, 404);
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('demo art exists only in demo mode', async () => {
  const { dir, cleanup } = await tempDir();
  const off = await start({ config: baseConfig({ dataDir: dir }), fetchImpl: stubFetch([]) });
  const on = await start({ config: { ...loadConfig({ DEMO_MODE: '1' }), dataDir: dir }, fetchImpl: createFakeFetch({ failureRate: 0 }) });
  try {
    assert.equal((await fetch(`${off.base}/api/demo-art/game-1`)).status, 404);
    const res = await fetch(`${on.base}/api/demo-art/game-1?w=9999&h=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/svg+xml');
    assert.match(await res.text(), /width="800" height="16"/, 'size is clamped');
    assert.equal((await fetch(`${on.base}/api/demo-art/a.b`)).status, 404);
  } finally {
    await off.stop();
    await on.stop();
    await cleanup();
  }
});
