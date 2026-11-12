// The /setup page: saved settings, their precedence, validation, and who may
// use the API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { readSettings, writeSettings, mergeSettings, describeSettings, applyChanges, settingsPath } from '../server/settings.js';
import { tempDir, stubFetch, json, NO_FEEDS_FILE } from './helpers.js';

const CODE = 'a'.repeat(32);

async function startSetupApp({ env = {}, demo = false } = {}) {
  const { dir, cleanup } = await tempDir();
  const fullEnv = { ...NO_FEEDS_FILE, RSS_FEEDS_FILE: path.join(dir, 'feeds.txt'), DATA_DIR: dir, ...env, ...(demo ? { DEMO_MODE: '1' } : {}) };
  const file = settingsPath(dir);
  const config = loadConfig(mergeSettings(fullEnv, readSettings(file)));
  const fetchImpl = stubFetch([[(u) => u.includes('nd.local'), () => json({ 'subsonic-response': { status: 'ok' } })]]);
  const app = createApp({ config, fetchImpl, retryDelayMs: 0, setup: { code: CODE, env: fullEnv, file } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = (init = {}) => fetch(`${base}/api/setup`, { ...init, headers: { 'x-setup-code': CODE, ...(init.headers ?? {}) } });
  const post = (body, headers = {}) => call({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return {
    app,
    dir,
    file,
    config,
    base,
    port,
    call,
    post,
    stop: async () => {
      await new Promise((r) => app.server.close(r));
      await cleanup();
    },
  };
}

/* ------------------------------------------------------------ pure parts */

test('settings file: junk, unknown keys and non-strings are ignored', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, 'settings.json');
    assert.deepEqual(readSettings(file), {}, 'missing file');
    await writeFile(file, '{not json');
    assert.deepEqual(readSettings(file), {}, 'corrupt file');
    await writeFile(file, JSON.stringify({ STEAM_ID: '12345678901234567', EVIL: 'x', JELLYFIN_URL: 42 }));
    assert.deepEqual(readSettings(file), { STEAM_ID: '12345678901234567' });
  } finally {
    await cleanup();
  }
});

test('settings file is written owner-only', { skip: process.platform === 'win32' }, async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, 'sub', 'settings.json');
    await writeSettings(file, { STEAM_API_KEY: 'k' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(readSettings(file), { STEAM_API_KEY: 'k' });
  } finally {
    await cleanup();
  }
});

test('settings: environment wins, secrets never shown, validation and link clean-up', () => {
  {
    const merged = mergeSettings({ STEAM_ID: '11111111111111111', JELLYFIN_URL: '  ' }, { STEAM_ID: '22222222222222222', JELLYFIN_URL: 'http://jf' });
    assert.equal(merged.STEAM_ID, '11111111111111111');
    assert.equal(merged.JELLYFIN_URL, 'http://jf', 'blank env values do not count');
  }
  {
    const fields = describeSettings({ NAVIDROME_PASSWORD: 'envpw' }, { STEAM_API_KEY: 'SECRET', STEAM_ID: '12345678901234567' });
    const by = Object.fromEntries(fields.map((f) => [f.key, f]));
    assert.ok(!JSON.stringify(fields).includes('SECRET') && !JSON.stringify(fields).includes('envpw'));
    assert.equal(by.STEAM_API_KEY.isSet, true);
    assert.equal(by.STEAM_ID.value, '12345678901234567');
    assert.equal(by.NAVIDROME_PASSWORD.locked, true);
    assert.equal(by.JELLYFIN_API_KEY.isSet, false);
  }
  {
    const saved = { STEAM_API_KEY: 'old', JELLYFIN_API_KEY: 'jf' };
    const ok = applyChanges(saved, {
      values: { STEAM_API_KEY: '', STEAM_ID: ' 76561198000000000 ', NAVIDROME_URL: 'http://nd.local:4533///', TIME_ZONE: 'Europe/London', HOST: '0.0.0.0', BOGUS: 'x', JELLYFIN_URL: 'http://locked' },
      clear: ['JELLYFIN_API_KEY', 'BOGUS'],
    }, { JELLYFIN_URL: 'http://from-env' });
    assert.deepEqual(ok.errors, []);
    assert.deepEqual(ok.settings, { STEAM_API_KEY: 'old', STEAM_ID: '76561198000000000', NAVIDROME_URL: 'http://nd.local:4533', TIME_ZONE: 'Europe/London', HOST: '0.0.0.0' });

    const bad = applyChanges({}, {
      values: { STEAM_ID: 'not a profile!', NAVIDROME_URL: 'javascript:alert(1)', JELLYFIN_URL: 'http://user:pw@host', TIME_ZONE: 'Mars/Base', CLOCK_FORMAT: '13h', NAVIDROME_USER: 'a\nb', HOST: '8.8.8.8', STEAM_API_KEY: 7 },
    });
    assert.deepEqual(bad.errors.map((e) => e.key).sort(), ['CLOCK_FORMAT', 'HOST', 'JELLYFIN_URL', 'NAVIDROME_URL', 'NAVIDROME_USER', 'STEAM_API_KEY', 'STEAM_ID', 'TIME_ZONE']);
    for (const junk of [null, 'x', { values: 'x' }, { values: null, clear: 'x' }]) assert.deepEqual(applyChanges({ A: 1 }, junk).errors, []);
  }
});

/* ------------------------------------------------------------ the API */

