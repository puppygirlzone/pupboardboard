// Easter eggs: secret words, greetings, floaters and Aiko mode's Japanese.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EGGS, EGG_NAMES, EGG_KEY, ICONS, eggForWord, validEgg, eggToast, eggGreeting, eggVerb, createWordDetector, floaterIcons } from '../public/js/eggs.js';
import { translate, japaneseCharacters } from '../public/js/i18n-ja.js';
import { PUPPY_KEY } from '../public/js/puppy.js';

const at = (y, m, d, h) => new Date(y, m - 1, d, h, 30);

test('every secret word maps to its mode, in any case', () => {
  assert.equal(eggForWord('woof'), 'puppy');
  assert.equal(eggForWord(' AIKO '), 'aiko');
  assert.equal(eggForWord('Cheese'), 'cheese');
  assert.equal(eggForWord('luna'), 'luna');
  assert.equal(eggForWord('bird'), 'bird');
  assert.equal(eggForWord('clanker'), 'bird');
  assert.equal(eggForWord('nope'), null);
  assert.equal(validEgg('luna'), 'luna');
  assert.equal(validEgg('__proto__'), null);
  assert.equal(EGG_KEY, PUPPY_KEY.replace(/puppy$/, 'egg'));
});

test('typing a word anywhere triggers its mode; other keys never do', () => {
  const press = createWordDetector();
  const type = (s) => [...s].map((k) => press(k)).filter(Boolean);
  assert.deepEqual(type('hello aiko'), ['aiko']);
  assert.deepEqual(type('xxclankerxx'), ['bird']);
  assert.deepEqual(type('cheesecake'), ['cheese']);
  assert.deepEqual(type('wo of'), []);
  assert.equal(press('Shift'), null);
  assert.deepEqual(type('LUNA'), ['luna']);
});

test('each mode has greetings for every time of day, steady all day', () => {
  for (const name of EGG_NAMES) {
    for (const slot of ['night', 'morning', 'afternoon', 'evening']) assert.ok(EGGS[name].greetings[slot].length >= 3, `${name} ${slot}`);
    const a = eggGreeting(name, at(2026, 11, 12, 13));
    assert.equal(eggGreeting(name, at(2026, 11, 12, 16)), a, `${name}: same line all afternoon`);
  }
  assert.equal(eggGreeting(null, at(2026, 11, 12, 13)), null);
  assert.match(eggGreeting('aiko', at(2026, 11, 12, 9)), /[぀-ヿ一-鿿]/, 'Aiko greets in Japanese');
  assert.match(eggGreeting('bird', at(2026, 11, 12, 9)), /good boy/i);
  for (const line of Object.values(EGGS.luna.greetings).flat()) assert.ok(!/pup|woof|paw/i.test(line), `Luna has no puppy wording: ${line}`);
  assert.equal(eggVerb('puppy'), 'Fetched');
  assert.equal(eggVerb(null), 'Updated');
  assert.match(eggToast('cheese', true), /cheese again/);
  assert.match(eggToast('aiko', true), /アイコ/);
});

test('floaters: each mode its own icon; Luna sometimes gets one British flag', () => {
  assert.deepEqual([...new Set(floaterIcons('aiko'))], ['gun']);
  assert.deepEqual([...new Set(floaterIcons('cheese'))], ['cheese']);
  assert.deepEqual([...new Set(floaterIcons('bird'))], ['visor']);
  const always = floaterIcons('luna', () => 0.1);
  assert.equal(always.filter((i) => i === 'flag').length, 1);
  assert.equal(always.length, 12);
  assert.deepEqual([...new Set(floaterIcons('luna', () => 0.9))], ['moon'], 'usually just moons');
  assert.deepEqual(floaterIcons(null), []);
  for (const name of EGG_NAMES) assert.match(ICONS[EGGS[name].icon], /^<svg [^>]*aria-hidden="true"/);
  for (const svg of Object.values(ICONS)) assert.ok(!/style=|<script|on\w+=/.test(svg), 'CSP-safe icons');
});

test('Aiko mode: interface text in Japanese, names and unknown text untouched', () => {
  assert.equal(translate('Overview'), '概要');
  assert.equal(translate('  Tracks this week '), '  今週の再生曲数 ');
  assert.equal(translate('3h ago'), '3時間前');
  assert.equal(translate('Live · 5m ago'), 'ライブ · 5分前');
  assert.equal(translate('Updated just now'), 'たった今に更新');
  assert.equal(translate('(7 tracks)'), '（7曲）');
  assert.equal(translate('Gaming isn\'t connected yet.'), 'ゲームはまだ接続されていません。');
  assert.equal(translate('Playing Starfall Drifters'), 'Starfall Driftersをプレイ中');
  assert.equal(translate('Starfall Drifters'), 'Starfall Drifters');
  assert.equal(translate(''), '');
  assert.equal(translate(' movies · '), ' 映画 · ');
  assert.equal(translate('2000 · 7h ago'), '2000 · 7時間前');
  assert.equal(translate('Now playing · demo'), '再生中 · demo');
});

test('the Japanese font subset covers every character the translations use', async () => {
  const font = await readFile(new URL('../public/fonts/noto-sans-jp/NotoSansJP-pupboard.woff2', import.meta.url));
  assert.equal(font.subarray(0, 4).toString('latin1'), 'wOF2');
  assert.ok(font.length < 400_000, `font stays small (${font.length} bytes)`);
  const chars = japaneseCharacters([...Object.values(EGGS.aiko.greetings).flat(), EGGS.aiko.on, EGGS.aiko.off].join(''));
  const covered = await readFile(new URL('../public/fonts/noto-sans-jp/characters.txt', import.meta.url), 'utf8');
  const missing = [...chars].filter((c) => !covered.includes(c));
  assert.deepEqual(missing, [], 'rebuild the font subset (see public/fonts/noto-sans-jp/README.txt)');
  await readFile(new URL('../public/fonts/noto-sans-jp/LICENSE.txt', import.meta.url));
});

test('boot script restores any mode before first paint, and only known ones', async () => {
  const boot = await readFile(new URL('../public/js/theme-boot.js', import.meta.url), 'utf8');
  assert.ok(boot.includes(`'${EGG_KEY}'`));
  assert.match(boot, /\^\(puppy\|aiko\|cheese\|luna\|bird\)\$/);
  for (const name of EGG_NAMES) assert.ok(boot.includes(name), name);
});
