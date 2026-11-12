import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, parseFeedList, parseFeedFile, createFeedList, decodeEntities, toPlainText, createRssLoader, DEFAULT_FEEDS, MAX_FEEDS } from '../server/sources/rss.js';
import { writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from '../server/resilience.js';
import { loadConfig, isConfigured } from '../server/config.js';
import { stubFetch, has, baseConfig, rssConfig, tempDir, NO_FEEDS_FILE } from './helpers.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Example &amp; Co</title>
  <link>https://example.com/</link>
  <item>
    <title><![CDATA[Fedora <45> released & more]]></title>
    <link>https://example.com/a</link>
    <pubDate>Thu, 12 Nov 2026 10:00:00 GMT</pubDate>
    <description>&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt; &amp;amp; friends&lt;/p&gt;</description>
  </item>
  <item>
    <title>Bad link</title>
    <link>javascript:alert(1)</link>
    <dc:date>2026-11-11T09:00:00Z</dc:date>
    <content:encoded><![CDATA[<script>evil()</script><p>Body text</p>]]></content:encoded>
  </item>
  <item><title>No date</title><guid>https://example.com/guid-link</guid></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Blog</title>
  <link rel="self" href="https://blog.example/feed.atom"/>
  <link href="https://blog.example/"/>
  <entry>
    <title>Post one</title>
    <link rel="replies" href="https://blog.example/1#comments"/>
    <link rel="alternate" type="text/html" href="https://blog.example/1?a=1&amp;b=2"/>
    <updated>2026-11-12T08:00:00Z</updated>
    <summary type="html">Short &amp;lt;i&amp;gt;summary&amp;lt;/i&amp;gt;</summary>
  </entry>
</feed>`;

test('parses RSS 2.0: CDATA, entities, namespaced tags, guid fallback', () => {
  const f = parseFeed(RSS);
  assert.equal(f.title, 'Example & Co');
  assert.equal(f.link, 'https://example.com/');
  assert.equal(f.items.length, 3);
  const [a, b, c] = f.items;
  assert.equal(a.title, 'Fedora <45> released & more');
  assert.equal(a.link, 'https://example.com/a');
  assert.equal(a.date, '2026-11-12T10:00:00.000Z');
  assert.equal(a.summary, 'Hello world & friends');
  assert.equal(b.link, null, 'javascript: links are dropped');
  assert.equal(b.date, '2026-11-11T09:00:00.000Z');
  assert.equal(b.summary, 'Body text', 'scripts stripped from summaries');
  assert.equal(c.link, 'https://example.com/guid-link');
  assert.equal(c.date, null);
});

test('parses Atom: picks the alternate link, decodes &amp; in hrefs', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.title, 'Atom Blog');
  assert.equal(f.link, 'https://blog.example/');
  assert.equal(f.items[0].link, 'https://blog.example/1?a=1&b=2');
  assert.equal(f.items[0].summary, 'Short summary');
});

test('rejects non-feeds; tolerates empty feeds', () => {
  assert.throws(() => parseFeed('<html><body>Not a feed</body></html>'), /not an RSS or Atom feed/);
  assert.throws(() => parseFeed(''), /not an RSS/);
  assert.deepEqual(parseFeed('<rss><channel><title>Empty</title></channel></rss>').items, []);
});

test('entity and text helpers', () => {
  assert.equal(decodeEntities('&#39;&#x41;&amp;&unknown;&#0;'), "'A&&unknown;");
  assert.equal(toPlainText('<p>a</p>\n\n<p>b</p>'), 'a b');
  const long = toPlainText('x'.repeat(500), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith('…'));
});

test('RSS_FEEDS setting: default, off, names, bad urls dropped', () => {
  assert.deepEqual(parseFeedList(undefined), DEFAULT_FEEDS);
  assert.deepEqual(parseFeedList('off'), []);
  assert.deepEqual(parseFeedList(''), []);
  assert.deepEqual(parseFeedList('My Blog|https://a.example/feed, https://b.example/rss\nftp://nope, javascript:alert(1), not a url'), [
    { name: 'My Blog', url: 'https://a.example/feed' },
    { name: '', url: 'https://b.example/rss' },
  ]);
  assert.equal(parseFeedList(Array.from({ length: 80 }, (_, i) => `https://x.example/${i}`).join(',')).length, MAX_FEEDS);
  assert.equal(isConfigured.rss(loadConfig({ ...NO_FEEDS_FILE })), true, 'default feeds work out of the box');
  assert.equal(isConfigured.rss(loadConfig({ ...NO_FEEDS_FILE, RSS_FEEDS: 'off' })), false);
});

test('fetchText refuses huge responses', async () => {
  const big = async () => new Response('x'.repeat(100), { headers: { 'content-length': '100' } });
  await assert.rejects(fetchText(big, 'http://a.example/', { maxBytes: 10 }), /too large/);
});

