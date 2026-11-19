// Roblox: settings parsing, log files, play history, the tracker, and the Gaming card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, utimes, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRobloxUser, parseRobloxCookie, robloxPollSeconds, robloxLaunchUrl, normalizePresence, createRobloxTracker, withRobloxCsrf } from '../server/sources/roblox.js';
import { parseRobloxLog, createRobloxLogReader, robloxLogDirs } from '../server/sources/roblox-logs.js';
import { createRobloxHistory, computeRobloxWeek } from '../server/sources/roblox-history.js';
import { loadConfig, isConfigured } from '../server/config.js';
import { applyChanges, describeSettings, readSettings, writeSettings } from '../server/settings.js';
import { createApp } from '../server/app.js';
import { createFakeFetch } from '../server/demo/fake-upstreams.js';
import { mergeGaming, steamGlance, steamDetail, robloxPlayLink, overview, ROUTES } from '../public/js/views.js';
import { steamImageUrls } from '../public/js/images.js';
import { tempDir, stubFetch, json, has, fakeClock, NO_FEEDS_FILE } from './helpers.js';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-12T12:00:00Z');
const COOKIE = `_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_${'AB12'.repeat(200)}`;
const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------ settings */

test('Roblox profile, cookie and poll settings accept what people paste', () => {
  assert.deepEqual(parseRobloxUser('https://www.roblox.com/users/123456/profile'), { id: 123456 });
  assert.deepEqual(parseRobloxUser('roblox.com/en-au/users/42/profile?x=1'), { id: 42 });
  assert.deepEqual(parseRobloxUser('987654321'), { id: 987654321 });
  assert.deepEqual(parseRobloxUser('Cool_Builder'), { name: 'Cool_Builder' });
  for (const bad of ['', 'ab', 'has space', 'https://evil.example/users/1', '<script>', '0']) assert.equal(parseRobloxUser(bad), null, bad);

  assert.equal(parseRobloxCookie(COOKIE), COOKIE);
  assert.equal(parseRobloxCookie(`.ROBLOSECURITY=${COOKIE}`), COOKIE);
  assert.equal(parseRobloxCookie(`'${COOKIE}'`), COOKIE);
  for (const bad of ['', 'short', `${COOKIE}; other=1`, `${COOKIE}\r\nX: y`]) assert.equal(parseRobloxCookie(bad), null);

  assert.equal(robloxPollSeconds(''), 60);
  assert.equal(robloxPollSeconds('junk'), 60);
  assert.equal(robloxPollSeconds('5'), 30);
  assert.equal(robloxPollSeconds('120'), 120);
  assert.equal(robloxPollSeconds('99999'), 3600);

  assert.equal(robloxLaunchUrl(123), 'roblox://experiences/start?placeId=123');
  for (const bad of [0, -1, 1.5, 'x', '1;alert(1)', null]) assert.equal(robloxLaunchUrl(bad), null);
});

test('config: a profile or a cookie turns Roblox on; logs default to auto', () => {
  assert.equal(isConfigured.roblox(loadConfig({ ...NO_FEEDS_FILE })), false);
  const c = loadConfig({ ...NO_FEEDS_FILE, ROBLOX_USER: 'someone', ROBLOX_POLL_SECONDS: '90' });
  assert.equal(isConfigured.roblox(c), true);
  assert.equal(c.roblox.logs, 'auto');
  assert.equal(c.roblox.pollSeconds, 90);
  assert.equal(loadConfig({ ...NO_FEEDS_FILE, ROBLOX_LOGS: 'off' }).roblox.logs, 'off');
  assert.equal(isConfigured.roblox(loadConfig({ ...NO_FEEDS_FILE, ROBLOX_COOKIE: COOKIE })), true);
});

