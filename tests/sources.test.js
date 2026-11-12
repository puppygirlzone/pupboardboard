import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { normalizeRecent, normalizeOwned, normalizePlayer, buildSteamData, createSteamLoader } from '../server/sources/steam.js';
import { createSteamHistory, computeWeekly, WEEK } from '../server/sources/steam-history.js';
import { subsonicAuthParams, unwrapSubsonic, normalizeSongs, computeListeningStats, createNavidromeLoader } from '../server/sources/navidrome.js';
import { normalizeItems, groupRecent, createJellyfinLoader } from '../server/sources/jellyfin.js';
import { stubFetch, has, json, tempDir, fakeClock, baseConfig } from './helpers.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-12T12:00:00Z');

/* ------------------------------------------------------------- Steam */

const recentJson = {
  response: {
    games: [
      { appid: 10, name: 'Alpha', playtime_2weeks: 120, playtime_forever: 1000, img_icon_url: 'abc' },
      { appid: 20, name: 'Beta', playtime_2weeks: 300, playtime_forever: 500 },
      { name: 'no appid' },
    ],
  },
};

test('steam: parsing junk, 2-week and 7-day views, snapshot age', () => {
  {
    const games = normalizeRecent(recentJson);
    assert.equal(games.length, 2);
    assert.equal(games[0].icon, 'https://media.steampowered.com/steamcommunity/public/images/apps/10/abc.jpg');
    assert.equal(games[1].icon, null);
    assert.deepEqual(normalizeRecent({}), []);
    assert.deepEqual(normalizeRecent(null), []);
    assert.equal(normalizeOwned({ response: {} }), null); // private profile
    assert.equal(normalizePlayer({ response: { players: [] } }), null);
  }
  {
    const d = buildSteamData({ recent: normalizeRecent(recentJson), owned: null, player: null, snapshots: null, now: NOW });
    assert.equal(d.period.kind, 'twoWeeks');
    assert.deepEqual(
      d.games.map((g) => g.name),
      ['Beta', 'Alpha'],
    );
    assert.equal(d.totalMinutes, 420);
    assert.equal(d.gamesPlayed, 2);
  }
  {
    const snapshots = [
      { at: NOW - 9 * DAY, totals: { 10: 100, 20: 100 } },
      { at: NOW - 7 * DAY - 1000, totals: { 10: 900, 20: 450 } }, // newest >= 7 days old: baseline
      { at: NOW - 2 * DAY, totals: { 10: 950, 20: 480 } },
    ];
    const owned = { totals: { 10: 1000, 20: 500, 30: 60 }, names: { 30: { name: 'Gamma', icon: null } }, count: 3 };
    const d = buildSteamData({ recent: normalizeRecent(recentJson), owned, player: null, snapshots, now: NOW });
    assert.equal(d.period.kind, 'week');
    const byName = Object.fromEntries(d.games.map((g) => [g.name, g.minutes]));
    assert.deepEqual(byName, { Alpha: 100, Beta: 50, Gamma: 60 }); // Gamma is new since baseline
    assert.equal(d.totalMinutes, 210);
    assert.equal(d.ownedCount, 3);
  }
  {
    assert.equal(computeWeekly([{ at: NOW - 3 * DAY, totals: {} }], {}, NOW), null);
    assert.ok(computeWeekly([{ at: NOW - WEEK, totals: {} }], {}, NOW));
  }
});

test('steam history: saves hourly at most, survives a corrupt file, prunes old entries', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    await writeFile(path.join(dir, 'steam-history.json'), '{not json');
    const h = createSteamHistory({ dataDir: dir });
    await h.record({ 1: 10 }, NOW - 40 * DAY);
    await h.record({ 1: 20 }, NOW - 120 * 60_000);
    await h.record({ 1: 25 }, NOW - 100 * 60_000); // < 1h after previous: skipped
    const snaps = await h.record({ 1: 30 }, NOW);
    assert.deepEqual(
      snaps.map((s) => s.totals[1]),
      [20, 30],
    ); // 40-day-old one pruned
    const onDisk = JSON.parse(await readFile(path.join(dir, 'steam-history.json'), 'utf8'));
    assert.equal(onDisk.snapshots.length, 2);
  } finally {
    await cleanup();
  }
});

