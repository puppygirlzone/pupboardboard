// Regression tests for the issues found in the v1.1.0 review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { parseFeed } from '../server/sources/rss.js';
import { parseDiary } from '../server/sources/letterboxd.js';
import { createSpotifyAuth } from '../server/sources/spotify.js';
import { normalizeItems } from '../server/sources/jellyfin.js';
import { createSteamHistory } from '../server/sources/steam-history.js';
import { createSteamLoader } from '../server/sources/steam.js';
import { fetchText, fetchJson, readCapped } from '../server/resilience.js';
import { jellyfinGlance, jellyfinDetail } from '../public/js/views.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { stubFetch, json, tempDir, fakeClock, baseConfig, NO_FEEDS_FILE } from './helpers.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');

test('feed parsing: linear time on hostile input; caps, script removal and CDATA still work', () => {
  {
    const attacks = [
      `<rss>${'<item>'.repeat(500_000)}`,
      `<rss><item><title>${'<title>'.repeat(400_000)}</item>`,
      `<rss><item><description>${'&lt;script '.repeat(300_000)}</description></item>`,
      `<rss><item><title>${'<![CDATA['.repeat(300_000)}</title></item>`,
    ];
    for (const xml of attacks) {
      const t = Date.now();
      try {
        parseFeed(xml);
      } catch {
        /* rejecting is fine too; hanging is not */
      }
      assert.ok(Date.now() - t < 1000, `${xml.slice(0, 30)}… took ${Date.now() - t} ms`);
    }
    const t = Date.now();
    parseDiary(`<rss>${'<item>'.repeat(500_000)}`);
    assert.ok(Date.now() - t < 1000);
  }
  {
    const many = `<rss><channel>${'<item><title>x</title></item>'.repeat(500)}</channel></rss>`;
    assert.equal(parseFeed(many).items.length, 200, 'at most 200 items');
    const feed = parseFeed('<rss><item><title><![CDATA[A <b>&</b> B]]></title><description>Hi<script>evil()</script> there<style>p{}</style>!</description></item><itemx>no</itemx></rss>');
    assert.equal(feed.items.length, 1, '<itemx> is not an <item>');
    assert.equal(feed.items[0].title, 'A & B');
    assert.equal(feed.items[0].summary, 'Hi there !');
  }
});

test('Spotify: parallel callers share one token refresh', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const clock = fakeClock(NOW);
    let refreshes = 0;
    const fetchImpl = stubFetch([
      [
        (u) => u.includes('/api/token'),
        async (u, init) => {
          const grant = new URLSearchParams(init.body).get('grant_type');
          if (grant === 'refresh_token') {
            refreshes += 1;
            await new Promise((r) => setTimeout(r, 20));
            return json({ access_token: `AT${refreshes + 1}`, refresh_token: `RT${refreshes + 1}`, expires_in: 3600 });
          }
          return json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 });
        },
      ],
    ]);
    const config = { timeoutMs: 500, spotify: { clientId: 'a'.repeat(32) } };
    const auth = createSpotifyAuth({ config, fetchImpl, file: path.join(dir, 'spotify.json'), now: clock });
    const state = new URL(auth.startLogin({ redirectUri: 'x', returnTo: 'y' })).searchParams.get('state');
    await auth.finishLogin({ state, code: 'c' });
    clock.advance(2 * 3600_000);
    const tokens = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken({ force: true })]);
    assert.equal(refreshes, 1, 'one refresh for three callers');
    assert.deepEqual(tokens, ['AT2', 'AT2', 'AT2']);
  } finally {
    await cleanup();
  }
});

test('Jellyfin: numbers are numbers, and markup in them is escaped anyway', () => {
  const bad = '<img src=x onerror=1>';
  const [item] = normalizeItems({ Items: [{ Id: '1', Type: 'Episode', Name: 'E', ProductionYear: '<b>', ParentIndexNumber: bad, IndexNumber: 3 }] });
  assert.equal(item.year, null);
  assert.equal(item.season, null);
  assert.equal(item.episode, 3);
  const env = { status: 'ok', updatedAt: new Date(NOW).toISOString(), data: { counts: { movies: bad, series: 1, episodes: 2 }, addedThisWeek: { movies: 0, episodes: 0 }, timeline: [], movies: [{ id: 'm', name: 'M', year: bad, genres: [] }], shows: [{ id: 's', imageId: 's', name: 'S', latestAddedAt: null, episodes: [{ name: 'E', season: bad, episode: bad }] }] } };
  for (const html of [jellyfinGlance(env, NOW), jellyfinDetail(env, NOW)]) assert.ok(!html.includes('<img src=x'), 'escaped');
});

