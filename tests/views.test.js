// Frontend render tests: the pure view functions run in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatMinutes, formatDuration, timeAgo, toHours, plural, greeting } from '../public/js/format.js';
import { ROUTES, resolveRoute, overview, statusPill, steamDetail, navidromeDetail, jellyfinDetail, rssDetail, rssGlance, sevenDayMinutes, steamGlance, steamPlayLink } from '../public/js/views.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { createFakeFetch } from '../server/demo/fake-upstreams.js';
import { tempDir } from './helpers.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');

test('format helpers and routes', () => {
  {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(formatMinutes(0), '0m');
    assert.equal(formatMinutes(45), '45m');
    assert.equal(formatMinutes(135), '2h 15m');
    assert.equal(formatMinutes(120), '2h');
    assert.equal(formatMinutes(6001), '100h');
    assert.equal(formatMinutes('junk'), '0m');
    assert.equal(formatDuration(225), '3:45');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(toHours(1360), 22.7);
    assert.equal(timeAgo(new Date(NOW - 10_000).toISOString(), NOW), 'just now');
    assert.equal(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), '3h ago');
    assert.equal(timeAgo('nonsense', NOW), '');
    assert.equal(plural(1, 'track'), '1 track');
    assert.equal(plural(2, 'track'), '2 tracks');
    assert.equal(greeting(new Date(2026, 0, 1, 9)), 'Good morning');
  }
  {
    assert.equal(resolveRoute('#/music'), 'music');
    assert.equal(resolveRoute('#/gaming?x=1'), 'gaming');
    assert.equal(resolveRoute('#/does-not-exist'), '');
    assert.equal(resolveRoute(undefined), '');
  }
});

const ALL_STATES = [undefined, null, { status: 'loading' }, { status: 'unconfigured' }, { status: 'error', error: 'boom <script>' }];

test('every page renders for every no-data state without throwing', () => {
  for (const state of ALL_STATES) {
    const summary = { steam: state, navidrome: state, jellyfin: state, rss: state };
    for (const [name, route] of Object.entries(ROUTES)) {
      const html = route.render(summary, NOW);
      assert.equal(typeof html, 'string', `${name} with ${JSON.stringify(state)}`);
      assert.ok(!html.includes('<script>'), 'error text is escaped');
    }
  }
  assert.doesNotThrow(() => overview(null, NOW));
});

test('unconfigured cards explain which settings are needed', () => {
  const html = overview({ steam: { status: 'unconfigured' }, navidrome: { status: 'unconfigured' }, jellyfin: { status: 'unconfigured' } }, NOW);
  assert.match(html, /STEAM_API_KEY/);
  assert.match(html, /NAVIDROME_URL/);
  assert.match(html, /JELLYFIN_API_KEY/);
});

