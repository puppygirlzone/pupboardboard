import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedSource, fetchJson, settleAll, safeMessage } from '../server/resilience.js';
import { loadConfig, isConfigured } from '../server/config.js';
import { fakeClock, json, NO_FEEDS_FILE } from './helpers.js';

const source = (load, opts = {}) =>
  createCachedSource({ name: 't', ttlMs: 60_000, isConfigured: () => true, load, retries: 1, retryDelayMs: 0, ...opts });

test('config: missing env leaves every account-based source unconfigured', () => {
  const c = loadConfig({ ...NO_FEEDS_FILE });
  assert.equal(c.port, 8742);
  for (const k of ['steam', 'navidrome', 'jellyfin']) assert.equal(isConfigured[k](c), false, k);
  assert.equal(isConfigured.rss(c), true, 'RSS has default feeds');
});

test('config: trims values, strips trailing slashes, ignores junk numbers', () => {
  const c = loadConfig({ NAVIDROME_URL: ' http://nd:4533/// ', NAVIDROME_USER: 'u', NAVIDROME_PASSWORD: 'p', PORT: 'abc', STEAM_CACHE_SECONDS: '-5' });
  assert.equal(c.navidrome.url, 'http://nd:4533');
  assert.equal(isConfigured.navidrome(c), true);
  assert.equal(c.port, 8742);
  assert.equal(c.steam.ttlMs, 300_000);
});

test('config: demo mode configures all sources', () => {
  const c = loadConfig({ DEMO_MODE: 'true' });
  for (const k of Object.keys(isConfigured)) assert.equal(isConfigured[k](c), true, k);
});

test('unconfigured source never calls load', async () => {
  let called = false;
  const s = source(async () => (called = true), { isConfigured: () => false });
  assert.equal((await s.get()).status, 'unconfigured');
  assert.equal(called, false);
});

test('caches within TTL, refetches after', async () => {
  const now = fakeClock();
  let n = 0;
  const s = source(async () => ({ n: ++n }), { now });
  assert.equal((await s.get()).data.n, 1);
  assert.equal((await s.get()).data.n, 1);
  now.advance(61_000);
  assert.equal((await s.get()).data.n, 2);
});

test('retries once before giving up', async () => {
  let n = 0;
  const s = source(async () => {
    if (++n === 1) throw new Error('flaky');
    return { ok: true };
  });
  const r = await s.get();
  assert.equal(r.status, 'ok');
  assert.equal(n, 2);
});

test('serves stale data when upstream dies, and recovers', async () => {
  const now = fakeClock();
  let fail = false;
  const s = source(
    async () => {
      if (fail) throw new Error('down');
      return { v: now() };
    },
    { now },
  );
  const first = await s.get();
  fail = true;
  now.advance(61_000);
  const stale = await s.get();
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.data, first.data);
  assert.match(stale.error, /down/);
  fail = false;
  now.advance(31_000); // past the back-off window
  const back = await s.get();
  assert.equal(back.status, 'ok');
  assert.equal(back.error, null);
});

test('error with no data ever: status error, never throws', async () => {
  const s = source(async () => {
    throw new Error('nope');
  });
  const r = await s.get();
  assert.equal(r.status, 'error');
  assert.equal(r.data, null);
});

test('backs off after a failure instead of hammering', async () => {
  const now = fakeClock();
  let calls = 0;
  const s = source(
    async () => {
      calls++;
      throw new Error('x');
    },
    { now },
  );
  await s.get();
  await s.get();
  await s.get();
  assert.equal(calls, 2); // first get: 1 try + 1 retry, then cooling down
  now.advance(31_000);
  await s.get();
  assert.equal(calls, 4);
});

test('concurrent gets share one in-flight request', async () => {
  let calls = 0;
  const s = source(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return {};
  });
  await Promise.all([s.get(), s.get(), s.get()]);
  assert.equal(calls, 1);
});

test('partial data (with warnings) is refreshed sooner than the TTL', async () => {
  const now = fakeClock();
  let n = 0;
  const s = source(async () => ({ n: ++n, warnings: ['x failed'] }), { now, ttlMs: 300_000 });
  await s.get();
  now.advance(31_000);
  assert.equal((await s.get()).data.n, 2);
});

test('peek reports loading while the first fetch is in flight', async () => {
  let release;
  const s = source(() => new Promise((r) => (release = r)));
  const pending = s.get();
  assert.equal(s.peek().status, 'loading');
  release({ ok: 1 });
  await pending;
  assert.equal(s.peek().status, 'ok');
});

test('fetchJson: timeout, HTTP error and bad JSON all become clean errors', async () => {
  const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
  // AbortSignal.timeout doesn't keep Node alive on its own; a real server does.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchJson(hang, 'http://a.b/x?key=SECRET', { timeoutMs: 20 }), /a\.b timed out/);
  } finally {
    clearInterval(keepAlive);
  }
  await assert.rejects(fetchJson(async () => new Response('', { status: 503 }), 'http://a.b/'), /HTTP 503/);
  await assert.rejects(fetchJson(async () => new Response('<html>'), 'http://a.b/'), /invalid JSON/);
  await assert.rejects(
    fetchJson(async () => {
      throw new TypeError('fetch failed');
    }, 'http://a.b/?key=SECRET'),
    (err) => !err.message.includes('SECRET'),
  );
  assert.deepEqual(await fetchJson(async () => json({ a: 1 }), 'http://a.b/'), { a: 1 });
});

test('settleAll: partial failure gives warnings, total failure throws, memory fills gaps', async () => {
  const memory = {};
  const ok = await settleAll({ a: async () => 1, b: async () => 2 }, memory);
  assert.deepEqual(ok.values, { a: 1, b: 2 });

  const partial = await settleAll({ a: async () => 3, b: async () => Promise.reject(new Error('b broke')) }, memory);
  assert.deepEqual(partial.values, { a: 3, b: 2 }); // b from memory
  assert.match(partial.warnings[0], /b broke.*older data/);

  await assert.rejects(settleAll({ a: () => Promise.reject(new Error('x')), b: () => Promise.reject(new Error('y')) }));
});

test('safeMessage scrubs credential-looking query params', () => {
  assert.equal(safeMessage(new Error('GET http://x/?key=abc&steamid=1')), 'GET http://x/?key=***&steamid=1');
  assert.ok(!safeMessage(new Error('u=me&t=deadbeef&s=salt')).includes('deadbeef'));
});

test('a version change (e.g. edited feed list) skips the cache', async () => {
  const now = fakeClock();
  let v = 'a';
  let n = 0;
  const s = source(async () => ({ n: ++n }), { now, version: () => v });
  await s.get();
  await s.get();
  assert.equal(n, 1, 'cached while version is unchanged');
  v = 'b';
  assert.equal((await s.get()).data.n, 2, 'refetched right after the change');
});