test('settings page: Roblox fields validate, the long cookie fits, and it stays write-only', async () => {
  const ok = applyChanges({}, { values: { ROBLOX_USER: 'https://www.roblox.com/users/5/profile', ROBLOX_COOKIE: COOKIE, ROBLOX_LOGS: 'off', ROBLOX_POLL_SECONDS: '120' } });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.settings.ROBLOX_COOKIE, COOKIE);
  const bad = applyChanges({}, { values: { ROBLOX_USER: 'no spaces allowed', ROBLOX_COOKIE: 'nope', ROBLOX_LOGS: 'maybe', ROBLOX_POLL_SECONDS: '5' } });
  assert.deepEqual(bad.errors.map((x) => x.key).sort(), ['ROBLOX_COOKIE', 'ROBLOX_LOGS', 'ROBLOX_POLL_SECONDS', 'ROBLOX_USER']);
  const described = describeSettings({}, ok.settings).find((f) => f.key === 'ROBLOX_COOKIE');
  assert.equal(described.secret, true);
  assert.equal(described.value, '');
  assert.equal(described.isSet, true);
  assert.equal(described.section, 'roblox');
  // Saved and read back (longer than ordinary settings are allowed to be).
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, 'settings.json');
    await writeSettings(file, ok.settings);
    assert.equal(readSettings(file).ROBLOX_COOKIE, COOKIE);
  } finally {
    await cleanup();
  }
});

test('the settings page has a Roblox section right after Steam', async () => {
  const src = await readFile(new URL('../public/js/setup.js', import.meta.url), 'utf8');
  const steam = src.indexOf("id: 'steam'");
  const roblox = src.indexOf("id: 'roblox'");
  assert.ok(steam > 0 && roblox > steam && src.indexOf("id: '", steam + 10) === roblox);
});

/* ------------------------------------------------------------ log files */

const winLine = (t, msg) => `${iso(t)},12.5,1a2b,6 ${msg}`;
const soberLine = (t, msg) => `info: Roblox: ${iso(t)},12.5,c575,6 ${msg}`;
const join = (place) => `[FLog::Output] ! Joining game 'aaaa-bbbb' place ${place} at 10.0.0.1`;

test('log parser: joins, leaves, teleports and unfinished sessions (Windows and Sober formats)', () => {
  const t = NOW - 3 * 3_600_000;
  for (const line of [winLine, soberLine]) {
    const text = [
      line(t, '[FLog::Output] Roblox started'),
      line(t + MIN, join(111)),
      'debug: rbx.jni: onGameLoaded() SessionReporterState_GameLoaded placeId:111',
      line(t + 20 * MIN, '[DFLog::NetworkClient] Client:Disconnect'),
      line(t + 21 * MIN, '[DFLog::NetworkClient] Client:Disconnect'), // repeated leave lines don't matter
      line(t + 30 * MIN, join(222)),
      line(t + 40 * MIN, join(333)), // teleport / new experience closes the previous one
      line(t + 55 * MIN, '[FLog::Output] still here'),
    ].join('\n');
    const s = parseRobloxLog(text);
    assert.deepEqual(
      s.map((x) => [x.placeId, (x.end - x.start) / MIN, x.open]),
      [
        [111, 19, false],
        [222, 10, false],
        [333, 15, true],
      ],
    );
  }
  assert.deepEqual(parseRobloxLog(''), []);
  assert.deepEqual(parseRobloxLog(null), []);
  assert.deepEqual(parseRobloxLog(`${winLine(NOW, '! Joining game x place notanumber at y')}\njunk\n\u0000\u0000`), []);
});

test('log parser stays fast on hostile input', () => {
  const huge = [
    'x'.repeat(5_000_000), // one enormous line, no newline
    `${'2026-11-12T12:00:00Z ! Joining game '.repeat(50_000)}`,
    `${winLine(NOW, '! Joining game ')} place ${'9'.repeat(100_000)}`,
    Array.from({ length: 100_000 }, (_, i) => winLine(NOW + i, i % 2 ? join(5) : 'Client:Disconnect')).join('\n'),
  ];
  for (const text of huge) {
    const t = Date.now();
    parseRobloxLog(text);
    assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
  }
});

test('log folders: Windows (incl. Microsoft Store), macOS and Sober on Linux', () => {
  const win = robloxLogDirs({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, home: 'C:\\Users\\a' });
  assert.equal(win[0], 'C:\\Users\\a\\AppData\\Local\\Roblox\\logs');
  assert.equal(win[1].storeParent, 'C:\\Users\\a\\AppData\\Local\\Packages');
  assert.deepEqual(robloxLogDirs({ platform: 'darwin', home: '/Users/a' }), ['/Users/a/Library/Logs/Roblox']);
  assert.deepEqual(robloxLogDirs({ platform: 'linux', home: '/home/a' }), ['/home/a/.var/app/org.vinegarhq.Sober/data/sober/sober_logs']);
  assert.deepEqual(robloxLogDirs({ platform: 'freebsd', home: '/home/a' }), []);
});

