import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { steamImageUrls, createImageWarmer } from '../public/js/images.js';
import { ROUTES } from '../public/js/views.js';

test('steamImageUrls finds the avatar and game art, deduped and capped', () => {
  const summary = {
    steam: {
      data: {
        profile: { avatar: 'https://avatars.steamstatic.com/a_full.jpg', name: 'pup' },
        games: [
          { name: 'A', icon: 'https://media.steampowered.com/x/1/a.jpg', header: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg' },
          { name: 'B', icon: 'https://media.steampowered.com/x/1/a.jpg', store: 'https://store.steampowered.com/app/2' },
        ],
      },
    },
    navidrome: { data: { cover: 'https://elsewhere/c.jpg' } },
  };
  assert.deepEqual(steamImageUrls(summary), [
    'https://avatars.steamstatic.com/a_full.jpg',
    'https://media.steampowered.com/x/1/a.jpg',
    'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg',
  ]);
  assert.deepEqual(steamImageUrls({ steam: { data: { games: [{ icon: '/api/demo-art/game-1?w=64&h=64' }, { x: '/api/summary' }, { y: '/etc/passwd.jpg' }] } } }), ['/api/demo-art/game-1?w=64&h=64']);
  const many = { steam: { data: { games: Array.from({ length: 200 }, (_, i) => ({ icon: `https://x/${i}.jpg` })) } } };
  assert.equal(steamImageUrls(many, 10).length, 10);
});

test('steamImageUrls ignores junk and non-http strings', () => {
  for (const s of [null, {}, { steam: null }, { steam: { data: 'x' } }, { steam: { data: { a: 'javascript:alert(1).jpg', b: 'data:image/png;base64,AA', c: 42 } } }]) {
    assert.deepEqual(steamImageUrls(s), []);
  }
});

test('the warmer holds each picture once and drops the oldest past its limit', () => {
  const made = [];
  const warmer = createImageWarmer({ max: 2, make: () => { const i = { decode: () => Promise.reject(new Error('x')) }; made.push(i); return i; } });
  warmer.warm(['a', 'b', 'a', '', null]);
  assert.equal(made.length, 2);
  assert.equal(made[0].src, 'a');
  warmer.warm(['c']);
  assert.equal(warmer.size, 2);
  assert.ok(!warmer.has('a') && warmer.has('b') && warmer.has('c'));
  assert.doesNotThrow(() => createImageWarmer({ make: () => { throw new Error('no Image'); } }).warm(['a']));
});

test('pictures load straight away and show a themed tile, not alt text, while loading', () => {
  const data = { period: { kind: 'week', label: 'Last 7 days', since: '' }, totalMinutes: 60, gamesPlayed: 1, minutes2Weeks: 60, games: [{ appid: 1, name: 'A', minutes: 60, minutes2Weeks: 60, minutesForever: 90, icon: 'https://media.steampowered.com/a.jpg', header: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg' }], player: { name: 'pup', status: 'Online', avatar: 'https://avatars.steamstatic.com/a.jpg' } };
  const html = ROUTES.gaming.render({ steam: { status: 'ok', data } }, Date.now());
  assert.match(html, /<img /);
  assert.ok(!html.includes('loading="lazy"'));
  const css = readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /img\[data-fallback\]\s*\{[^}]*color:\s*transparent/);
});
