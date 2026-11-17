import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGVariant,
  parseMprisNames,
  parseMprisPlayer,
  parseWindowsSessions,
  playerName,
  windowsAppName,
  pickPlaying,
  createLocalPlayer,
  createDemoLocalPlayer,
  windowsCommand,
  publicTrack,
  artKey,
  artRef,
  sniffImage,
  loadArt,
} from '../server/sources/local-player.js';
import { writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tempDir } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
/** createLocalPlayer(...).read, for tests that only read. */
const reader = (opts) => createLocalPlayer(opts).read;

// Shaped like real `gdbus` output from a Navidrome client (made-up values).
// Its art link carries a login token, which must never come out the other end.
const FEISHIN = `({'CanControl': <true>, 'CanPause': <true>, 'Metadata': <{'mpris:artUrl': <'https://music.example/rest/getCoverArt.view?id=abc&u=someone&s=5a1t&t=SECRETTOKEN&size=300'>, 'mpris:length': <int64 395720000>, 'mpris:trackid': <objectpath '/org/node/mediaplayer/Feishin/track/abc'>, 'xesam:album': <'Night Bus Atlas'>, 'xesam:albumArtist': <['The Paper Comets']>, 'xesam:artist': <['The Paper Comets', 'Guest']>, 'xesam:discNumber': <1.0>, 'xesam:genre': <['Indie']>, 'xesam:title': <'Lantern Static'>, 'xesam:useCount': <22.0>}>, 'MaximumRate': <1.0>, 'Volume': <0.22>, 'Position': <int64 177406259>, 'LoopStatus': <'Playlist'>, 'PlaybackStatus': <'Playing'>},)\n`;
const NAMES = `(['org.freedesktop.DBus', ':1.5', 'org.mpris.MediaPlayer2.Feishin', 'org.mpris.MediaPlayer2.vlc.instance4242', 'org.gnome.Shell'],)\n`;
const PAUSED = `({'Metadata': <{'xesam:title': <'Kettle Song'>, 'xesam:artist': <['Mossgrove']>}>, 'PlaybackStatus': <'Paused'>},)`;

test('parseGVariant reads the gdbus text format', () => {
  assert.deepEqual(parseGVariant("(<'Feishin'>,)"), ['Feishin']);
  assert.deepEqual(parseGVariant('([1, -2, 3.5], true, false, nothing)'), [[1, -2, 3.5], true, false, null]);
  assert.deepEqual(parseGVariant("{'a': <int64 5>, 'b': <@as []>, 'c': <objectpath '/x'>}"), { a: 5, b: [], c: '/x' });
  assert.deepEqual(parseGVariant(`('it\\'s', "say \\"hi\\"", 'caf\\u00e9', 'tab\\there')`), ["it's", 'say "hi"', 'café', 'tab\there']);
  assert.deepEqual(parseGVariant('()'), []);
});

test('parseGVariant refuses malformed or hostile input quickly', () => {
  const bad = ["('unclosed", '({', '(1 2)', "('a',) junk", '<', '@as', `${'('.repeat(5000)}1${')'.repeat(5000)}`, 'x'.repeat(300_000), "('\\u12')"];
  for (const input of bad) {
    const t0 = performance.now();
    assert.throws(() => parseGVariant(input), undefined, JSON.stringify(input.slice(0, 20)));
    assert.ok(performance.now() - t0 < 200, 'fails fast');
  }
  // A long but valid list is read in one pass.
  const big = `([${Array.from({ length: 20_000 }, (_, i) => `'s${i}'`).join(', ')}],)`;
  const t0 = performance.now();
  assert.equal(parseGVariant(big)[0].length, 20_000);
  assert.ok(performance.now() - t0 < 500);
});

test('MPRIS names: only media players, capped', () => {
  assert.deepEqual(parseMprisNames(NAMES), ['org.mpris.MediaPlayer2.Feishin', 'org.mpris.MediaPlayer2.vlc.instance4242']);
  const many = `([${Array.from({ length: 30 }, (_, i) => `'org.mpris.MediaPlayer2.p${i}'`).join(', ')}],)`;
  assert.equal(parseMprisNames(many).length, 8);
  assert.deepEqual(parseMprisNames("(['org.mpris.MediaPlayer2.bad name;rm'],)"), []);
  assert.equal(playerName('org.mpris.MediaPlayer2.vlc.instance4242'), 'vlc');
  assert.equal(playerName('org.mpris.MediaPlayer2.Feishin'), 'Feishin');
});

