// "On this PC": the server routes, the setting, and the Music card line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { SETTINGS_FIELDS, applyChanges } from '../server/settings.js';
import { createLocalPlayer } from '../server/sources/local-player.js';
import { localPlayingBlock, musicGlance, musicDetail, overview, ROUTES } from '../public/js/views.js';
import { mergeLocal, fetchLocalPlaying } from '../public/js/live.js';
import { tempDir, baseConfig } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);

async function start(t, appOpts) {
  const { dir, cleanup } = await tempDir();
  const app = createApp({ retryDelayMs: 0, config: baseConfig({ dataDir: dir }), ...appOpts });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => app.server.close(r));
    await cleanup();
  });
  return `http://127.0.0.1:${app.server.address().port}`;
}

const get = (url) => fetch(url).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), csp: r.headers.get('content-security-policy'), cache: r.headers.get('cache-control'), body: Buffer.from(await r.arrayBuffer()) }));

test('setting: LOCAL_NOW_PLAYING is off unless turned on, and is a Settings choice', () => {
  assert.equal(loadConfig({}).localPlayer.enabled, false);
  assert.equal(loadConfig({ LOCAL_NOW_PLAYING: 'on' }).localPlayer.enabled, true);
  assert.equal(loadConfig({ DEMO_MODE: '1' }).localPlayer.enabled, true);
  const field = SETTINGS_FIELDS.find((f) => f.key === 'LOCAL_NOW_PLAYING');
  assert.deepEqual(field.choices, ['off', 'on']);
  assert.equal(applyChanges({}, { values: { LOCAL_NOW_PLAYING: 'yes please' } }).errors.length, 1);
  assert.deepEqual(applyChanges({}, { values: { LOCAL_NOW_PLAYING: 'on' } }).settings, { LOCAL_NOW_PLAYING: 'on' });
});

test('route: off by default, and nothing is run', async (t) => {
  const base = await start(t, {});
  const r = await get(`${base}/api/local/now-playing`);
  assert.equal(r.status, 200);
  assert.equal(r.cache, 'no-store');
  assert.deepEqual(JSON.parse(r.body), { status: 'off', playing: null });
  assert.equal((await get(`${base}/api/local/art?k=abc`)).status, 404);
});

test('route: inside Docker it says so instead of trying', async (t) => {
  const config = baseConfig({ localPlayer: { enabled: true } });
  const base = await start(t, { config, inContainer: true });
  assert.equal(JSON.parse((await get(`${base}/api/local/now-playing`)).body).reason, 'not available inside Docker');
});

test('route: a playing song and its art, served by key, with the player link kept private', async (t) => {
  const link = 'https://music.example/rest/getCoverArt.view?u=someone&t=SECRETTOKEN';
  const playing = `({'Metadata': <{'xesam:title': <'Lantern <Static>'>, 'xesam:artist': <['The Paper Comets']>, 'mpris:artUrl': <'${link}'>}>, 'PlaybackStatus': <'Playing'>},)`;
  const run = async (cmd, args) => (args.includes('org.freedesktop.DBus.ListNames') ? "(['org.mpris.MediaPlayer2.Feishin'],)" : playing);
  let artFetches = 0;
  const fetchImpl = async (url) => {
    assert.equal(url, link, 'only the player’s own art link is fetched');
    artFetches++;
    return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  };
  const base = await start(t, { localPlayerFactory: () => createLocalPlayer({ enabled: true, platform: 'linux', run, fetchImpl }) });

  const r = await get(`${base}/api/local/now-playing`);
  const json = JSON.parse(r.body);
  assert.equal(json.playing.title, 'Lantern <Static>');
  assert.doesNotMatch(r.body.toString(), /SECRETTOKEN|someone|music\.example|getCoverArt/);
  assert.match(json.playing.art, /^\/api\/local\/art\?k=[0-9a-f]{20}$/);

  const art = await get(`${base}${json.playing.art}`);
  assert.equal(art.status, 200);
  assert.equal(art.type, 'image/png');
  assert.match(art.csp, /sandbox/);
  assert.match(art.cache, /^private/);
  assert.deepEqual(art.body, PNG);
  await get(`${base}${json.playing.art}`);
  assert.equal(artFetches, 1, 'the picture is fetched once per song');
  assert.equal((await get(`${base}/api/local/art?k=00000000000000000000`)).status, 404);
  assert.equal((await get(`${base}/api/local/art`)).status, 404);
});

test('route: a broken reader still answers 200', async (t) => {
  const broken = () => ({ read: async () => { throw new Error('boom'); }, art: async () => { throw new Error('boom'); } });
  const base = await start(t, { localPlayerFactory: broken });
  const r = await get(`${base}/api/local/now-playing`);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).status, 'error');
  assert.equal((await get(`${base}/api/local/art?k=1`)).status, 404);
});

