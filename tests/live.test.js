// Live now-playing: fetched on every page load, merged before drawing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeNowPlaying, fetchNowPlaying } from '../public/js/live.js';
import { createApp } from '../server/app.js';
import { tempDir, baseConfig, stubFetch, has, json } from './helpers.js';

const summary = { navidrome: { status: 'ok', data: { nowPlaying: [{ title: 'Old song' }], stats: { tracksThisWeek: 3 } } }, steam: { status: 'ok' } };

test('merge swaps in the live song and keeps everything else', () => {
  const merged = mergeNowPlaying(summary, { status: 'ok', nowPlaying: [{ title: 'New song' }] });
  assert.equal(merged.navidrome.data.nowPlaying[0].title, 'New song');
  assert.equal(merged.navidrome.data.stats.tracksThisWeek, 3);
  assert.equal(merged.steam, summary.steam);
  assert.equal(summary.navidrome.data.nowPlaying[0].title, 'Old song', 'original not mutated');
  assert.deepEqual(mergeNowPlaying(summary, { status: 'ok', nowPlaying: [] }).navidrome.data.nowPlaying, [], 'nothing playing now is a real answer');
});

test('merge ignores failures and missing data', () => {
  for (const live of [null, undefined, { status: 'error' }, { status: 'unconfigured', nowPlaying: null }, { status: 'ok', nowPlaying: 'junk' }]) {
    assert.equal(mergeNowPlaying(summary, live), summary);
  }
  const noData = { navidrome: { status: 'loading', data: null } };
  assert.equal(mergeNowPlaying(noData, { status: 'ok', nowPlaying: [] }), noData);
  assert.equal(mergeNowPlaying(null, { status: 'ok', nowPlaying: [] }), null);
});

test('fetchNowPlaying never throws: bad status, network error, or timeout give null', async () => {
  assert.deepEqual(await fetchNowPlaying(500, async () => json({ status: 'ok', nowPlaying: [] })), { status: 'ok', nowPlaying: [] });
  assert.equal(await fetchNowPlaying(500, async () => new Response('', { status: 500 })), null);
  assert.equal(
    await fetchNowPlaying(500, async () => {
      throw new TypeError('offline');
    }),
    null,
  );
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const hang = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
    const t0 = Date.now();
    assert.equal(await fetchNowPlaying(60, hang), null);
    assert.ok(Date.now() - t0 < 1000);
  } finally {
    clearInterval(keepAlive);
  }
});

async function start(config, fetchImpl) {
  const app = createApp({ config, fetchImpl, retryDelayMs: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${app.server.address().port}`, stop: () => new Promise((r) => app.server.close(r)) };
}

test('endpoint asks Navidrome every time (no cache)', async () => {
  const { dir, cleanup } = await tempDir();
  let n = 0;
  const fetchImpl = stubFetch([
    [has('/rest/getNowPlaying'), () => json({ 'subsonic-response': { status: 'ok', nowPlaying: { entry: [{ id: `s${++n}`, title: `Song ${n}`, artist: 'A' }] } } })],
  ]);
  const app = await start(baseConfig({ dataDir: dir }), fetchImpl);
  try {
    const a = await (await fetch(`${app.base}/api/navidrome/now-playing`)).json();
    const b = await (await fetch(`${app.base}/api/navidrome/now-playing`)).json();
    assert.equal(a.status, 'ok');
    assert.equal(a.nowPlaying[0].title, 'Song 1');
    assert.equal(b.nowPlaying[0].title, 'Song 2', 'second request is fresh');
    assert.equal(fetchImpl.calls.filter((c) => c.url.includes('getNowPlaying')).length, 2);
  } finally {
    await app.stop();
    await cleanup();
  }
});

test('endpoint: Navidrome down or not set up still answers 200, with no secrets', async () => {
  const { dir, cleanup } = await tempDir();
  const down = await start(baseConfig({ dataDir: dir }), async () => {
    throw new TypeError('fetch failed');
  });
  try {
    const res = await fetch(`${down.base}/api/navidrome/now-playing`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'error');
    assert.ok(!JSON.stringify(body).match(/pw|[?&]t=|[?&]s=/), 'no password or token in the error');
  } finally {
    await down.stop();
  }
  const off = await start(baseConfig({ dataDir: dir, navidrome: { url: '', user: '', password: '', ttlMs: 1000 } }), stubFetch([]));
  try {
    assert.equal((await (await fetch(`${off.base}/api/navidrome/now-playing`)).json()).status, 'unconfigured');
  } finally {
    await off.stop();
    await cleanup();
  }
});