test('an MPRIS player becomes title, artist, album and player; its art link stays on the server', () => {
  const t = parseMprisPlayer(FEISHIN, 'org.mpris.MediaPlayer2.Feishin');
  assert.equal(t.artRef, 'https://music.example/rest/getCoverArt.view?id=abc&u=someone&s=5a1t&t=SECRETTOKEN&size=300');
  const shown = publicTrack(t);
  assert.deepEqual(shown, { title: 'Lantern Static', artist: 'The Paper Comets, Guest', album: 'Night Bus Atlas', player: 'Feishin', playing: true, seconds: 396, art: `/api/local/art?k=${artKey(t.artRef)}` });
  assert.doesNotMatch(JSON.stringify(shown), /SECRETTOKEN|getCoverArt|someone|music\.example/);
  assert.match(artKey(t.artRef), /^[0-9a-f]{20}$/);
  assert.equal(parseMprisPlayer(PAUSED, 'org.mpris.MediaPlayer2.x').playing, false);
  // No title, or junk metadata: nothing to show.
  assert.equal(parseMprisPlayer("({'PlaybackStatus': <'Playing'>},)", 'org.mpris.MediaPlayer2.x'), null);
  assert.equal(parseMprisPlayer("({'Metadata': <[1, 2]>},)", 'org.mpris.MediaPlayer2.x'), null);
  assert.equal(parseMprisPlayer("('weird',)", 'org.mpris.MediaPlayer2.x'), null);
});

test('text from players is cleaned: control characters removed, long text cut', () => {
  const evil = `({'Metadata': <{'xesam:title': <'${'A'.repeat(1000)}'>, 'xesam:artist': <['bad\\u0007bell\\nline']>}>, 'PlaybackStatus': <'Playing'>},)`;
  const t = parseMprisPlayer(evil, 'org.mpris.MediaPlayer2.x');
  assert.equal(t.title.length, 300);
  assert.equal(t.artist, 'bad bell line');
});