test('loader: one broken feed does not hide the others; newest first', async () => {
  const config = baseConfig({ rss: rssConfig([{ name: 'Good', url: 'https://good.example/rss' }, { name: '', url: 'https://atom.example/feed' }, { name: 'Broken', url: 'https://down.example/rss' }]) });
  const fetchImpl = stubFetch([
    [has('good.example'), () => new Response(RSS)],
    [has('atom.example'), () => new Response(ATOM)],
    [has('down.example'), () => new Response('', { status: 503 })],
  ]);
  const d = await createRssLoader({ config, fetchImpl, now: () => NOW })();
  assert.deepEqual(
    d.feeds.map((f) => [f.name, f.ok, f.items.length]),
    [
      ['Good', true, 3],
      ['Atom Blog', true, 1], // name taken from the feed when not given
      ['Broken', false, 0],
    ],
  );
  assert.equal(d.latest[0].title, 'Fedora <45> released & more');
  assert.equal(d.latest[1].title, 'Post one');
  assert.equal(d.newToday, 2);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /^Broken: .*503/);
});

test('loader: keeps showing a feed that was good before and then fails', async () => {
  let up = true;
  const config = baseConfig({ rss: rssConfig([{ name: 'A', url: 'https://a.example/rss' }, { name: 'B', url: 'https://b.example/rss' }]) });
  const fetchImpl = stubFetch([
    [has('a.example'), () => (up ? new Response(RSS) : new Response('', { status: 500 }))],
    [has('b.example'), () => new Response(ATOM)],
  ]);
  const load = createRssLoader({ config, fetchImpl, now: () => NOW });
  await load();
  up = false;
  const d = await load();
  assert.equal(d.feeds[0].items.length, 3);
  assert.match(d.warnings[0], /older data/);
});

test('feeds file: one per line, comments, names with commas, CRLF, duplicates, bad urls', () => {
  const text = [
    '# my feeds',
    '',
    'Hacker News | https://hnrss.org/frontpage',
    '  https://fedoramagazine.org/feed/  ',
    'Games, Mods & News | https://games.example/rss\r',
    '#Disabled | https://off.example/rss',
    'https://hnrss.org/frontpage',
    'javascript:alert(1)',
    'not a url at all',
  ].join('\n');
  assert.deepEqual(parseFeedFile(text), [
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
    { name: '', url: 'https://fedoramagazine.org/feed/' },
    { name: 'Games, Mods & News', url: 'https://games.example/rss' },
  ]);
  assert.deepEqual(parseFeedFile(''), []);
  const many = Array.from({ length: 80 }, (_, i) => `https://x.example/${i}`).join('\n');
  assert.equal(parseFeedFile(many).length, MAX_FEEDS);
});

test('feed list: file beats RSS_FEEDS beats defaults, and edits are picked up', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, 'feeds.txt');
    const list = createFeedList({ file, envValue: 'Env|https://env.example/rss' });
    assert.deepEqual(list(), { feeds: [{ name: 'Env', url: 'https://env.example/rss' }], from: 'env' }, 'no file yet: env');

    await writeFile(file, 'A | https://a.example/rss\n');
    assert.deepEqual(list(), { feeds: [{ name: 'A', url: 'https://a.example/rss' }], from: 'file' });

    await writeFile(file, 'A | https://a.example/rss\nB | https://b.example/rss\n');
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later); // make sure the change is visible even on coarse clocks
    assert.equal(list().feeds.length, 2, 'edited file re-read');

    assert.equal(createFeedList({ file: path.join(dir, 'missing.txt'), envValue: undefined })().from, 'default');
    assert.deepEqual(createFeedList({ file, envValue: undefined, fixed: [{ name: 'D', url: 'http://d' }] })().from, 'demo');
  } finally {
    await cleanup();
  }
});

test('config reads the feeds file named by RSS_FEEDS_FILE', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const file = path.join(dir, 'my-feeds.txt');
    await writeFile(file, '# none yet\n');
    const c = loadConfig({ RSS_FEEDS_FILE: file, RSS_FEEDS: 'Env|https://env.example/rss' });
    assert.equal(isConfigured.rss(c), false, 'an existing but empty file means no feeds (file wins)');
    await writeFile(file, 'X | https://x.example/rss\n');
    const later = new Date(Date.now() + 5000);
    await utimes(file, later, later);
    assert.equal(isConfigured.rss(c), true);
  } finally {
    await cleanup();
  }
});

test('loader keeps a feed\'s old stories when the list is reordered', async () => {
  let feeds = [{ name: 'A', url: 'https://a.example/rss' }, { name: 'B', url: 'https://b.example/rss' }];
  let aUp = true;
  const config = baseConfig({ rss: { ttlMs: 1000, list: () => ({ feeds, from: 'file' }) } });
  const fetchImpl = stubFetch([
    [has('a.example'), () => (aUp ? new Response(RSS) : new Response('', { status: 500 }))],
    [has('b.example'), () => new Response(ATOM)],
  ]);
  const load = createRssLoader({ config, fetchImpl, now: () => NOW });
  await load();
  feeds = [feeds[1], feeds[0]]; // user reorders the file
  aUp = false; // and A happens to be down
  const d = await load();
  assert.deepEqual(d.feeds.map((f) => [f.name, f.items.length]), [['B', 1], ['A', 3]]);
  assert.match(d.warnings[0], /^A: .*older data/);
  assert.equal(d.listFrom, 'file');
});
