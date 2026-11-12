// Puppy mode easter egg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PUPPY_KEY, PUPPY_GREETINGS, timeSlot, puppyGreeting, syncVerb, createSequenceDetector, createTapCounter, PAW_SVG } from '../public/js/puppy.js';
import { pawBurst, toastOut } from '../public/js/motion.js';

const at = (y, m, d, h) => new Date(y, m - 1, d, h, 30);

test('time slots match the normal greeting boundaries', () => {
  assert.equal(timeSlot(at(2026, 11, 12, 2)), 'night');
  assert.equal(timeSlot(at(2026, 11, 12, 5)), 'morning');
  assert.equal(timeSlot(at(2026, 11, 12, 12)), 'afternoon');
  assert.equal(timeSlot(at(2026, 11, 12, 18)), 'evening');
});

test('puppy greeting stays put all day, and changes across days', () => {
  const a = puppyGreeting(at(2026, 11, 12, 13));
  assert.ok(PUPPY_GREETINGS.afternoon.includes(a));
  assert.equal(puppyGreeting(at(2026, 11, 12, 16)), a, 'same line all afternoon');
  const week = new Set([12, 13, 14].map((d) => puppyGreeting(at(2026, 11, d, 13))));
  assert.equal(week.size, 3, 'three days, three different lines');
});

test('"Updated" becomes "Fetched" in puppy mode', () => {
  assert.equal(syncVerb(true), 'Fetched');
  assert.equal(syncVerb(false), 'Updated');
});

test('typing "woof" triggers, in any case; other keys reset it', () => {
  const press = createSequenceDetector();
  const type = (s) => [...s].map(press).some(Boolean);
  assert.equal(type('woo'), false);
  assert.equal(type('f'), true, 'woof');
  assert.equal(type('WOOF'), true, 'case-insensitive, and works again');
  assert.equal(type('wooxf'), false);
  assert.equal(type('wwoof'), true, 'extra leading letters are fine');
  assert.equal(press('Shift'), false, 'modifier names are ignored');
  assert.equal(type('wo'), false);
  press('ArrowUp'); // ignored, not a reset
  assert.equal(type('of'), true);
});

test('five quick taps trigger; slow taps do not', () => {
  let t = 0;
  const tap = createTapCounter(5, 2000, () => t);
  for (let i = 0; i < 4; i++) {
    assert.equal(tap(), false);
    t += 300;
  }
  assert.equal(tap(), true, '5th tap within 2s');
  const slow = createTapCounter(5, 2000, () => t);
  let fired = false;
  for (let i = 0; i < 6; i++) {
    fired ||= slow();
    t += 900;
  }
  assert.equal(fired, false);
});

test('saved before first paint: boot script reads the same key', async () => {
  const boot = await readFile(new URL('../public/js/theme-boot.js', import.meta.url), 'utf8');
  assert.ok(boot.includes(`'${PUPPY_KEY}'`));
  assert.match(boot, /setAttribute\('data-puppy', 'on'\)/);
  assert.match(PAW_SVG, /^<svg [^>]*aria-hidden="true"/);
});

test('effects without anime.js do nothing harmful', async () => {
  assert.doesNotThrow(() => pawBurst(null, PAW_SVG));
  assert.doesNotThrow(() => pawBurst({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) }, PAW_SVG));
  await toastOut({}); // resolves straight away
});