test('log reader: reads a folder, skips Studio logs and links, spots a session still going', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const now = Date.now();
    const old = path.join(dir, '0.650_20261110T100000Z_Player_ABC_last.log');
    await writeFile(old, [winLine(now - 2 * DAY, join(111)), winLine(now - 2 * DAY + 30 * MIN, 'Client:Disconnect')].join('\n'));
    await utimes(old, new Date(now - 2 * DAY), new Date(now - 2 * DAY));
    await writeFile(path.join(dir, '0.650_Studio_ABC_last.log'), winLine(now - DAY, join(999)));
    const live = path.join(dir, '2026-11-12_live.log');
    await writeFile(live, [soberLine(now - 10 * MIN, join(222)), soberLine(now - MIN, 'still playing')].join('\n'));
    await symlink(live, path.join(dir, 'latest.log'));
    await writeFile(path.join(dir, 'notes.txt'), winLine(now, join(333)));

    const reader = createRobloxLogReader({ customDir: dir });
    const { dirs, sessions } = await reader.read();
    assert.deepEqual(dirs, [dir]);
    assert.deepEqual(
      sessions.map((s) => [s.placeId, s.live]),
      [
        [111, false],
        [222, true],
      ],
    );
    assert.ok(sessions[1].end >= now - MIN);
    assert.deepEqual((await createRobloxLogReader({ customDir: path.join(dir, 'missing') }).read()).dirs, []);
  } finally {
    await cleanup();
  }
});

/* ------------------------------------------------------------ history */

test('history: presence checks extend a session, gaps and new experiences start new ones', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const h = createRobloxHistory({ dataDir: dir });
    const at = NOW;
    await h.forAccount(1);
    await h.markTracking(at);
    for (let i = 0; i < 10; i++) await h.addPresence({ at: at + i * MIN, placeId: 11, universeId: 1, pollMs: MIN });
    await h.addPresence({ at: at + 30 * MIN, placeId: 11, universeId: 1, pollMs: MIN }); // pupboard was off: new session
    await h.addPresence({ at: at + 31 * MIN, placeId: 22, universeId: 2, pollMs: MIN });
    const s = await h.current();
    assert.deepEqual(
      s.sessions.map((x) => [x.u, (x.e - x.s) / MIN]),
      [
        [1, 9.5],
        [1, 0.5],
        [2, 0.5],
      ],
    );
    // Saved to disk and read back by a new instance.
    const again = await createRobloxHistory({ dataDir: dir }).current();
    assert.equal(again.sessions.length, 3);
    // A different account starts over.
    await h.forAccount(2);
    assert.equal((await h.current()).sessions.length, 0);
  } finally {
    await cleanup();
  }
});

test('history: log sessions merge without duplicates and a corrupt file starts fresh', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    await writeFile(path.join(dir, 'roblox-history.json'), '{not json');
    const h = createRobloxHistory({ dataDir: dir });
    const list = [{ placeId: 11, start: NOW - 3 * 3_600_000, end: NOW - 2 * 3_600_000 }];
    await h.addLogSessions(list, NOW);
    await h.addLogSessions([{ ...list[0], end: NOW - 3_600_000 }], NOW); // the same session, now longer
    await h.addLogSessions([{ placeId: -1, start: 1, end: 2 }, { placeId: 5, start: 10, end: 1 }], NOW); // junk ignored
    const s = await h.current();
    assert.equal(s.sessions.length, 1);
    assert.equal(s.sessions[0].e, NOW - 3_600_000);
    await h.setUniverse(11, 900);
    assert.equal((await h.current()).sessions[0].u, 900);
  } finally {
    await cleanup();
  }
});

