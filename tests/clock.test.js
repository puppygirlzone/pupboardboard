// Clock: configurable time zone and 24-hour format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedParts, formatClock, formatLongDate, greeting } from '../public/js/format.js';
import { timeSlot, PUPPY_GREETINGS } from '../public/js/puppy.js';
import { eggGreeting } from '../public/js/eggs.js';
import { loadConfig, validTimeZone } from '../server/config.js';
import { createApp } from '../server/app.js';
import { tempDir, baseConfig, stubFetch } from './helpers.js';

const T = new Date('2026-11-12T04:35:00Z'); // 04:35 UTC = 13:35 Tokyo = 23:35 (11th) New York

test('time zone and 12/24-hour setting drive the clock, date and greetings', () => {
  {
    assert.deepEqual(zonedParts(T, 'UTC'), { year: 2026, month: 11, day: 12, hour: 4 });
    assert.deepEqual(zonedParts(T, 'Asia/Tokyo'), { year: 2026, month: 11, day: 12, hour: 13 });
    assert.deepEqual(zonedParts(T, 'America/New_York'), { year: 2026, month: 11, day: 11, hour: 23 });
    assert.deepEqual(zonedParts(new Date('2026-11-12T00:05:00Z'), 'UTC').hour, 0, 'midnight is 0, never 24');
  }
  {
    assert.equal(formatClock(new Date('2026-11-12T16:35:00Z'), { timeZone: 'UTC' }), '16:35');
    assert.equal(formatClock(new Date('2026-11-12T00:05:00Z'), { timeZone: 'UTC' }), '00:05');
    assert.match(formatClock(new Date('2026-11-12T16:35:00Z'), { timeZone: 'UTC', hour12: true }), /^0?4:35\s?PM$/i);
    assert.match(formatLongDate(T, { timeZone: 'America/New_York' }), /Wednesday/, 'date follows the zone');
  }
  {
    assert.equal(greeting(T, 'UTC'), 'Up late');
    assert.equal(greeting(T, 'Asia/Tokyo'), 'Good afternoon');
    assert.equal(greeting(T, 'America/New_York'), 'Good evening');
    assert.equal(timeSlot(T, 'Asia/Tokyo'), 'afternoon');
    assert.ok(PUPPY_GREETINGS.afternoon.includes(eggGreeting('puppy', T, 'Asia/Tokyo')));
    assert.ok(PUPPY_GREETINGS.evening.includes(eggGreeting('puppy', T, 'America/New_York')));
  }
});

test('TIME_ZONE settings reach the browser (Docker TZ fallback, bad names ignored)', async () => {
  {
    assert.equal(validTimeZone('Europe/London'), 'Europe/London');
    assert.equal(validTimeZone('Mars/Olympus'), null);
    assert.equal(validTimeZone(''), null);
    assert.deepEqual(loadConfig({}).display, { timeZone: null, hour12: false });
    assert.equal(loadConfig({ TZ: 'Asia/Tokyo' }).display.timeZone, 'Asia/Tokyo');
    assert.equal(loadConfig({ TIME_ZONE: 'Europe/Paris', TZ: 'Asia/Tokyo' }).display.timeZone, 'Europe/Paris');
    assert.equal(loadConfig({ TIME_ZONE: 'nope', TZ: 'Asia/Tokyo' }).display.timeZone, 'Asia/Tokyo');
    assert.equal(loadConfig({ CLOCK_FORMAT: '12h' }).display.hour12, true);
    assert.equal(loadConfig({ CLOCK_FORMAT: '24h' }).display.hour12, false);
  }
  {
    const { dir, cleanup } = await tempDir();
    const app = createApp({ config: { ...baseConfig({ dataDir: dir }), display: { timeZone: 'Asia/Tokyo', hour12: false } }, fetchImpl: stubFetch([]) });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    try {
      const body = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/display`)).json();
      assert.deepEqual(body, { timeZone: 'Asia/Tokyo', hour12: false });
    } finally {
      await new Promise((r) => app.server.close(r));
      await cleanup();
    }
  }
});