test('setup API: saves, applies without a restart, and never returns secrets', async () => {
  const s = await startSetupApp();
  try {
    const before = await (await s.call()).json();
    assert.equal(before.feeds.exists, false);
    assert.match(before.feeds.text, /Steam News \| https:\/\/store\.steampowered\.com\/feeds\/news\/app\/593110\//, 'shows the default feeds when there is no file');

    const res = await s.post({
      values: { NAVIDROME_URL: 'http://nd.local', NAVIDROME_USER: 'me', NAVIDROME_PASSWORD: 'hunter2', CLOCK_FORMAT: '12h' },
      feeds: 'Mine | https://example.com/feed.xml',
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);

    const saved = JSON.parse(await readFile(s.file, 'utf8'));
    assert.equal(saved.NAVIDROME_PASSWORD, 'hunter2');
    assert.equal(await readFile(path.join(s.dir, 'feeds.txt'), 'utf8'), 'Mine | https://example.com/feed.xml\n');

    // Applied live: the source is configured, the clock setting changed.
    assert.equal(s.config.navidrome.user, 'me');
    assert.equal(s.app.sources.navidrome.peek().status === 'unconfigured', false);
    assert.equal((await (await fetch(`${s.base}/api/display`)).json()).hour12, true);
    assert.deepEqual(s.config.rss.list().feeds, [{ name: 'Mine', url: 'https://example.com/feed.xml' }]);

    const after = await s.call();
    const text = await after.text();
    assert.ok(!text.includes('hunter2'), 'password never sent back');
    assert.equal(JSON.parse(text).fields.find((f) => f.key === 'NAVIDROME_PASSWORD').isSet, true);
  } finally {
    await s.stop();
  }
});

test('setup API: validation errors save nothing', async () => {
  const s = await startSetupApp();
  try {
    const res = await s.post({ values: { STEAM_ID: 'not a profile!', NAVIDROME_USER: 'me' } });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).errors[0].key, 'STEAM_ID');
    assert.deepEqual(readSettings(s.file), {});
    assert.equal((await s.post({ feeds: 'x'.repeat(30_000) })).status, 400, 'feed list too long');
  } finally {
    await s.stop();
  }
});

test('setup API: refuses without the code, from other hosts or origins, and odd requests', async () => {
  const s = await startSetupApp();
  try {
    const noCode = await fetch(`${s.base}/api/setup`);
    assert.equal(noCode.status, 403);
    assert.equal((await noCode.json()).error, 'code');
    assert.equal((await s.call({ headers: { 'x-setup-code': 'b'.repeat(32) } })).status, 403, 'wrong code');
    assert.equal((await s.call({ headers: { 'x-setup-code': 'short' } })).status, 403, 'wrong length');

    // DNS rebinding: right socket address, but a foreign Host header.
    const http = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: s.port, path: '/api/setup', headers: { host: 'evil.example:80', 'x-setup-code': CODE } }, (r) => {
        r.resume();
        resolve(r.statusCode);
      }).on('error', reject);
    });
    assert.equal(status, 403, 'foreign Host header refused');

    assert.equal((await s.post({}, { origin: 'http://evil.example' })).status, 403, 'cross-origin POST refused');
    assert.equal((await s.call({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415, 'form posts refused');
    assert.equal((await s.call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status, 400);
    assert.equal((await s.call({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feeds: 'x'.repeat(70_000) }) })).status, 413);
    assert.equal((await s.call({ method: 'DELETE' })).status, 405);
    assert.deepEqual(readSettings(s.file), {}, 'nothing was saved');
  } finally {
    await s.stop();
  }
});

test('setup API: off in demo mode, with SETUP_PAGE=0, and when no setup is given', async () => {
  for (const opts of [{ demo: true }, { env: { SETUP_PAGE: '0' } }]) {
    const s = await startSetupApp(opts);
    try {
      const res = await s.call();
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error, opts.demo ? 'demo' : 'disabled');
    } finally {
      await s.stop();
    }
  }
  const { dir, cleanup } = await tempDir();
  const app = createApp({ config: { ...loadConfig(NO_FEEDS_FILE), dataDir: dir }, fetchImpl: stubFetch([]) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${app.server.address().port}/api/setup`, { headers: { 'x-setup-code': CODE } });
    assert.equal(res.status, 403);
  } finally {
    await new Promise((r) => app.server.close(r));
    await cleanup();
  }
});

test('setup page loads with the strict CSP and no inline script', async () => {
  const s = await startSetupApp();
  try {
    const res = await fetch(`${s.base}/setup.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await res.text();
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline <script>');
    assert.ok(!/\sstyle=/i.test(html), 'no style attributes');
    assert.equal((await fetch(`${s.base}/js/setup.js`)).status, 200);
  } finally {
    await s.stop();
  }
});

test('listening address: HOST, then saved/launcher default, then all interfaces', () => {
  assert.equal(loadConfig({ ...NO_FEEDS_FILE }).host, '0.0.0.0', 'Docker and npm start keep LAN access');
  assert.equal(loadConfig({ ...NO_FEEDS_FILE, DEFAULT_HOST: '127.0.0.1' }).host, '127.0.0.1', 'launchers stay local');
  assert.equal(loadConfig(mergeSettings({ ...NO_FEEDS_FILE, DEFAULT_HOST: '127.0.0.1' }, { HOST: '0.0.0.0' })).host, '0.0.0.0', 'setup page can open it up');
  assert.equal(loadConfig(mergeSettings({ ...NO_FEEDS_FILE, HOST: '::' }, { HOST: '0.0.0.0' })).host, '::', 'env wins');
});