test('Windows: the PowerShell JSON becomes the same shape', () => {
  const json = JSON.stringify([
    { app: 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic', status: 'Paused', title: 'Kettle Song', artist: 'Mossgrove', album: 'Small Kitchens' },
    { app: 'Spotify.exe', status: 'Playing', title: 'Overpass Bloom', artist: 'Juniper Vale', album: '' },
  ]);
  const list = parseWindowsSessions(json);
  assert.equal(list.length, 2);
  assert.deepEqual(pickPlaying(list), { title: 'Overpass Bloom', artist: 'Juniper Vale', album: '', player: 'Spotify', playing: true });
  assert.equal(parseWindowsSessions(JSON.stringify({ app: 'x', status: 'Playing', title: 'One' }))[0].title, 'One', 'a single session is an object, not a list');
  assert.deepEqual(parseWindowsSessions(''), []);
  assert.deepEqual(parseWindowsSessions('[null, 5, "x", {"title": ""}]'), []);
  assert.throws(() => parseWindowsSessions('not json'));
  assert.equal(windowsAppName('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic'), 'Microsoft.ZuneMusic');
  const [cmd, args] = windowsCommand();
  assert.equal(cmd, 'powershell.exe');
  assert.ok(args.includes('-EncodedCommand') && !args.some((a) => /\s/.test(a)), 'script is passed encoded, never through a shell');
});

/** A fake `run` answering like gdbus. */
function fakeGdbus(players, calls = []) {
  return async (cmd, args) => {
    calls.push([cmd, ...args]);
    assert.equal(cmd, 'gdbus');
    const dest = args[args.indexOf('--dest') + 1];
    if (dest === 'org.freedesktop.DBus') return `([${Object.keys(players).map((n) => `'${n}'`).join(', ')}],)`;
    const out = players[dest];
    if (out instanceof Error) throw out;
    return out;
  };
}

test('Linux: the playing player wins, a broken one is skipped', async () => {
  const calls = [];
  const read = reader({
    enabled: true,
    platform: 'linux',
    run: fakeGdbus({ 'org.mpris.MediaPlayer2.vlc': PAUSED, 'org.mpris.MediaPlayer2.broken': new Error('stuck'), 'org.mpris.MediaPlayer2.Feishin': FEISHIN }, calls),
  });
  const r = await read();
  assert.equal(r.status, 'ok');
  assert.equal(r.playing.title, 'Lantern Static');
  assert.ok(calls.every((c) => c[0] === 'gdbus' && c.includes('--session')));
});

test('Linux: nothing playing means no line, not an error', async () => {
  const read = reader({ enabled: true, platform: 'linux', run: fakeGdbus({ 'org.mpris.MediaPlayer2.vlc': PAUSED }) });
  assert.deepEqual(await read(), { status: 'ok', playing: null });
  const none = reader({ enabled: true, platform: 'linux', run: fakeGdbus({}) });
  assert.deepEqual(await none(), { status: 'ok', playing: null });
});

test('missing command, hang, junk: a calm status, never a throw', async () => {
  const enoent = Object.assign(new Error('spawn gdbus ENOENT'), { code: 'ENOENT' });
  assert.equal((await reader({ enabled: true, platform: 'linux', run: async () => { throw enoent; } })()).status, 'unavailable');
  assert.equal((await reader({ enabled: true, platform: 'win32', run: async () => { throw enoent; } })()).reason, 'PowerShell was not found');
  const hang = await reader({ enabled: true, platform: 'linux', run: async () => { throw Object.assign(new Error('timeout'), { killed: true }); } })();
  assert.deepEqual(hang, { status: 'error', playing: null, reason: 'the player took too long to answer' });
  assert.equal((await reader({ enabled: true, platform: 'linux', run: async () => 'garbage(' })()).status, 'error');
  assert.equal((await reader({ enabled: true, platform: 'win32', run: async () => '{oops' })()).status, 'error');
});

test('off, in a container, or on another system: nothing is run', async () => {
  const run = async () => assert.fail('should not run anything');
  assert.deepEqual(await reader({ enabled: false, platform: 'linux', run })(), { status: 'off', playing: null });
  assert.equal((await reader({ enabled: true, platform: 'linux', inContainer: true, run })()).reason, 'not available inside Docker');
  assert.equal((await reader({ enabled: true, platform: 'darwin', run })()).status, 'unavailable');
});

test('readings close together are shared, so many tabs start one process', async () => {
  let t = 0;
  let listCalls = 0;
  const base = fakeGdbus({ 'org.mpris.MediaPlayer2.Feishin': FEISHIN });
  const run = async (cmd, args) => {
    if (args.includes('org.freedesktop.DBus.ListNames')) listCalls++;
    return base(cmd, args);
  };
  const read = reader({ enabled: true, platform: 'linux', run, now: () => t, minAgeMs: 1500 });
  await Promise.all([read(), read(), read()]);
  await read();
  assert.equal(listCalls, 1);
  t = 2000;
  await read();
  assert.equal(listCalls, 2);
});

test('the real command runner refuses to run forever or flood memory', async () => {
  const { runCommand } = await import('../server/sources/local-player.js');
  await assert.rejects(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], 200), (err) => err.killed === true);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(400000))'], 5000));
  assert.equal((await runCommand(process.execPath, ['-e', 'process.stdout.write("hi")'], 5000)), 'hi');
});

test('demo player: invented songs, sometimes nothing, sometimes a failure', async () => {
  const at = (r) => createDemoLocalPlayer({ now: () => 0, random: () => r }).read();
  assert.equal((await at(0.1)).status, 'error');
  assert.equal((await at(0.2)).playing, null);
  assert.equal((await at(0.9)).playing.title, 'Lantern Static');
  assert.match((await at(0.9)).playing.art, /^\/api\/demo-art\/local-0\?/);
});

