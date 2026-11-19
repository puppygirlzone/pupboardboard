// Settings page tabs: every setting has a tab that makes sense, nothing can
// fall off the page, errors lead to the right tab, and the tab row works
// from the keyboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTINGS_FIELDS } from '../server/settings.js';
import { TABS, FALLBACK_TAB, tabOfSection, withFieldSections, groupSections, tabOfKey, tabsWithErrors, startTab, tabForKey } from '../public/js/setup-tabs.js';

const setupJs = await readFile(new URL('../public/js/setup.js', import.meta.url), 'utf8');
// The ids of the SECTIONS list in setup.js (the page's boxes, in order).
const sectionIds = [...setupJs.slice(setupJs.indexOf('const SECTIONS = ['), setupJs.indexOf('const CHOICE_LABELS')).matchAll(/^ {2,4}(?:\{ )?id: '([a-z0-9-]+)'/gm)].map((m) => m[1]);
const SECTIONS = sectionIds.map((id) => ({ id, title: id, help: [] }));

test('setup.js SECTIONS was read (guards the regex above)', () => {
  assert.ok(sectionIds.length >= 12, sectionIds.join(','));
  assert.equal(new Set(sectionIds).size, sectionIds.length, 'no duplicate sections');
});

test('every setting sits on the tab of the card it changes', () => {
  const expected = {
    gaming: ['STEAM_ID', 'STEAM_API_KEY', 'STEAM_LINKS', 'STEAM_HIDE'],
    music: ['MUSIC_SOURCE', 'LOCAL_NOW_PLAYING', 'LISTENBRAINZ_USER', 'SPOTIFY_CLIENT_ID', 'NAVIDROME_URL', 'NAVIDROME_USER', 'NAVIDROME_PASSWORD'],
    media: ['MEDIA_SOURCE', 'JELLYFIN_URL', 'JELLYFIN_API_KEY', 'LETTERBOXD_USER', 'DEALS', 'DEALS_CURRENCY'],
    general: ['TIME_ZONE', 'CLOCK_FORMAT', 'HOST'],
  };
  for (const [tab, keys] of Object.entries(expected)) {
    for (const key of keys) assert.equal(tabOfKey(key, SETTINGS_FIELDS), tab, key);
  }
  assert.equal(tabOfKey('feeds', SETTINGS_FIELDS), 'news', 'the feed list is on News');
});

test('every section in setup.js and every field section is listed by a tab (none rely on the fallback)', () => {
  const listed = new Set(TABS.flatMap((t) => t.sections));
  for (const id of sectionIds) assert.ok(listed.has(id), `section ${id} needs a tab in setup-tabs.js`);
  for (const f of SETTINGS_FIELDS) assert.ok(listed.has(f.section), `${f.key} (section ${f.section}) needs a tab`);
  assert.equal(new Set(TABS.flatMap((t) => t.sections)).size, listed.size, 'no section is on two tabs');
});

test('grouping keeps every section exactly once, in the tab order', () => {
  const groups = groupSections(SECTIONS);
  assert.deepEqual(
    groups.map((g) => g.id),
    ['gaming', 'music', 'media', 'news', 'general'],
  );
  const placed = groups.flatMap((g) => g.sections.map((s) => s.id));
  assert.deepEqual([...placed].sort(), [...sectionIds].sort());
  assert.deepEqual(groups.find((g) => g.id === 'music').sections.map((s) => s.id), ['music', 'listenbrainz', 'spotify', 'navidrome']);
  assert.deepEqual(groups.find((g) => g.id === 'media').sections.map((s) => s.id), ['media', 'jellyfin', 'letterboxd', 'deals']);
  for (const g of groups) assert.ok(g.title && g.about, `${g.id} explains itself`);
});

test('a reserved section that does not exist yet (roblox) is skipped, and appears on Gaming once added', () => {
  assert.ok(!sectionIds.includes('roblox') || tabOfSection('roblox') === 'gaming');
  const without = groupSections(SECTIONS.filter((s) => s.id !== 'roblox'));
  assert.deepEqual(without.find((g) => g.id === 'gaming').sections.map((s) => s.id), ['steam']);
  const steamAt = SECTIONS.findIndex((s) => s.id === 'steam');
  const withRoblox = [...SECTIONS.slice(0, steamAt + 1), { id: 'roblox', title: 'Roblox', help: [] }, ...SECTIONS.slice(steamAt + 1)];
  assert.deepEqual(groupSections(withRoblox).find((g) => g.id === 'gaming').sections.map((s) => s.id), ['steam', 'roblox']);
});

test('unknown sections never vanish: they land on General, even with no SECTIONS entry', () => {
  const fields = [...SETTINGS_FIELDS, { key: 'NEW_THING', section: 'mystery', label: 'New thing' }];
  const sections = withFieldSections(SECTIONS, fields);
  const mystery = sections.find((s) => s.id === 'mystery');
  assert.deepEqual(mystery, { id: 'mystery', title: 'Mystery', help: [] });
  assert.equal(sections.filter((s) => s.id === 'steam').length, 1, 'known sections are not doubled');
  const general = groupSections(sections).find((g) => g.id === FALLBACK_TAB);
  assert.equal(general.sections.at(-1).id, 'mystery');
  assert.equal(tabOfKey('NEW_THING', fields), FALLBACK_TAB);
  // A tab with nothing on it isn't shown.
  assert.deepEqual(
    groupSections([{ id: 'clock' }]).map((g) => g.id),
    ['general'],
  );
});

test('errors lead to their tabs, first tab first', () => {
  const errors = [
    { key: 'HOST', message: 'x' },
    { key: 'SPOTIFY_CLIENT_ID', message: 'y' },
    { key: 'feeds', message: 'z' },
    { key: null, message: 'general failure' },
    { key: 'NOT_A_FIELD', message: '?' },
  ];
  assert.deepEqual(tabsWithErrors(errors, SETTINGS_FIELDS), ['music', 'news', 'general']);
  assert.deepEqual(tabsWithErrors([], SETTINGS_FIELDS), []);
  assert.equal(tabOfKey('NOT_A_FIELD', SETTINGS_FIELDS), null);
});

test('start tab: Music after Spotify sign-in, else the remembered one, else the first', () => {
  const tabIds = TABS.map((t) => t.id);
  assert.equal(startTab({ saved: null, spotifyResult: null, tabIds }), 'gaming');
  assert.equal(startTab({ saved: 'news', spotifyResult: null, tabIds }), 'news');
  assert.equal(startTab({ saved: 'news', spotifyResult: 'connected', tabIds }), 'music');
  assert.equal(startTab({ saved: 'gone', spotifyResult: null, tabIds }), 'gaming', 'a stale saved tab falls back');
  assert.equal(startTab({ saved: 'constructor', spotifyResult: null, tabIds }), 'gaming');
});

test('tab row keys: arrows wrap around, Home and End jump, other keys are left alone', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(tabForKey('ArrowRight', 'a', ids), 'b');
  assert.equal(tabForKey('ArrowRight', 'c', ids), 'a');
  assert.equal(tabForKey('ArrowLeft', 'a', ids), 'c');
  assert.equal(tabForKey('Home', 'c', ids), 'a');
  assert.equal(tabForKey('End', 'a', ids), 'c');
  assert.equal(tabForKey('Tab', 'a', ids), null);
  assert.equal(tabForKey('Enter', 'a', ids), null);
});

test('settings page uses the ARIA tab pattern and keeps one form for Save', () => {
  for (const needle of ["role: 'tablist'", "role: 'tab'", "role: 'tabpanel'", "'aria-selected'", "'aria-controls'", "'aria-labelledby'", "'aria-invalid'"]) {
    assert.ok(setupJs.includes(needle), needle);
  }
  // Panels are hidden, never removed, so Save (one form) sends every tab.
  assert.match(setupJs, /panel\.hidden = panel\.dataset\.tab !== id/);
  assert.ok(!/\.remove\(\)/.test(setupJs), 'no panel is taken out of the form');
  // The remembered tab is read and written defensively (private windows).
  assert.match(setupJs, /localStorage\.getItem\(TAB_KEY\)/);
});