test('weekly minutes: overlaps count once, old play drops off, a short history says so', () => {
  const state = {
    since: NOW - 10 * DAY,
    universes: { 33: 3 },
    sessions: [
      { p: 11, u: 1, s: NOW - 2 * 3_600_000, e: NOW - 3_600_000, src: 'log' },
      { p: 11, u: 1, s: NOW - 90 * MIN, e: NOW - 30 * MIN, src: 'presence' }, // overlaps the log session by 30 min
      { p: 22, u: 2, s: NOW - 9 * DAY, e: NOW - 9 * DAY + 3_600_000, src: 'log' }, // older than a week
      { p: 33, u: null, s: NOW - 3 * DAY, e: NOW - 3 * DAY + 45 * MIN, src: 'log' }, // universe known from the map
      { p: 44, u: null, s: NOW - DAY, e: NOW - DAY + 10 * MIN, src: 'log' }, // universe not known yet
    ],
  };
  const w = computeRobloxWeek(state, NOW);
  assert.equal(w.from, NOW - 7 * DAY);
  assert.equal(w.perExperience['1'].minutes, 90);
  assert.equal(w.perExperience['3'].minutes, 45);
  assert.equal(w.perExperience['place:44'].minutes, 10);
  assert.ok(!('2' in w.perExperience));
  const fresh = computeRobloxWeek({ since: NOW - 2 * DAY, sessions: [], universes: {} }, NOW);
  assert.equal(fresh.from, NOW - 2 * DAY);
  assert.deepEqual(computeRobloxWeek(null, NOW).perExperience, {});
});

/* ------------------------------------------------------------ tracker */