test('steam loader: works when only recent games succeed; key never appears in warnings', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fetchImpl = stubFetch([
      [has('GetRecentlyPlayedGames'), () => json(recentJson)],
      [has('GetOwnedGames'), () => new Response('', { status: 500 })],
      [has('GetPlayerSummaries'), () => json({ response: { players: [{ personaname: '<b>me</b>', personastate: 1 }] } })],
    ]);
    const load = createSteamLoader({ config: baseConfig(), fetchImpl, history: createSteamHistory({ dataDir: dir }), now: () => NOW });
    const d = await load();
    assert.equal(d.gamesPlayed, 2);
    assert.equal(d.player.name, '<b>me</b>');
    assert.equal(d.warnings.length, 1);
    assert.ok(!JSON.stringify(d).includes('SECRETKEY'));
  } finally {
    await cleanup();
  }
});

test('steam loader: recent-games failing without a week of history is an error, not 0 hours', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fetchImpl = stubFetch([
      [has('GetRecentlyPlayedGames'), () => new Response('', { status: 500 })],
      [has('GetOwnedGames'), () => json({ response: { game_count: 1, games: [{ appid: 10, name: 'Alpha', playtime_forever: 1000 }] } })],
      [has('GetPlayerSummaries'), () => json({ response: { players: [] } })],
    ]);
    const load = createSteamLoader({ config: baseConfig(), fetchImpl, history: createSteamHistory({ dataDir: dir }), now: () => NOW });
    await assert.rejects(load(), /recent/);
  } finally {
    await cleanup();
  }
});

test('steam loader: throws when every call fails', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fetchImpl = stubFetch([[() => true, () => new Response('', { status: 502 })]]);
    const load = createSteamLoader({ config: baseConfig(), fetchImpl, history: createSteamHistory({ dataDir: dir }) });
    await assert.rejects(load());
  } finally {
    await cleanup();
  }
});

/* --------------------------------------------------------- Navidrome */

test('navidrome: token, response checks and weekly stats', () => {
  {
    const p = subsonicAuthParams('me', 'pw', 'salty');
    assert.equal(p.get('t'), createHash('md5').update('pwsalty').digest('hex'));
    assert.equal(p.get('s'), 'salty');
    assert.equal(p.get('f'), 'json');
    assert.ok(!p.toString().includes('pw&') && !p.has('p'), 'plain password never sent');
  }
  {
    assert.throws(() => unwrapSubsonic({ 'subsonic-response': { status: 'failed', error: { message: 'Wrong username or password' } } }), /Wrong username/);
    assert.throws(() => unwrapSubsonic({}), /unexpected/);
  }
  {
    const songs = normalizeSongs([
      { id: 'a', title: 'A', artist: 'X', album: 'AX', albumId: '1', duration: 600, playDate: new Date(NOW - DAY).toISOString(), genre: 'Rock' },
      { id: 'b', title: 'B', artist: 'X', album: 'AX', albumId: '1', duration: 300, playDate: new Date(NOW - 2 * DAY).toISOString(), genre: 'Rock' },
      { id: 'c', title: 'C', artist: 'Y', album: 'AY', albumId: '2', duration: 300, playDate: new Date(NOW - 3 * DAY).toISOString(), genre: '' },
      { id: 'd', title: 'D', artist: 'Z', album: 'AZ', albumId: '3', duration: 999, playDate: new Date(NOW - 8 * DAY).toISOString() },
      { id: 'e', title: 'E', artist: 'Z', duration: 1, playDate: 'garbage' },
    ]);
    const s = computeListeningStats(songs, NOW);
    assert.equal(s.tracksThisWeek, 3);
    assert.equal(s.minutesThisWeek, 20);
    assert.deepEqual(
      s.topArtists.map((a) => [a.name, a.plays]),
      [
        ['X', 2],
        ['Y', 1],
      ],
    );
    assert.deepEqual(
      s.topGenres.map((g) => g.name),
      ['Rock'],
    ); // empty genre ignored
  }
});

const subsonicOk = (body) => json({ 'subsonic-response': { status: 'ok', ...body } });

