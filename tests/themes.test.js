// Theme tests: every theme in the dropdown has night and day colours, and
// text stays readable (WCAG contrast) in every combination.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { THEMES, MODES, STORAGE_KEYS, normalizeTheme, normalizeMode, otherMode } from '../public/js/themes.js';

const css = await readFile(new URL('../public/css/themes.css', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/css/styles.css', import.meta.url), 'utf8');
const boot = await readFile(new URL('../public/js/theme-boot.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

const TOKENS = ['bg', 'surface', 'text', 'muted', 'steam', 'music', 'media', 'news', 'ok', 'warn', 'err'];

/** Parse every `selector { --x: #hex; }` block in themes.css. */
function parseBlocks(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = new Map();
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const vars = Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((v) => [v[1], v[2].trim()]));
    blocks.set(m[1].trim(), vars);
  }
  return blocks;
}
const blocks = parseBlocks(css);

function palette(themeId, mode) {
  const base = mode === 'light' ? { ...blocks.get(':root'), ...blocks.get(':root[data-mode="light"]') } : blocks.get(':root');
  if (themeId === 'default') return base;
  return blocks.get(`:root[data-theme="${themeId}"][data-mode="${mode}"]`);
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** Same as CSS color-mix(in srgb, a p%, b). */
const mix = (a, b, p) => hexOf(rgb(a).map((v, i) => v * p + rgb(b)[i] * (1 - p)));
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('theme ids are unique and the dropdown list matches themes.css', () => {
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  const inCss = new Set([...css.matchAll(/data-theme="([\w-]+)"/g)].map((m) => m[1]));
  for (const t of THEMES.filter((t) => t.id !== 'default')) assert.ok(inCss.has(t.id), `${t.id} has CSS`);
  for (const id of inCss) assert.ok(THEMES.some((t) => t.id === id), `${id} in CSS is listed in themes.js`);
});

for (const theme of THEMES) {
  for (const mode of MODES) {
    test(`${theme.name} (${mode}): every colour defined and text is readable`, () => {
      const p = palette(theme.id, mode);
      assert.ok(p, 'block exists');
      for (const t of TOKENS) assert.match(p[t] ?? '', /^#[0-9a-f]{6}$/i, `--${t}`);

      // Night/day really are dark/light.
      if (mode === 'dark') assert.ok(lum(p.bg) < 0.1, 'night background is dark');
      else assert.ok(lum(p.bg) > 0.6, 'day background is light');

      // Body text: WCAG AA (4.5:1) on page and cards. Secondary text too.
      for (const bgName of ['bg', 'surface']) {
        const bg = p[bgName];
        assert.ok(contrast(p.text, bg) >= 4.5, `text on ${bgName}: ${contrast(p.text, bg).toFixed(2)}`);
        assert.ok(contrast(p.muted, bg) >= 4.5, `muted on ${bgName}: ${contrast(p.muted, bg).toFixed(2)}`);
      }

      // Accents used as text (big numbers, pills): at least 3:1, the AA level
      // for bold/large text. Day mode darkens them as styles.css does.
      for (const a of ['steam', 'music', 'media', 'news', 'ok', 'warn', 'err']) {
        const ink = mode === 'light' ? mix(p[a], p.text, 0.55) : p[a];
        const c = Math.min(contrast(ink, p.bg), contrast(ink, p.surface));
        assert.ok(c >= 3, `${a} as text: ${c.toFixed(2)}`);
      }
    });
  }
}

for (const mode of MODES) {
  test(`Puppy mode (${mode}): every colour defined and text is readable`, () => {
    const p = blocks.get(`:root[data-puppy="on"][data-theme][data-mode="${mode}"]`);
    assert.ok(p, 'block exists');
    for (const t of TOKENS) assert.match(p[t] ?? '', /^#[0-9a-f]{6}$/i, `--${t}`);
    if (mode === 'dark') assert.ok(lum(p.bg) < 0.1);
    else assert.ok(lum(p.bg) > 0.6);
    for (const bgName of ['bg', 'surface']) {
      assert.ok(contrast(p.text, p[bgName]) >= 4.5, `text on ${bgName}`);
      assert.ok(contrast(p.muted, p[bgName]) >= 4.5, `muted on ${bgName}: ${contrast(p.muted, p[bgName]).toFixed(2)}`);
    }
    for (const a of ['steam', 'music', 'media', 'news', 'ok', 'warn', 'err']) {
      const ink = mode === 'light' ? mix(p[a], p.text, 0.55) : p[a];
      const c = Math.min(contrast(ink, p.bg), contrast(ink, p.surface));
      assert.ok(c >= 3, `${a} as text: ${c.toFixed(2)}`);
    }
  });
}

test('puppy mode overrides every theme (selector is more specific)', () => {
  // Theme blocks use 3 attribute selectors; puppy blocks need more to win.
  const count = (sel) => (sel.match(/\[/g) ?? []).length;
  const themeSel = [...blocks.keys()].filter((k) => k.includes('data-theme="'));
  const puppySel = [...blocks.keys()].filter((k) => k.includes('data-puppy'));
  assert.equal(puppySel.length, 2);
  for (const p of puppySel) for (const t of themeSel) assert.ok(count(p) > count(t), `${p} beats ${t}`);
});

test('styles.css takes every colour from the theme tokens', () => {
  const code = styles.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("data:[^"]*"\)/g, '');
  const hexes = code.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.deepEqual(hexes, [], 'no hard-coded hex colours in styles.css');
  assert.match(styles, /color-mix\(in srgb, var\(--steam\) 55%, var\(--text\)\)/, 'test mirrors the day-mode ink mix');
});

test('boot script uses the same storage keys and loads before the stylesheet', () => {
  assert.ok(boot.includes(STORAGE_KEYS.theme) && boot.includes(STORAGE_KEYS.mode));
  const bootAt = html.indexOf('/js/theme-boot.js');
  assert.ok(bootAt > 0 && bootAt < html.indexOf('/css/styles.css'));
  assert.ok(!/type="module"[^>]*theme-boot/.test(html), 'boot is a plain blocking script');
});

test('theme helpers fall back safely', () => {
  assert.equal(normalizeTheme('dracula'), 'dracula');
  assert.equal(normalizeTheme('<script>'), 'default');
  assert.equal(normalizeTheme(null), 'default');
  assert.equal(normalizeMode('light'), 'light');
  assert.equal(normalizeMode('purple'), 'dark');
  assert.equal(otherMode('dark'), 'light');
  assert.equal(otherMode('light'), 'dark');
  assert.equal(otherMode(undefined), 'light');
});

test('Monoid Retina is the default font and its files exist', async () => {
  const { access } = await import('node:fs/promises');
  const fonts = await readFile(new URL('../public/css/fonts.css', import.meta.url), 'utf8');
  const files = [...fonts.matchAll(/url\('\/(fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.equal(files.length, 2);
  assert.match(fonts, /Monoid-Retina\.ttf'\) format\('truetype'\);\s*font-weight: 100 549/, 'normal text uses the lighter Retina weight');
  for (const f of files) await access(new URL(`../public/${f}`, import.meta.url));
  assert.match(styles, /--font: 'Monoid Web'/);
  assert.ok(html.indexOf('/css/fonts.css') > 0, 'fonts.css is linked');
});

test('body has no background, so the dot grid and puppy paws behind it stay visible', () => {
  const body = styles.match(/\nbody \{([^}]*)\}/)?.[1] ?? '';
  assert.ok(body, 'body rule found');
  assert.ok(!/background:\s*var\(--bg\)/.test(body), 'body must not paint --bg (html does)');
  assert.match(styles, /\nhtml \{[^}]*background: var\(--bg\)/, 'html paints the page background');
});