function robloxRoutes({ presence = () => json({ userPresences: [{ userPresenceType: 2, lastLocation: 'Cake Tycoon', placeId: 501, rootPlaceId: 500, universeId: 50, userId: 7 }] }), games = true } = {}) {
  return [
    [has('presence.roblox.com'), (url, init) => presence(url, init)],
    [has('/v1/users/authenticated'), () => json({ id: 7, name: 'me', displayName: 'Me' })],
    [has('/v1/usernames/users'), () => json({ data: [{ id: 7, name: 'me' }] })],
    [has('users.roblox.com/v1/users/7'), () => json({ id: 7, name: 'me', displayName: 'Me <b>' })],
    [has('games.roblox.com/v1/games'), () => (games ? json({ data: [{ id: 50, rootPlaceId: 500, name: 'Cake <Tycoon>' }, { id: 60, rootPlaceId: 600, name: 'Log Game' }] }) : new Response('down', { status: 500 }))],
    [has('/games/icons'), () => json({ data: [{ targetId: 50, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/icon50' }, { targetId: 60, state: 'Completed', imageUrl: 'javascript:alert(1)' }] })],
    [has('/games/multiget/thumbnails'), () => json({ data: [{ universeId: 50, thumbnails: [{ state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/wide50' }] }] })],
    [has('avatar-headshot'), () => json({ data: [{ targetId: 7, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/me' }] })],
    [has('apis.roblox.com/universes/v1/places/600/universe'), () => json({ universeId: 60 })],
  ];
}

const trackerConfig = (roblox) => ({ ...loadConfig({ ...NO_FEEDS_FILE }), timeoutMs: 1000, roblox: { ...loadConfig({}).roblox, ...roblox } });

test('tracker with a cookie: CSRF handshake, presence recorded, names and pictures added, cookie only in a header', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const now = fakeClock(NOW);
    let csrfAsked = false;
    const fetchImpl = stubFetch(
      robloxRoutes({
        presence: (url, init) => {
          if (!init.headers['x-csrf-token']) {
            csrfAsked = true;
            return new Response('', { status: 403, headers: { 'x-csrf-token': 'tok' } });
          }
          return json({ userPresences: [{ userPresenceType: 2, lastLocation: 'Cake Tycoon', placeId: 501, rootPlaceId: 500, universeId: 50, userId: 7 }] });
        },
      }),
    );
    const history = createRobloxHistory({ dataDir: dir });
    const tracker = createRobloxTracker({ config: trackerConfig({ cookie: COOKIE, user: '' }), fetchImpl, history, now });
    for (let i = 0; i < 20; i++) {
      await tracker.poll();
      now.advance(MIN);
    }
    const d = await tracker.load();
    assert.ok(csrfAsked);
    assert.equal(d.games.length, 1);
    assert.equal(d.games[0].name, 'Cake <Tycoon>');
    assert.ok(d.games[0].minutes >= 19 && d.games[0].minutes <= 21, String(d.games[0].minutes));
    assert.equal(d.games[0].placeId, 500);
    assert.equal(d.games[0].icon, 'https://tr.rbxcdn.com/icon50');
    assert.equal(d.games[0].header, 'https://tr.rbxcdn.com/wide50');
    assert.equal(d.playing.name, 'Cake <Tycoon>');
    assert.equal(d.user.displayName, 'Me <b>');
    assert.equal(d.period.kind, 'since');
    assert.deepEqual(d.methods, { presence: true, logs: false });
    for (const call of fetchImpl.calls) {
      assert.ok(!call.url.includes(COOKIE.slice(-40)), 'cookie never in a URL');
      const sent = call.init.headers?.cookie;
      if (sent) assert.ok(/^https:\/\/(presence|users)\.roblox\.com\//.test(call.url), `cookie only sent to Roblox: ${call.url}`);
    }
    assert.ok(!JSON.stringify(d).includes(COOKIE.slice(-40)));
  } finally {
    await cleanup();
  }
});

test('tracker: an expired cookie says what to do, never shows the cookie', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const fetchImpl = stubFetch([[has('roblox.com'), () => new Response('no', { status: 401 })]]);
    const tracker = createRobloxTracker({ config: trackerConfig({ cookie: COOKIE, user: '7' }), fetchImpl, history: createRobloxHistory({ dataDir: dir }), now: () => NOW });
    await assert.rejects(tracker.load(), (err) => /paste a fresh one/i.test(err.message) && !err.message.includes(COOKIE.slice(-40)));
  } finally {
    await cleanup();
  }
});

test('tracker: in a hidden experience gives a privacy hint; no cookie and no logs explains what is needed', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const hidden = stubFetch(robloxRoutes({ presence: () => json({ userPresences: [{ userPresenceType: 2, lastLocation: '', placeId: null, universeId: null, userId: 7 }] }) }));
    const t1 = createRobloxTracker({ config: trackerConfig({ cookie: COOKIE, user: '7' }), fetchImpl: hidden, history: createRobloxHistory({ dataDir: dir }), now: () => NOW });
    const d = await t1.load();
    assert.equal(d.games.length, 0, 'nothing invented');
    assert.ok(d.warnings.some((w) => /Friends/.test(w)));

    const t2 = createRobloxTracker({ config: trackerConfig({ user: 'someone' }), fetchImpl: stubFetch([]), history: createRobloxHistory({ dataDir: dir }), now: () => NOW });
    await assert.rejects(t2.load(), /login cookie/);
  } finally {
    await cleanup();
  }
});

test('tracker: log files alone (no cookie) give experiences, names looked up from the place', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const logReader = { read: async () => ({ dirs: ['x'], sessions: [{ placeId: 600, start: NOW - 2 * 3_600_000, end: NOW - 3_600_000, live: false }] }) };
    const fetchImpl = stubFetch(robloxRoutes());
    const tracker = createRobloxTracker({ config: trackerConfig({ user: '7' }), fetchImpl, history: createRobloxHistory({ dataDir: dir }), logReader, now: () => NOW });
    const d = await tracker.load();
    assert.deepEqual(
      d.games.map((g) => [g.name, g.minutes, g.icon]),
      [['Log Game', 60, null]],
      'a non-https icon is dropped',
    );
    assert.deepEqual(d.methods, { presence: false, logs: true });
    assert.ok(!fetchImpl.calls.some((c) => c.url.includes('presence')), 'no presence check without a cookie');
  } finally {
    await cleanup();
  }
});

test('tracker: names failing still shows time (with a fallback name and a warning)', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const history = createRobloxHistory({ dataDir: dir });
    await history.addPresence({ at: NOW - 30 * MIN, placeId: 500, universeId: 50, pollMs: MIN });
    await history.addPresence({ at: NOW - 29 * MIN, placeId: 500, universeId: 50, pollMs: MIN });
    const tracker = createRobloxTracker({ config: trackerConfig({ cookie: COOKIE, user: '7' }), fetchImpl: stubFetch(robloxRoutes({ games: false })), history, now: () => NOW });
    const d = await tracker.load();
    assert.match(d.games[0].name, /Roblox experience 50/);
    assert.ok(d.warnings.some((w) => w.startsWith('names:')));
  } finally {
    await cleanup();
  }
});

test('presence answers: junk is ignored', () => {
  assert.equal(normalizePresence(null, 1), null);
  assert.equal(normalizePresence({ userPresences: 'x' }, 1), null);
  assert.deepEqual(normalizePresence({ userPresences: [{ userPresenceType: 2, rootPlaceId: 'x', placeId: 5, universeId: -1, userId: 1 }] }, 1), { type: 2, placeId: 5, universeId: null, name: null });
});

test('CSRF wrapper retries once with the token Roblox asks for', async () => {
  const seen = [];
  const f = withRobloxCsrf(async (url, init) => {
    seen.push(init.headers['x-csrf-token'] ?? null);
    return init.headers['x-csrf-token'] === 't1' ? json({ ok: true }) : new Response('', { status: 403, headers: { 'x-csrf-token': 't1' } });
  });
  assert.equal((await f('https://x', { headers: {} })).status, 200);
  assert.equal((await f('https://x', { headers: {} })).status, 200);
  assert.deepEqual(seen, [null, 't1', 't1']);
});

/* ------------------------------------------------------------ views */

const steamEnv = (games, period = { kind: 'week', label: 'Last 7 days', since: iso(NOW - 7 * DAY) }) => ({
  source: 'steam',
  status: 'ok',
  updatedAt: iso(NOW - MIN),
  data: { player: { name: 'S', status: 'Online', inGame: null }, period, games, totalMinutes: games.reduce((a, g) => a + g.minutes, 0), gamesPlayed: games.length, minutes2Weeks: 900, ownedCount: 12, trackingSince: iso(NOW - 9 * DAY), links: 'launch', warnings: [] },
});
const robloxEnv = (games, extra = {}) => ({
  source: 'roblox',
  status: 'ok',
  updatedAt: iso(NOW),
  data: {
    user: { id: 7, name: 'me', displayName: 'Me', avatar: null },
    playing: null,
    period: { kind: 'since', label: 'So far', since: iso(NOW - 2 * DAY) },
    trackingSince: iso(NOW - 2 * DAY),
    games,
    totalMinutes: games.reduce((a, g) => a + g.minutes, 0),
    gamesPlayed: games.length,
    methods: { presence: true, logs: false },
    warnings: [],
    ...extra,
  },
});
const STEAM_GAMES = [
  { appid: 10, name: 'Steam One', minutes: 300, minutes2Weeks: 500, minutesForever: 2000, icon: null, header: null },
  { appid: 20, name: 'Steam Two', minutes: 50, minutes2Weeks: 80, minutesForever: 100, icon: null, header: null },
];
const ROBLOX_GAMES = [{ universeId: 50, placeId: 500, name: 'Cake <Tycoon>', minutes: 120, sessions: 3, icon: null, header: null }];

test('Gaming card: Steam alone is unchanged; with Roblox, one list sorted by time', () => {
  const s = steamEnv(STEAM_GAMES);
  assert.equal(mergeGaming(s, undefined), s);
  assert.equal(mergeGaming(s, { status: 'unconfigured' }), s);
  const m = mergeGaming(s, robloxEnv(ROBLOX_GAMES));
  assert.deepEqual(
    m.data.games.map((g) => [g.name, g.kind]),
    [
      ['Steam One', 'steam'],
      ['Cake <Tycoon>', 'roblox'],
      ['Steam Two', 'steam'],
    ],
  );
  assert.equal(m.data.totalMinutes, 470);
  assert.equal(m.data.gamesPlayed, 3);
  assert.equal(m.status, 'ok');
  const html = steamGlance(s, NOW, robloxEnv(ROBLOX_GAMES));
  assert.match(html, /Cake &lt;Tycoon&gt;/);
  assert.ok(!html.includes('<Tycoon>'));
  assert.match(html, /roblox:\/\/experiences\/start\?placeId=500/);
  assert.match(html, /Roblox since 2d ago/);
});

test('Gaming card: Steam without a week of history is shown as a 7-day estimate next to Roblox', () => {
  const s = steamEnv(
    STEAM_GAMES.map((g) => ({ ...g, minutes: g.minutes2Weeks })),
    { kind: 'twoWeeks', label: 'Last 2 weeks', since: iso(NOW - 14 * DAY) },
  );
  const m = mergeGaming(s, robloxEnv(ROBLOX_GAMES));
  assert.equal(m.data.games.find((g) => g.name === 'Steam One').minutes, 250);
  assert.ok(m.data.period.steamEstimated);
  assert.match(steamGlance(s, NOW, robloxEnv(ROBLOX_GAMES)), /~4h 10m/);
});

test('Gaming card: one source failing shows the other as Partial; Roblox alone works too', () => {
  const failing = { source: 'roblox', status: 'error', data: null, error: 'Roblox needs a login cookie' };
  const m = mergeGaming(steamEnv(STEAM_GAMES), failing);
  assert.equal(m.data.games.length, 2);
  assert.ok(m.data.warnings.some((w) => w.includes('Roblox needs a login cookie')));
  assert.match(steamGlance(steamEnv(STEAM_GAMES), NOW, failing), /Partial/);

  const alone = steamGlance({ status: 'unconfigured' }, NOW, robloxEnv(ROBLOX_GAMES));
  assert.match(alone, /Cake &lt;Tycoon&gt;/);
  assert.match(alone, /Live/);
  // Nothing anywhere: Roblox's error explains itself instead of Steam's "not connected".
  assert.match(steamGlance({ status: 'unconfigured' }, NOW, failing), /login cookie/);
  // Neither set up: the setup hint mentions both.
  assert.match(overview({ steam: { status: 'unconfigured' }, roblox: { status: 'unconfigured' } }, NOW), /Roblox/);
});

test('Gaming page: Roblox slices in the donut, profiles, and honest notes', () => {
  const env = robloxEnv(ROBLOX_GAMES, { playing: { placeId: 500, universeId: 50, name: 'Cake <Tycoon>' }, user: { id: 7, name: 'me', displayName: 'Me <i>', avatar: null } });
  const html = steamDetail(steamEnv(STEAM_GAMES), NOW, env);
  assert.match(html, /Cake &lt;Tycoon&gt;: 26%/);
  assert.match(html, /Me &lt;i&gt;/);
  assert.match(html, /Playing Cake &lt;Tycoon&gt; on Roblox/);
  assert.match(html, /isn’t a full week yet/);
  assert.match(html, /time while pupboard was off isn’t counted/);
  assert.ok(!html.includes('<i>') && !html.includes('<Tycoon>'));
  const glance = steamGlance({ status: 'unconfigured' }, NOW, env);
  assert.match(glance, /Playing Cake &lt;Tycoon&gt; on Roblox/);
});

test('Roblox links only take whole-number place IDs', () => {
  assert.equal(robloxPlayLink(5, 'x'), '<a class="play-link" href="roblox://experiences/start?placeId=5" title="Play in Roblox">x</a>');
  for (const bad of [0, -2, 1.5, 'javascript:alert(1)', '5" onclick="x', null]) assert.equal(robloxPlayLink(bad, 'x'), 'x');
});

test('every Gaming state combination renders', () => {
  const states = [undefined, null, { status: 'loading' }, { status: 'unconfigured' }, { status: 'error', error: 'boom <script>' }, { status: 'stale', data: robloxEnv(ROBLOX_GAMES).data, updatedAt: iso(NOW) }];
  for (const a of [...states, steamEnv(STEAM_GAMES)]) {
    for (const b of [...states, robloxEnv(ROBLOX_GAMES), robloxEnv([])]) {
      for (const route of [ROUTES[''], ROUTES.gaming]) {
        const html = route.render({ steam: a, roblox: b }, NOW);
        assert.equal(typeof html, 'string');
        assert.ok(!html.includes('<script>'));
      }
    }
  }
});

test('Roblox pictures are kept ready like Steam ones', () => {
  const urls = steamImageUrls({ roblox: { data: { games: [{ icon: 'https://tr.rbxcdn.com/abc/150/150/Image/Png/noFilter' }] } } });
  assert.deepEqual(urls, ['https://tr.rbxcdn.com/abc/150/150/Image/Png/noFilter']);
});

/* ------------------------------------------------------------ server */

test('demo mode: the Gaming card gets Roblox experiences with a full invented week', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const config = { ...loadConfig({ DEMO_MODE: '1', ...NO_FEEDS_FILE }), dataDir: dir };
    const app = createApp({ config, fetchImpl: createFakeFetch({ failureRate: 0, latencyMs: [0, 1] }), retryDelayMs: 0 });
    const env = await app.sources.roblox.get();
    assert.equal(env.status, 'ok');
    assert.equal(env.data.period.kind, 'week');
    assert.ok(env.data.games.length >= 2);
    await app.pollRoblox();
  } finally {
    await cleanup();
  }
});
