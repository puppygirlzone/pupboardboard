// Animations must never leave the page half-drawn. Without anime.js (failed
// to load, or reduced motion), every motion function applies the final state.
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { enter, refresh, leave, moveNavIndicator, pulse, spin } from '../public/js/motion.js';
import { steamDetail, donutSlices } from '../public/js/views.js';

/** Tiny fake element: just enough DOM for motion.js. */
function el(props = {}) {
  return { style: {}, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelectorAll: () => [], querySelector: () => null, ...props };
}

test('enter/refresh without anime.js: bars at full size, page visible', () => {
  const bars = [el({ dataset: { bar: '0.5' } }), el({ dataset: { bar: '1.000' } })];
  const root = el({ style: { opacity: '0', transform: 'translateY(-10px)' }, querySelectorAll: (sel) => (sel === '[data-bar]' ? bars : []) });
  enter(root);
  assert.equal(root.style.opacity, '', 'leftover fade-out cleared');
  assert.equal(root.style.transform, '');
  assert.deepEqual(bars.map((b) => b.style.transform), ['scaleX(0.5)', 'scaleX(1.000)']);
  bars.forEach((b) => (b.style.transform = ''));
  refresh(root);
  assert.equal(bars[0].style.transform, 'scaleX(0.5)');
});

test('leave without anime.js resolves straight away', async () => {
  const t0 = Date.now();
  await leave(el());
  assert.ok(Date.now() - t0 < 50);
});

test('nav highlight jumps to the active link without anime.js', () => {
  const pill = el();
  const link = el({ offsetLeft: 120, offsetWidth: 80 });
  const nav = el({ querySelector: (sel) => (sel === '.nav-indicator' ? pill : sel === 'a.active' ? link : null) });
  moveNavIndicator(nav);
  assert.equal(pill.style.transform, 'translateX(120px)');
  assert.equal(pill.style.width, '80px');
  assert.equal(pill.style.opacity, '1');
  moveNavIndicator(el({ querySelector: (sel) => (sel === '.nav-indicator' ? pill : null) }));
  assert.equal(pill.style.opacity, '0', 'hidden when no link is active');
});

test('small effects are harmless no-ops without anime.js', () => {
  assert.doesNotThrow(() => pulse(el()));
  assert.doesNotThrow(() => spin(el()));
  assert.doesNotThrow(() => pulse(null));
});

test('donut slices: percentages add to 100, extra games go to Other', () => {
  const games = [60, 30, 20, 10, 10, 5, 5].map((m, i) => ({ name: `G${i}`, minutes: m }));
  const d = donutSlices(games);
  assert.equal(d.total, 140);
  assert.equal(d.slices.length, 6);
  assert.equal(d.slices.at(-1).label, 'Other');
  assert.equal(d.slices.at(-1).minutes, 10);
  assert.ok(Math.abs(d.slices.reduce((s, x) => s + x.pct, 0) - 100) < 1e-9);
  assert.equal(d.slices[1].start, d.slices[0].pct, 'each slice starts where the last ended');
  assert.equal(donutSlices([]), null);
  assert.equal(donutSlices([{ name: 'x', minutes: 0 }, { name: 'y', minutes: 'junk' }]), null);
  assert.equal(donutSlices(null), null);
});

test('gaming page draws the donut in its final state (correct with animations off)', () => {
  const env = {
    status: 'ok',
    updatedAt: new Date().toISOString(),
    data: { period: { kind: 'twoWeeks', label: 'Last 2 weeks' }, totalMinutes: 300, gamesPlayed: 2, minutes2Weeks: 300, games: [{ appid: 1, name: 'Alpha <b>', minutes: 200 }, { appid: 2, name: 'Beta', minutes: 100 }] },
  };
  const html = steamDetail(env);
  const segs = [...html.matchAll(/class="donut-seg seg-\d"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"[^>]*stroke-dashoffset="(-?[\d.]+)"/g)];
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(Number(segs[0][1]) - (66.667 - 0.8)) < 0.01, 'first slice ~2/3 minus the gap');
  assert.equal(Number(segs[1][3]), -66.667, 'second slice starts after the first');
  assert.match(html, /aria-label="Share of play time: Alpha &lt;b&gt; 67%, Beta 33%"/);
  assert.ok(!html.includes('<b>'), 'game names escaped in legend and tooltip');
  assert.ok(!steamDetail({ ...env, data: { ...env.data, games: [] } }).includes('class="donut"'), 'no donut without games');
});

test('nothing anime.js animates has a CSS transform transition or hover (it would stutter)', async () => {
  const css = (await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  // Elements whose transform anime.js drives (see motion.js).
  const animated = ['.card', '.stat', '.game', '.media-card', '.poster', '.tile', '.feed-item', '.legend-item', '.donut', '.nav-indicator', '.icon', '.mode-toggle', '.theme-picker', '.settings-link', '.menu-tray', '.toast', '.paw-burst', '.view'];
  const problems = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = m[2];
    for (const raw of m[1].split(',')) {
      const sel = raw.trim();
      // The element itself (optionally :hover), not its children like ".game .game-art".
      const subject = animated.find((a) => sel === a || sel === `${a}:hover` || sel.endsWith(` ${a}`) || sel.endsWith(` ${a}:hover`));
      if (!subject) continue;
      if (/transition:[^;]*\btransform\b/.test(body)) problems.push(`${sel}: transition on transform`);
      if (sel.endsWith(':hover') && /(^|[;\s])transform:/.test(body)) problems.push(`${sel}: hover sets transform (use translate)`);
    }
  }
  assert.deepEqual(problems, []);
});

test('top-bar controls live in the hamburger tray, wired for screen readers', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tray = html.match(/<div class="menu-tray" id="menu-tray" hidden>([\s\S]*?)\n          <\/div>/)?.[1] ?? '';
  for (const id of ['theme-select', 'mode-toggle']) assert.ok(tray.includes(`id="${id}"`), `${id} is in the tray`);
  assert.match(html, /<button id="menu-toggle" class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu-tray" aria-label="Open menu"/);
  const motion = await readFile(new URL('../public/js/motion.js', import.meta.url), 'utf8');
  assert.match(motion, /export function trayOpen\(tray\) \{\n  if \(!tray \|\| !canAnimate\(\)\) return;/, 'without anime.js the tray just appears');
});
