// Which tab of the Settings page each section lives on. Pure (no DOM), so
// tests/setup-tabs.test.js can check that every setting has a home.
//
// A tab is named after the dashboard card its settings change; General holds
// what affects the whole dashboard. Section ids are the `section` of each
// field in server/settings.js (SETTINGS_FIELDS) and the `id` of each entry in
// SECTIONS in setup.js. A section listed here that doesn't exist yet (roblox)
// is simply skipped; a section that isn't listed anywhere lands on General,
// so a new setting can never vanish from the page.

export const TABS = [
  { id: 'gaming', title: 'Gaming', accent: 'steam', about: 'What the Gaming card shows.', sections: ['steam', 'roblox'] },
  {
    id: 'music',
    title: 'Music',
    accent: 'music',
    about: 'Which service the Music card shows, and how to connect each one. You only need one.',
    sections: ['music', 'listenbrainz', 'spotify', 'navidrome'],
  },
  {
    id: 'media',
    title: 'Media',
    accent: 'media',
    about: 'Which service the Media card shows, and how to connect each one. You only need one.',
    sections: ['media', 'jellyfin', 'letterboxd', 'deals'],
  },
  { id: 'news', title: 'News', accent: 'news', about: 'The feeds the News card reads.', sections: ['news'] },
  { id: 'general', title: 'General', accent: 'plain', about: 'Things that affect the whole dashboard.', sections: ['clock', 'network'] },
];

/** Where sections that no tab lists end up. */
export const FALLBACK_TAB = 'general';

/** The form's feed list isn't a field in SETTINGS_FIELDS; its errors use this key. */
const FEEDS_KEY = 'feeds';

/** The tab id a section belongs on (FALLBACK_TAB if no tab lists it). */
export function tabOfSection(sectionId, tabs = TABS) {
  return tabs.find((t) => t.sections.includes(sectionId))?.id ?? FALLBACK_TAB;
}

/**
 * SECTIONS plus a plain entry for any section a field uses that SECTIONS
 * doesn't describe, so those fields still get a box with a heading.
 */
export function withFieldSections(sections, fields) {
  const known = new Set(sections.map((s) => s.id));
  const extra = [];
  for (const f of fields) {
    if (!f.section || known.has(f.section)) continue;
    known.add(f.section);
    extra.push({ id: f.section, title: f.section.charAt(0).toUpperCase() + f.section.slice(1), help: [] });
  }
  return [...sections, ...extra];
}

/**
 * The tabs to show, each with its sections in the tab's order. Sections no
 * tab lists are appended to FALLBACK_TAB in the order given. Tabs that end up
 * empty are left out.
 */
export function groupSections(sections, tabs = TABS) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const listed = new Set(tabs.flatMap((t) => t.sections));
  const orphans = sections.filter((s) => !listed.has(s.id));
  return tabs
    .map((t) => ({
      ...t,
      sections: [...t.sections.filter((id) => byId.has(id)).map((id) => byId.get(id)), ...(t.id === FALLBACK_TAB ? orphans : [])],
    }))
    .filter((t) => t.sections.length > 0);
}

/** The tab that holds a field (by key), or the feed list. Null if unknown. */
export function tabOfKey(key, fields, tabs = TABS) {
  if (key === FEEDS_KEY) return tabOfSection('news', tabs);
  const field = fields.find((f) => f.key === key);
  return field ? tabOfSection(field.section, tabs) : null;
}

/**
 * Tab ids that have at least one of these errors, in tab order, so the page
 * can open the first one and mark the rest.
 */
export function tabsWithErrors(errors, fields, tabs = TABS) {
  const hit = new Set(errors.map((e) => e.key && tabOfKey(e.key, fields, tabs)).filter(Boolean));
  return tabs.map((t) => t.id).filter((id) => hit.has(id));
}

/**
 * Which tab opens first: Music right after Spotify sign-in, else the one
 * last used (if it still exists), else the first.
 */
export function startTab({ saved, spotifyResult, tabIds }) {
  if (spotifyResult && tabIds.includes('music')) return 'music';
  if (saved && tabIds.includes(saved)) return saved;
  return tabIds[0];
}

/** The tab to move to for a key press on the tab row (arrows, Home, End), or null. */
export function tabForKey(key, current, tabIds) {
  const i = tabIds.indexOf(current);
  const n = tabIds.length;
  if (key === 'ArrowRight') return tabIds[(i + 1) % n];
  if (key === 'ArrowLeft') return tabIds[(i - 1 + n) % n];
  if (key === 'Home') return tabIds[0];
  if (key === 'End') return tabIds[n - 1];
  return null;
}