test('route: demo mode makes up a song with placeholder art', async (t) => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const config = { ...loadConfig({ DEMO_MODE: '1', RSS_FEEDS: 'off' }), dataDir: dir };
  const base = await start(t, { config, localPlayerFactory: null });
  for (let i = 0; i < 10; i++) {
    const json = JSON.parse((await get(`${base}/api/local/now-playing`)).body);
    assert.ok(['ok', 'error'].includes(json.status));
    if (json.playing) assert.equal((await get(`${base}${json.playing.art}`)).status, 200);
  }
});

/* ------------------------------------------------------------ page */

const SONG = { title: 'Lantern Static', artist: 'The Paper Comets', album: 'Night Bus Atlas', player: 'Strawberry', playing: true, art: '/api/local/art?k=0123456789abcdef0123' };
const music = (nowPlaying = []) => ({ status: 'ok', data: { nowPlaying, stats: { tracksThisWeek: 3, minutesThisWeek: 12, exact: true }, recentlyPlayed: [], hasSongHistory: true } });

test('the Music card shows the song from this PC, with its art', () => {
  const html = localPlayingBlock({ status: 'ok', playing: SONG }, null);
  assert.match(html, /On this PC/);
  assert.match(html, /Strawberry/);
  assert.match(html, /Lantern Static/);
  assert.match(html, /src="\/api\/local\/art\?k=0123456789abcdef0123"/);
  assert.match(musicGlance('listenbrainz', music(), Date.now(), { status: 'ok', playing: SONG }), /local-playing/);
  assert.match(musicDetail('listenbrainz', music(), Date.now(), { status: 'ok', playing: SONG }), /local-playing-lg/);
  // Even when the music service isn't set up yet.
  assert.match(musicGlance('listenbrainz', { status: 'unconfigured' }, Date.now(), { status: 'ok', playing: SONG }), /Lantern Static/);
});

test('no line when nothing plays, when off, or when the service already shows that song', () => {
  for (const local of [null, { status: 'off', playing: null }, { status: 'ok', playing: null }, { status: 'error', playing: null }, { status: 'ok', playing: { title: '' } }]) {
    assert.equal(localPlayingBlock(local, null), '');
  }
  assert.equal(localPlayingBlock({ status: 'ok', playing: SONG }, { title: 'lantern static ', artist: 'The Paper Comets' }), '', 'Navidrome already shows it');
  assert.notEqual(localPlayingBlock({ status: 'ok', playing: SONG }, { title: 'Other', artist: 'Someone' }), '');
});

test('text from players is escaped and only pupboard picture addresses are used', () => {
  const evil = { title: '<img src=x onerror=alert(1)>', artist: '"><script>', album: '&', player: '<b>', art: 'https://evil.example/x.png' };
  const html = localPlayingBlock({ status: 'ok', playing: evil }, null);
  assert.doesNotMatch(html, /<img src=x|<script>|<b>|evil\.example/);
  assert.match(html, /&lt;img src=x/);
  for (const art of ['javascript:alert(1)', '/api/local/art?k=zz"onerror', '//evil.example/a', '/api/img/navidrome/x']) {
    assert.doesNotMatch(localPlayingBlock({ status: 'ok', playing: { ...SONG, art } }, null), /src="[^"]*(?:javascript|evil|zz|navidrome)/);
  }
  assert.match(localPlayingBlock({ status: 'ok', playing: { ...SONG, art: '/api/demo-art/local-1?w=160&h=160' } }, null), /src="\/api\/demo-art\/local-1\?w=160&amp;h=160"/);
});

test('overview and Music page pass the live song through', () => {
  const summary = { slots: { music: 'listenbrainz', media: 'deals' }, listenbrainz: music(), local: { status: 'ok', playing: SONG } };
  assert.match(overview(summary, Date.now()), /On this PC/);
  assert.match(ROUTES.music.render(summary, Date.now()), /On this PC/);
  assert.doesNotMatch(overview({ ...summary, local: undefined }, Date.now()), /On this PC/);
});

test('page: the live answer is merged in; junk leaves the summary alone', async () => {
  const s = { steam: {} };
  assert.deepEqual(mergeLocal(s, { status: 'ok', playing: SONG }).local, { status: 'ok', playing: SONG });
  assert.deepEqual(mergeLocal(s, { status: 'error', playing: SONG }).local, { status: 'error', playing: null });
  for (const junk of [null, 'x', 5, {}, { status: 3 }]) assert.equal(mergeLocal(s, junk), s);
  assert.equal(mergeLocal(null, { status: 'ok' }), null);
  assert.equal(await fetchLocalPlaying(100, async () => { throw new Error('down'); }), null);
  assert.equal(await fetchLocalPlaying(100, async () => new Response('x', { status: 500 })), null);
  assert.deepEqual(await fetchLocalPlaying(100, async () => Response.json({ status: 'off', playing: null })), { status: 'off', playing: null });
});
