// Animated dot-grid background: the maths behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gridPoints, rippleBoost, pointerBoost, hexToRgb, rippleLife, startBackdrop } from '../public/js/backdrop.js';

test('backdrop maths: even grid, ripple rings, pointer glow, ripple lifetime', () => {
  {
    const pts = gridPoints(100, 68, 34);
    assert.equal(pts.length, 3 * 3);
    const xs = [...new Set(pts.map((p) => p.x))];
    const ys = [...new Set(pts.map((p) => p.y))];
    assert.deepEqual(xs, [16, 50, 84], 'equal margins left and right');
    assert.deepEqual(ys, [0, 34, 68]);
    assert.deepEqual(gridPoints(0, 0).length, 1);
    assert.doesNotThrow(() => gridPoints(undefined, 'junk'));
  }
  {
    assert.equal(rippleBoost(200, 200, 70), 1);
    assert.ok(rippleBoost(230, 200, 70) > rippleBoost(260, 200, 70));
    assert.equal(rippleBoost(270, 200, 70), 0, 'outside the band');
    assert.equal(rippleBoost(10, 200, 70), 0, 'inside the ring is dark again');
  }
  {
    assert.equal(pointerBoost(0, 130), 1);
    assert.ok(pointerBoost(40, 130) > pointerBoost(90, 130));
    assert.equal(pointerBoost(130, 130), 0);
  }
  {
    const ms = rippleLife(1920, 1080);
    assert.ok(ms > 7000 && ms < 8000, `${ms}ms`);
  }
});

test('theme colours are read from hex tokens', () => {
  assert.deepEqual(hexToRgb('#ff8cc6'), [255, 140, 198]);
  assert.deepEqual(hexToRgb(' #abc '), [170, 187, 204]);
  assert.deepEqual(hexToRgb('rubbish'), [128, 128, 128], 'safe fallback');
});

test('startBackdrop ignores a missing canvas', () => {
  assert.doesNotThrow(() => startBackdrop(null));
  assert.doesNotThrow(() => startBackdrop({}));
});

test('page has the dot grid, see-through cards, no blur or colour glows', async () => {
  {
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    const css = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
    assert.match(html, /<canvas class="dot-grid" aria-hidden="true"><\/canvas>/);
    assert.ok(!html.includes('class="backdrop"'));
    assert.ok(!/\.backdrop\b/.test(css) && !css.includes('--blob-opacity'), 'old glow styles removed');
  }
  {
    const css = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
    const rule = (sel) => css.match(new RegExp(`\\n${sel.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
    for (const sel of ['.card', '.panel']) {
      assert.ok(rule(sel), `${sel} rule found`);
      assert.ok(!rule(sel).includes('backdrop-filter'), `${sel} must not blur the grid`);
    }
    const pct = Number(css.match(/--card: color-mix\(in srgb, var\(--surface\) (\d+)%, transparent\)/)?.[1]);
    assert.ok(pct > 0 && pct <= 60, `cards are see-through (${pct}% surface)`);
  }
});