test('Steam history: a different account starts over; failed library calls are not recorded', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const h = createSteamHistory({ dataDir: dir });
    await h.record({ 1: 100 }, NOW - 8 * 86_400_000, 'A');
    assert.equal((await h.record({ 1: 200 }, NOW, 'A')).length, 2);
    assert.equal((await h.record({ 9: 5000 }, NOW + 3_600_000, 'B')).length, 1, 'account B does not compare with A');
    assert.equal((await h.current('B')).length, 1);

    let ownedCalls = 0;
    const fetchImpl = stubFetch([
      [(u) => u.includes('GetOwnedGames'), () => (++ownedCalls === 1 ? json({ response: { game_count: 1, games: [{ appid: 1, playtime_forever: 60 }] } }) : new Response('', { status: 500 }))],
      [(u) => u.includes('GetRecentlyPlayedGames'), () => json({ response: { games: [{ appid: 1, name: 'G', playtime_2weeks: 60, playtime_forever: 60 }] } })],
      [() => true, () => new Response('', { status: 500 })],
    ]);
    const recorded = [];
    const history = { record: async (t, at) => (recorded.push(at), []), current: async () => [] };
    const clock = fakeClock(NOW);
    const load = createSteamLoader({ config: { timeoutMs: 200, steam: { apiKey: 'K', steamId: '76561198000000001' } }, fetchImpl, history, now: clock });
    await load();
    clock.advance(2 * 3_600_000);
    await load(); // owned fails: settleAll serves the remembered totals
    assert.equal(recorded.length, 1, 'remembered totals are not saved as a new snapshot');
  } finally {
    await cleanup();
  }
});

function endlessStream(chunk = 'x'.repeat(64 * 1024)) {
  const bytes = new TextEncoder().encode(chunk);
  return new ReadableStream({ pull: (c) => c.enqueue(bytes) });
}

test('download caps apply while reading, even without Content-Length', async () => {
  await assert.rejects(readCapped(new Response(endlessStream()), 1_000_000, 'x'), /too large/);
  const fetchImpl = async () => new Response(endlessStream(), { headers: { 'content-type': 'application/rss+xml' } });
  await assert.rejects(fetchText(fetchImpl, 'http://feed.local/rss', { maxBytes: 500_000 }), /too large/);
  await assert.rejects(fetchJson(fetchImpl, 'http://api.local/x', { maxBytes: 500_000 }), /too large/);
  assert.equal(await fetchText(async () => new Response('hello'), 'http://x.local/'), 'hello');

  const { dir, cleanup } = await tempDir();
  const app = createApp({ config: baseConfig({ dataDir: dir }), fetchImpl: async () => new Response(endlessStream(), { headers: { 'content-type': 'image/png' } }), retryDelayMs: 0 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/api/img/navidrome/big`)).status, 404, 'endless image refused');
  } finally {
    await new Promise((r) => app.server.close(r));
    await cleanup();
  }
});

const rawGet = (port, pathName, host) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName, headers: { host } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    }).on('error', reject);
  });

test('bound to this computer only: requests for other host names are refused (DNS rebinding)', async () => {
  const { dir, cleanup } = await tempDir();
  const local = createApp({ config: { ...loadConfig({ ...NO_FEEDS_FILE, HOST: '127.0.0.1', RSS_FEEDS: 'off', DEALS: 'off' }), dataDir: dir }, fetchImpl: stubFetch([]) });
  const lan = createApp({ config: { ...loadConfig({ ...NO_FEEDS_FILE, HOST: '0.0.0.0', RSS_FEEDS: 'off', DEALS: 'off' }), dataDir: dir }, fetchImpl: stubFetch([]) });
  await new Promise((r) => local.server.listen(0, '127.0.0.1', r));
  await new Promise((r) => lan.server.listen(0, '127.0.0.1', r));
  try {
    const lp = local.server.address().port;
    assert.equal(await rawGet(lp, '/api/summary', 'evil.example'), 403);
    assert.equal(await rawGet(lp, '/', `localhost:${lp}`), 200);
    assert.equal(await rawGet(lp, '/api/health', `127.0.0.1:${lp}`), 200);
    assert.equal(await rawGet(lan.server.address().port, '/api/health', 'dashboard.lan'), 200, 'LAN mode accepts any host name');
  } finally {
    await new Promise((r) => local.server.close(r));
    await new Promise((r) => lan.server.close(r));
    await cleanup();
  }
});

test('settings API: non-object JSON bodies get a 400 instead of hanging', async () => {
  const { dir, cleanup } = await tempDir();
  const CODE = 'd'.repeat(32);
  const env = { ...NO_FEEDS_FILE };
  const app = createApp({ config: { ...loadConfig(env), dataDir: dir }, fetchImpl: stubFetch([]), setup: { code: CODE, env, file: path.join(dir, 'settings.json') } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  try {
    for (const body of ['0', 'false', '""', '[]', 'null']) {
      for (const p of ['/api/setup', '/api/spotify/login']) {
        const res = await fetch(`http://127.0.0.1:${app.server.address().port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-setup-code': CODE }, body, signal: AbortSignal.timeout(2000) });
        assert.equal(res.status, 400, `${p} with ${body}`);
      }
    }
  } finally {
    await new Promise((r) => app.server.close(r));
    await cleanup();
  }
});
