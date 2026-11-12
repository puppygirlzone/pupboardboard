// RSS 2.0 / Atom feed reader. No API keys, no dependencies: a small, forgiving
// parser that pulls out titles, links, dates and a text summary.

import { readFileSync, statSync } from 'node:fs';
import { fetchText, settleAll, UpstreamError } from '../resilience.js';

export const DEFAULT_FEEDS = [
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'Phoronix', url: 'https://www.phoronix.com/rss.php' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
];
export const MAX_FEEDS = 50;

const isHttpUrl = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** One entry: "Name | url" or just "url". Returns null if the url isn't http(s). */
function parseEntry(entry) {
  const bar = entry.lastIndexOf('|');
  const name = bar > 0 ? entry.slice(0, bar).trim() : '';
  const url = (bar > 0 ? entry.slice(bar + 1) : entry).trim();
  return isHttpUrl(url) ? { name, url } : null;
}

const dedupe = (feeds) => feeds.filter((f, i) => feeds.findIndex((g) => g.url === f.url) === i);

/**
 * Feeds file: one feed per line, "Name | url" or just "url".
 * Blank lines and lines starting with # are ignored.
 */
export function parseFeedFile(text) {
  const feeds = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map(parseEntry)
    .filter(Boolean);
  return dedupe(feeds).slice(0, MAX_FEEDS);
}

/**
 * RSS_FEEDS setting (short lists only): comma-separated "Name|url" or "url".
 * Unset = default feeds; "off" = disabled.
 */
export function parseFeedList(value) {
  if (value === undefined || value === null) return DEFAULT_FEEDS;
  const raw = String(value).trim();
  if (!raw || /^(off|none|false|0)$/i.test(raw)) return [];
  return dedupe(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map(parseEntry)
      .filter(Boolean),
  ).slice(0, MAX_FEEDS);
}

/**
 * Where the feed list comes from, in order:
 *   1. the feeds file (config/feeds.txt by default), if it exists
 *   2. RSS_FEEDS in .env
 *   3. the built-in defaults
 * The file is re-read whenever it changes, so edits apply without a restart.
 */
export function createFeedList({ file, envValue, fixed = null }) {
  let cache = { mtimeMs: -1, feeds: null };
  return function currentFeeds() {
    if (fixed) return { feeds: fixed, from: 'demo' };
    if (file) {
      try {
        const { mtimeMs } = statSync(file);
        if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, feeds: parseFeedFile(readFileSync(file, 'utf8')) };
        return { feeds: cache.feeds, from: 'file' };
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn(`[rss] can't read ${file}: ${err.code ?? err.message}`);
        cache = { mtimeMs: -1, feeds: null };
      }
    }
    const fromEnv = envValue !== undefined && envValue !== null;
    return { feeds: parseFeedList(envValue), from: fromEnv ? 'env' : 'default' };
  };
}

/* ------------------------------------------------------------ parsing */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED[code.toLowerCase()] ?? match;
  });
}

/** Text content of the first <tag> (namespaced tags allowed), CDATA unwrapped. */
function tagText(block, tag) {
  const name = tag.replace(':', '\\:');
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  const inner = m[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

const firstText = (block, tags) => {
  for (const t of tags) {
    const v = tagText(block, t);
    if (v) return v;
  }
  return null;
};

// Real tags start with a letter ("<p", "</b"); "<45>" or "a < b" are text.
const TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;
const stripTags = (s) => s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(TAG, ' ');

/** HTML snippet -> short plain text. Handles feeds that escape HTML twice. */
export function toPlainText(html, max = 220) {
  const once = stripTags(decodeEntities(String(html ?? '')));
  const text = stripTags(decodeEntities(once))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const attr = (attrs, name) => attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const alternate = links.find((a) => !attr(a, 'rel') || attr(a, 'rel') === 'alternate');
  const href = alternate ? attr(alternate, 'href') : null;
  return href ? decodeEntities(href) : null;
}

const safeLink = (value) => {
  const v = value?.trim();
  return v && isHttpUrl(v) ? v : null;
};

const toIso = (value) => {
  const t = Date.parse(value ?? '');
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom. Throws if it isn't a feed. */
export function parseFeed(xml) {
  const text = String(xml ?? '');
  if (!/<(rss|feed|rdf:RDF)\b/i.test(text)) throw new UpstreamError('not an RSS or Atom feed');
  const firstItemAt = text.search(/<(item|entry)\b/i);
  const header = firstItemAt === -1 ? text : text.slice(0, firstItemAt);

  const items = [...text.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => {
    const block = m[2];
    const rawTitle = firstText(block, ['title']);
    const link = safeLink(tagText(block, 'link')) ?? safeLink(atomLink(block)) ?? safeLink(tagText(block, 'guid'));
    return {
      title: toPlainText(rawTitle, 200) || 'Untitled',
      link,
      date: toIso(firstText(block, ['pubDate', 'published', 'updated', 'dc:date'])),
      summary: toPlainText(firstText(block, ['description', 'summary', 'content:encoded', 'content'])),
    };
  });

  return {
    title: toPlainText(tagText(header, 'title'), 80) || null,
    link: safeLink(tagText(header, 'link')) ?? safeLink(atomLink(header)),
    items,
  };
}

/* ------------------------------------------------------------ loader */

export function createRssLoader({ config, fetchImpl, now = Date.now }) {
  const memory = {}; // last good parse per feed URL
  const opts = { timeoutMs: config.timeoutMs, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8', 'user-agent': 'pupboard/1.0 (RSS reader)' } };

  return async function loadRss() {
    const { feeds, from } = config.rss.list();
    // Keyed by URL so a feed keeps its last good data when the list is edited.
    const tasks = Object.fromEntries(feeds.map((f) => [f.url, async () => parseFeed(await fetchText(fetchImpl, f.url, opts))]));
    const { values, warnings } = await settleAll(tasks, memory);
    const at = now();

    const feedResults = feeds.map((f, i) => {
      const parsed = values[f.url];
      const name = f.name || parsed?.title || new URL(f.url).host;
      const items = (parsed?.items ?? []).slice(0, 25).map((it) => ({ ...it, feed: name, feedIndex: i }));
      return { name, url: f.url, site: parsed?.link ?? null, ok: Boolean(parsed), items };
    });

    const all = feedResults.flatMap((f) => f.items);
    // Newest first; undated items keep feed order after dated ones.
    const latest = [...all].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 40);
    const dayAgo = at - 86_400_000;
    const nameFor = (url) => feedResults.find((f) => f.url === url)?.name ?? 'feed';
    return {
      feeds: feedResults,
      listFrom: from,
      latest,
      newToday: all.filter((it) => Date.parse(it.date) >= dayAgo).length,
      warnings: warnings.map((w) => {
        const url = feeds.map((f) => f.url).find((u) => w.startsWith(`${u}: `));
        return url ? `${nameFor(url)}: ${w.slice(url.length + 2)}` : w;
      }),
    };
  };
}