test('navidrome loader: native API failing still returns now-playing and albums', async () => {
  const fetchImpl = stubFetch([
    [has('/rest/getNowPlaying'), () => subsonicOk({ nowPlaying: { entry: { id: 's1', title: 'Song', artist: 'Art', coverArt: 'c1' } } })],
    [has('/rest/getAlbumList2'), () => subsonicOk({ albumList2: { album: [{ id: 'al1', name: 'Alb', artist: 'Art' }] } })],
    [has('/auth/login'), () => new Response('', { status: 500 })],
  ]);
  const d = await createNavidromeLoader({ config: baseConfig(), fetchImpl, now: () => NOW })();
  assert.equal(d.nowPlaying[0].title, 'Song'); // single entry (not array) handled
  assert.equal(d.recentAlbums.length, 1);
  assert.equal(d.hasSongHistory, false);
  assert.ok(d.warnings.length >= 2);
});

test('navidrome loader: logs in again once when the token expires', async () => {
  let logins = 0;
  let songCalls = 0;
  const fetchImpl = stubFetch([
    [has('/rest/'), () => subsonicOk({ nowPlaying: {}, albumList2: {} })],
    [
      has('/auth/login'),
      () => {
        logins++;
        return json({ token: `tok${logins}` });
      },
    ],
    [
      has('/api/song'),
      (_url, init) => {
        songCalls++;
        return init.headers['x-nd-authorization'] === 'Bearer tok1' && songCalls <= 2 ? new Response('', { status: 401 }) : json([]);
      },
    ],
  ]);
  const load = createNavidromeLoader({ config: baseConfig(), fetchImpl, now: () => NOW });
  const d = await load();
  assert.equal(d.hasSongHistory, true);
  assert.ok(logins >= 2);
});

/* ---------------------------------------------------------- Jellyfin */

const jfItems = {
  Items: [
    { Id: 'm1', Type: 'Movie', Name: 'Film', DateCreated: new Date(NOW - DAY).toISOString(), CommunityRating: 7.456, RunTimeTicks: 72_000_000_000, Genres: ['A', 'B', 'C', 'D'] },
    { Id: 'e1', Type: 'Episode', Name: 'Ep1', SeriesId: 'sA', SeriesName: 'Show A', ParentIndexNumber: 1, IndexNumber: 1, DateCreated: new Date(NOW - 3 * DAY).toISOString() },
    { Id: 'e2', Type: 'Episode', Name: 'Ep2', SeriesId: 'sA', SeriesName: 'Show A', ParentIndexNumber: 1, IndexNumber: 2, DateCreated: new Date(NOW - 0.5 * DAY).toISOString() },
    { Id: 'm2', Type: 'Movie', Name: 'Old', DateCreated: new Date(NOW - 20 * DAY).toISOString() },
  ],
};

test('jellyfin: grouping, junk responses', () => {
  {
    const g = groupRecent(normalizeItems(jfItems), NOW);
    assert.equal(g.movies.length, 2);
    assert.equal(g.shows.length, 1);
    assert.equal(g.shows[0].episodes.length, 2);
    assert.equal(g.shows[0].latestAddedAt, jfItems.Items[2].DateCreated);
    assert.deepEqual(
      g.timeline.map((t) => t.title),
      ['Show A', 'Film', 'Old'],
    );
    assert.deepEqual(g.addedThisWeek, { movies: 1, episodes: 2 });
    const film = g.movies[0];
    assert.equal(film.rating, 7.5);
    assert.equal(film.runtimeMinutes, 120);
    assert.equal(film.genres.length, 3);
  }
  {
    assert.deepEqual(normalizeItems({}), []);
    const g = groupRecent([], NOW);
    assert.deepEqual(g.timeline, []);
  }
});

test('jellyfin loader: sends the token in the Authorization header, not the URL', async () => {
  const fetchImpl = stubFetch([
    [has('/Items/Counts'), () => json({ MovieCount: 5, SeriesCount: 2, EpisodeCount: 20 })],
    [has('/Items?'), () => json(jfItems)],
    [has('/System/Info/Public'), () => json({ ServerName: 'jf' })],
  ]);
  const d = await createJellyfinLoader({ config: baseConfig(), fetchImpl, now: () => NOW })();
  assert.equal(d.serverName, 'jf');
  assert.deepEqual(d.counts, { movies: 5, series: 2, episodes: 20 });
  for (const call of fetchImpl.calls) {
    assert.ok(!call.url.includes('JFKEY'));
    assert.match(call.init.headers.Authorization, /Token="JFKEY"/);
  }
});