test('art links: only local files, web addresses and inline pictures are kept', () => {
  for (const ok of ['file:///home/me/.cache/art/a.jpg', 'https://i.scdn.co/image/ab', 'http://192.168.1.5/cover.png', 'data:image/png;base64,iVBOR']) assert.equal(artRef(ok), ok);
  for (const bad of ['', 'file://otherhost/x.jpg', 'javascript:alert(1)', 'ftp://x/y.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', '/etc/passwd', `https://x/${'a'.repeat(5000)}`, 42, null]) assert.equal(artRef(bad), null, String(bad).slice(0, 40));
});

test('pictures are recognised by their bytes, never by name', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a......')), 'image/gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----')), null);
  assert.equal(sniffImage(Buffer.alloc(3)), null);
});

test('local album art: a real picture file is served; anything else is refused', async (t) => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const cover = path.join(dir, 'cover.jpg');
  await writeFile(cover, JPEG);
  const fake = path.join(dir, 'secret.jpg');
  await writeFile(fake, 'not a picture, maybe a private key');
  const big = path.join(dir, 'huge.png');
  await writeFile(big, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
  await symlink(fake, path.join(dir, 'link.jpg'));

  assert.deepEqual(await loadArt(pathToFileURL(cover).href), { type: 'image/jpeg', body: JPEG });
  assert.equal(await loadArt(pathToFileURL(fake).href), null, 'named .jpg but not an image');
  assert.equal(await loadArt(pathToFileURL(big).href), null, 'too big');
  assert.equal(await loadArt(pathToFileURL(path.join(dir, 'link.jpg')).href), null, 'a link to a non-image');
  assert.equal(await loadArt(pathToFileURL(dir).href), null, 'a folder');
  assert.equal(await loadArt(pathToFileURL(path.join(dir, 'missing.jpg')).href), null);
  assert.deepEqual(await loadArt(`base64:${PNG.toString('base64')}`), { type: 'image/png', body: PNG });
  assert.deepEqual(await loadArt(`data:image/png;base64,${PNG.toString('base64')}`), { type: 'image/png', body: PNG });
});

test('web album art: fetched with a cap; failures and non-images give no picture', async () => {
  const respond = (body, status = 200) => async () => new Response(body, { status });
  assert.equal((await loadArt('https://art.example/a', { fetchImpl: respond(JPEG) })).type, 'image/jpeg');
  assert.equal(await loadArt('https://art.example/a', { fetchImpl: respond('<html>login</html>') }), null);
  assert.equal(await loadArt('https://art.example/a', { fetchImpl: respond(JPEG, 404) }), null);
  assert.equal(await loadArt('https://art.example/a', { fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await loadArt('https://art.example/a', { fetchImpl: respond(Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)])) }), null);
});

test('art(key) serves only the current song, once per picture', async (t) => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const cover = path.join(dir, 'c.png');
  await writeFile(cover, PNG);
  const url = pathToFileURL(cover).href;
  const playing = `({'Metadata': <{'xesam:title': <'Song'>, 'mpris:artUrl': <'${url}'>}>, 'PlaybackStatus': <'Playing'>},)`;
  const lp = createLocalPlayer({ enabled: true, platform: 'linux', run: fakeGdbus({ 'org.mpris.MediaPlayer2.x': playing }) });
  assert.equal(await lp.art(artKey(url)), null, 'nothing read yet');
  const r = await lp.read();
  assert.doesNotMatch(JSON.stringify(r), /file:|c\.png/);
  const key = new URL(r.playing.art, 'http://x').searchParams.get('k');
  assert.deepEqual(await lp.art(key), { type: 'image/png', body: PNG });
  assert.equal(await lp.art('0'.repeat(20)), null, 'any other key');
  assert.equal(await lp.art(undefined), null);
  // Off: never serves anything.
  assert.equal(await createLocalPlayer({ enabled: false }).art(key), null);
});

test('Windows: a picture sent by PowerShell is kept server-side too', () => {
  const [t] = parseWindowsSessions(JSON.stringify([{ app: 'Spotify.exe', status: 'Playing', title: 'A', art: PNG.toString('base64') }]));
  assert.equal(t.artRef, `base64:${PNG.toString('base64')}`);
  assert.doesNotMatch(JSON.stringify(publicTrack(t)), /iVBOR|base64/);
  assert.equal(parseWindowsSessions(JSON.stringify([{ status: 'Playing', title: 'A', art: 'not base64!!' }]))[0].artRef, undefined);
});
