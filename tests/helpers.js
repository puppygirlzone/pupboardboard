// Shared test helpers.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** fetch stub: routes is [ [matcher(url) => bool, handler(url, init) => Response] ] */
export function stubFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) {
      if (match(String(url))) return handler(String(url), init);
    }
    return new Response('no route', { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

export const has = (part) => (url) => url.includes(part);

export async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dashboard-test-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A clock you can move forward in tests. */
export function fakeClock(start = Date.parse('2026-11-12T12:00:00Z')) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

export function baseConfig(overrides = {}) {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir: './data',
    demo: false,
    timeoutMs: 200,
    refreshMinutes: 30,
    steam: { apiKey: 'SECRETKEY', steamId: '76561190000000001', ttlMs: 60_000 },
    navidrome: { url: 'http://nd.local', user: 'me', password: 'pw', ttlMs: 60_000 },
    jellyfin: { url: 'http://jf.local', apiKey: 'JFKEY', ttlMs: 60_000 },
    rss: { ttlMs: 60_000, list: () => ({ feeds: [{ name: 'Feed', url: 'http://rss.local/feed' }], from: 'env' }) },
    ...overrides,
  };
}

/** rss config with a fixed feed list, for loader tests. */
export const rssConfig = (feeds, ttlMs = 1000) => ({ ttlMs, list: () => ({ feeds, from: 'env' }) });

/** Env with no feeds file, so a user's own config/feeds.txt can't affect tests. */
export const NO_FEEDS_FILE = { RSS_FEEDS_FILE: '/nonexistent/pupboard-test-feeds.txt' };