test('overview shows four cards in a fixed order', () => {
  const html = overview({}, NOW);
  const order = [...html.matchAll(/class="card card-(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['steam', 'navidrome', 'jellyfin', 'rss']);
});

test('views: escaping, safe links, clamped bars, no misleading zeros', () => {
  {
    const env = {
      status: 'ok',
      updatedAt: new Date(NOW).toISOString(),
      data: {
        newToday: 1,
        feeds: [{ name: 'F', site: 'javascript:alert(1)', ok: true, items: [] }],
        latest: [
          { title: 'Good', link: 'https://ok.example/a', feed: 'F', date: new Date(NOW - 3_600_000).toISOString() },
          { title: 'Evil', link: 'javascript:alert(1)', feed: 'F' },
        ],
      },
    };
    for (const html of [rssGlance(env, NOW), rssDetail(env, NOW)]) {
      assert.ok(!html.includes('javascript:'), 'no javascript: hrefs');
      assert.match(html, /href="https:\/\/ok\.example\/a" target="_blank" rel="noopener noreferrer"/);
      assert.match(html, /1h ago/);
    }
  }
  {
    const evil = '<img src=x onerror=alert(1)>';
    const env = (data) => ({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data });
    const html = [
      steamDetail(env({ period: { kind: 'twoWeeks', label: 'L', since: '' }, totalMinutes: 5, gamesPlayed: 1, minutes2Weeks: 5, games: [{ appid: 1, name: evil, minutes: 5, minutes2Weeks: 5, minutesForever: 5 }], player: { name: evil, status: 'Online' } }), NOW),
      navidromeDetail(env({ nowPlaying: [{ title: evil, artist: evil, coverId: '"><x' }], recentlyPlayed: [], stats: { topArtists: [{ name: evil, plays: 1 }] }, topSongs: [], recentAlbums: [], frequentAlbums: [] }), NOW),
      jellyfinDetail(env({ movies: [{ id: 'm', name: evil, overview: evil, genres: [evil] }], shows: [{ id: 's', imageId: 's', name: evil, episodes: [{ name: evil }] }], timeline: [] }), NOW),
    ].join('');
    assert.ok(!html.includes('<img src=x'), 'raw tag must not appear');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  }
  {
    const env = { status: 'ok', updatedAt: new Date(NOW).toISOString(), data: { period: { kind: 'twoWeeks', label: 'L' }, totalMinutes: 90, gamesPlayed: 2, minutes2Weeks: 90, games: [{ appid: 1, name: 'A', minutes: 60 }, { appid: 2, name: 'B', minutes: 30 }] } };
    const html = overview({ steam: env }, NOW);
    const bars = [...html.matchAll(/data-bar="([\d.]+)"/g)].map((m) => Number(m[1]));
    assert.deepEqual(bars, [1, 0.5]);
    assert.match(html, /data-count="1.5"[^>]*>1.5h</);
  }
  {
    const env = (data) => ({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data: { warnings: ['x'], ...data } });
    const media = overview({ jellyfin: env({ hasItems: false, counts: { movies: 1, series: 1, episodes: 1 }, addedThisWeek: { movies: 0, episodes: 0 }, timeline: [] }) }, NOW);
    assert.match(media, /New movies/);
    assert.ok(!media.includes('data-count="0"'), 'no zero counters for jellyfin');
    assert.match(media, /unavailable right now/);
    const music = overview({ navidrome: env({ hasSongHistory: false, stats: { tracksThisWeek: 0, minutesThisWeek: 0 }, nowPlaying: [], recentlyPlayed: [] }) }, NOW);
    assert.ok(!music.includes('data-count="0"'), 'no zero counters for music');
  }
});

test('status pills reflect freshness', () => {
  const at = new Date(NOW - 120_000).toISOString();
  assert.match(statusPill({ status: 'ok', updatedAt: at, data: {} }, NOW), /Live · 2m ago/);
  assert.match(statusPill({ status: 'ok', updatedAt: at, data: { warnings: ['x'] } }, NOW), /Partial/);
  assert.match(statusPill({ status: 'stale', updatedAt: at, data: {} }, NOW), /Offline/);
  assert.match(statusPill({ status: 'offline', updatedAt: at, data: {} }, NOW), /Saved copy/);
  assert.match(statusPill({ status: 'error' }, NOW), /Unavailable/);
});

test('renders the real demo API output on every page (contract between server and views)', async () => {
  const { dir, cleanup } = await tempDir();
  const config = { ...loadConfig({ DEMO_MODE: '1' }), dataDir: dir };
  const app = createApp({ config, fetchImpl: createFakeFetch({ failureRate: 0, latencyMs: [0, 0] }), retryDelayMs: 0 });
  try {
    const [steam, navidrome, jellyfin, rss] = await Promise.all([app.sources.steam.get(), app.sources.navidrome.get(), app.sources.jellyfin.get(), app.sources.rss.get()]);
    const summary = { steam, navidrome, jellyfin, rss };
    for (const env of Object.values(summary)) assert.equal(env.status, 'ok');
    const pages = Object.fromEntries(Object.entries(ROUTES).map(([n, r]) => [n, r.render(summary, Date.now())]));
    assert.match(pages[''], /Starfall Drifters/);
    assert.match(pages.music, /Top artists this week/);
    assert.match(pages.music, /Now playing/);
    assert.match(pages.media, /The Lighthouse Files/);
    assert.match(pages.gaming, /Moss Garden Tycoon/);
    assert.match(pages[''], /Home server tips &amp; tricks|Spring distro releases/);
    assert.match(pages.news, /Open Source Digest/);
    assert.match(pages.news, /Lumen Caverns 1\.2 patch notes/);
    for (const html of Object.values(pages)) assert.ok(!html.includes('undefined') && !html.includes('NaN'), 'no undefined/NaN in output');
  } finally {
    await cleanup();
  }
});

test('random partial data never crashes a view (fuzz)', () => {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const junk = [undefined, null, 0, '', 'x', [], {}, -1, NaN];
  for (let i = 0; i < 300; i++) {
    const data = {
      period: pick([undefined, { kind: 'week', label: 'L', since: '2026-01-01' }]),
      games: pick([[], [{ appid: 1, name: pick(junk), minutes: pick(junk) }]]),
      totalMinutes: pick(junk),
      stats: pick([undefined, {}, { topArtists: [] }]),
      nowPlaying: pick([undefined, [], [{}]]),
      recentlyPlayed: pick([undefined, [], [{ title: pick(junk) }]]),
      timeline: pick([undefined, [], [{ title: 'x' }]]),
      movies: pick([undefined, [], [{ name: 'm', genres: [] }]]),
      shows: pick([undefined, [], [{ name: 's', episodes: [] }]]),
      counts: pick([undefined, null, { movies: 1, series: 2, episodes: 3 }]),
      warnings: pick([undefined, [], ['w']]),
      feeds: pick([undefined, [], [{ name: pick(junk), ok: pick([true, false]), items: pick([undefined, [], [{ title: pick(junk), link: pick(junk) }]]) }]]),
      latest: pick([undefined, [], [{ title: pick(junk), link: pick(junk), feed: pick(junk), date: pick(junk) }]]),
      newToday: pick(junk),
    };
    if (!data.period) data.period = { kind: 'twoWeeks', label: 'L' };
    const env = { status: pick(['ok', 'stale', 'offline']), updatedAt: pick([null, '2026-11-01T00:00:00Z']), data };
    for (const route of Object.values(ROUTES)) {
      assert.doesNotThrow(() => route.render({ steam: env, navidrome: env, jellyfin: env, rss: env }, NOW), JSON.stringify(data));
    }
  }
});

test('game cards: last 7 days is exact with history, half of 2 weeks (marked ~) without', () => {
  assert.deepEqual(sevenDayMinutes({ minutes: 120, minutes2Weeks: 300 }, { kind: 'week' }), { minutes: 120, estimated: false });
  assert.deepEqual(sevenDayMinutes({ minutes: 610, minutes2Weeks: 610 }, { kind: 'twoWeeks' }), { minutes: 305, estimated: true });
  assert.deepEqual(sevenDayMinutes({ minutes2Weeks: 'junk' }, null), { minutes: 0, estimated: true });

  const game = { appid: 1, name: 'Starfall Drifters', minutes: 610, minutes2Weeks: 610, minutesForever: 5230 };
  const env = (period) => ({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data: { period, totalMinutes: 610, gamesPlayed: 1, minutes2Weeks: 610, games: [game] } });

  const early = steamDetail(env({ kind: 'twoWeeks', label: 'Last 2 weeks' }), NOW);
  const stats = early.match(/<dl class="game-stats">([\s\S]*?)<\/dl>/)[1];
  assert.match(stats, /<dt>Last 7 days<\/dt><dd>~5h 5m<\/dd>/, 'estimate is half, marked ~');
  assert.match(stats, /title="Estimate: half of Steam/);
  assert.equal((stats.match(/<dt>Last 2 weeks<\/dt>/g) ?? []).length, 1, 'no duplicate 2-week column');

  const later = steamDetail(env({ kind: 'week', label: 'Last 7 days', since: '2026-11-05T00:00:00Z' }), NOW);
  assert.match(later, /<dt>Last 7 days<\/dt><dd>10h 10m<\/dd>/, 'exact value, no ~');
});

test('steam game names launch the game in Steam, and only with a whole-number app ID', () => {
  assert.equal(steamPlayLink(1145360, 'Hades'), '<a class="play-link" href="steam://rungameid/1145360" title="Launch in Steam">Hades</a>');
  for (const bad of ['1; steam://uninstall/1', '12abc', -5, 0, 1.5, null, undefined, '']) {
    assert.equal(steamPlayLink(bad, 'X'), 'X');
    assert.equal(steamPlayLink(bad, 'X', 'store'), 'X');
  }
  assert.equal(steamPlayLink(620, 'Portal', 'store'), '<a class="play-link" href="https://store.steampowered.com/app/620/" target="_blank" rel="noopener noreferrer" title="Open in the Steam store">Portal</a>');
  for (const html of [steamGlance, steamDetail].map((f) => f({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data: { period: { kind: 'twoWeeks', label: 'L', since: '' }, totalMinutes: 5, gamesPlayed: 1, minutes2Weeks: 5, games: [{ appid: 620, name: 'Portal', minutes: 5, minutes2Weeks: 5, minutesForever: 5 }], player: null, links: 'store' } }, NOW))) {
    assert.match(html, /href="https:\/\/store\.steampowered\.com\/app\/620\/"/);
    assert.doesNotMatch(html, /steam:\/\//);
  }
  const data = { period: { kind: 'twoWeeks', label: 'L', since: '' }, totalMinutes: 5, gamesPlayed: 1, minutes2Weeks: 5, games: [{ appid: 620, name: '<b>Portal</b>', minutes: 5, minutes2Weeks: 5, minutesForever: 5 }], player: null };
  const env = { status: 'ok', data, updatedAt: new Date(NOW).toISOString() };
  for (const html of [steamGlance(env, NOW), steamDetail(env, NOW)]) {
    assert.match(html, /<a class="play-link" href="steam:\/\/rungameid\/620" title="Launch in Steam">&lt;b&gt;Portal&lt;\/b&gt;<\/a>/);
    assert.doesNotMatch(html, /href="steam:[^"]*"[^>]*target=/);
  }
});

test('STEAM_LINKS: launch by default, store when asked, anything else falls back to launch', () => {
  assert.equal(loadConfig({}).steam.links, 'launch');
  assert.equal(loadConfig({ STEAM_LINKS: ' Store ' }).steam.links, 'store');
  assert.equal(loadConfig({ STEAM_LINKS: 'javascript:alert(1)' }).steam.links, 'launch');
});
