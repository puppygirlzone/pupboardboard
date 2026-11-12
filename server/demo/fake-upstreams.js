// A fake fetch() that pretends to be Steam, Navidrome, Jellyfin and RSS feeds.
// It fails some requests on purpose (errors, timeouts, bad JSON) so the
// dashboard's error handling gets exercised. Used by `npm run demo` and tests.

const MIN = 60_000;
const DAY = 86_400_000;

export function seededRandom(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Everything below is made up: invented games, artists, films and shows, with
// app ids that don't belong to real Steam games. Pictures come from
// demoArtSvg() (served at /api/demo-art/... in demo mode only).
const GAMES = [
  { appid: 9900001, name: 'Starfall Drifters', two: 610, forever: 5230, icon: '' },
  { appid: 9900002, name: 'Moss Garden Tycoon', two: 340, forever: 12040, icon: '' },
  { appid: 9900003, name: 'Pupperton', two: 275, forever: 9400, icon: '' },
  { appid: 9900004, name: 'Lumen Caverns', two: 95, forever: 3100, icon: '' },
  { appid: 9900005, name: 'Pocket Kingdoms', two: 40, forever: 20500, icon: '' },
];
const OWNED_EXTRA = [
  { appid: 9900006, name: 'Frostline Outpost', forever: 4100 },
  { appid: 9900007, name: 'Puzzle Orbit', forever: 900 },
];

const ARTISTS = [
  ['Glass Harbor', 'Night Ferry', 'Electronic'],
  ['The Velvet Orchards', 'Sunday Static', 'Funk'],
  ['Lowtide Radio', 'Coastal Hours', 'Electronic'],
  ['Mira Solenne', 'Paper Lanterns', 'Indie'],
  ['Kiro Beats', 'Rainy Tapes', 'Hip-Hop'],
  ['Northbound Echo', 'Small Satellites', 'Alternative'],
];

function songs(now) {
  const list = [];
  let i = 0;
  for (let n = 0; n < 48; n++) {
    const [artist, album, genre] = ARTISTS[(n * 7 + (n % 3)) % ARTISTS.length];
    i += 1;
    list.push({
      id: `song${n}`,
      title: `${album} track ${(n % 9) + 1}`,
      artist,
      album,
      albumId: `al-${album.replace(/\W/g, '').toLowerCase()}`,
      duration: 160 + ((n * 37) % 180),
      playCount: 1 + ((n * 13) % 40),
      playDate: new Date(now - i * 4.3 * 3_600_000).toISOString(),
      genre,
      year: 2010 + (n % 14),
    });
  }
  return list;
}

const SHOWS = [
  ['s1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'The Lighthouse Files'],
  ['s2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'Kitchen Brigade'],
  ['s3cccccccccccccccccccccccccccccc', 'Orbit Station'],
];
const MOVIES = ['Dunes of Varra', 'The Paper Fox', 'Signal from Kepler', 'Neon Rainfall', 'A Thousand Little Doors', 'The Cardinal Hotel'];

function jellyfinItems(now) {
  const items = [];
  MOVIES.forEach((name, n) => {
    items.push({
      Id: `m${String(n).padStart(31, '0')}`,
      Type: 'Movie',
      Name: name,
      ProductionYear: 2000 + n * 4,
      DateCreated: new Date(now - (n * 1.7 + 0.3) * DAY).toISOString(),
      Overview: `A demo overview for ${name}.`,
      Genres: ['Drama', 'Sci-Fi'].slice(0, 1 + (n % 2)),
      CommunityRating: 7 + (n % 3) * 0.6,
      OfficialRating: 'PG-13',
      RunTimeTicks: (95 + n * 11) * 600_000_000,
    });
  });
  SHOWS.forEach(([seriesId, seriesName], s) => {
    for (let e = 1; e <= 3 - s; e++) {
      items.push({
        Id: `e${s}${e}${'0'.repeat(29)}`,
        Type: 'Episode',
        Name: `Episode ${e}`,
        SeriesId: seriesId,
        SeriesName: seriesName,
        ParentIndexNumber: 2,
        IndexNumber: e,
        DateCreated: new Date(now - (s * 2.2 + e * 0.4) * DAY).toISOString(),
      });
    }
  });
  return items.sort((a, b) => Date.parse(b.DateCreated) - Date.parse(a.DateCreated));
}

// FNV-1a plus a final mix, so ids that differ by one character still get very different colours.
const hue = (seed) => {
  let h = 0x811c9dc5;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) % 360;
};

/** Placeholder art: a gradient with rings, unique per seed. Square by default. */
export function demoArtSvg(seed, { width = 300, height = 300 } = {}) {
  const h = hue(seed);
  const r = Math.round(Math.min(width, height) * 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},60%,25%)"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><circle cx="${width / 2}" cy="${height / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="${Math.max(4, Math.round(r / 6))}"/><circle cx="${width * 0.78}" cy="${height * 0.25}" r="${Math.round(r / 3)}" fill="rgba(255,255,255,.18)"/></svg>`;
}
const coverSvg = (seed) => demoArtSvg(seed);

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const subsonic = (body) => json({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });

function route(url, now) {
  const u = new URL(url);
  const p = u.pathname;
  if (u.host === 'api.steampowered.com') {
    if (p.includes('GetRecentlyPlayedGames'))
      return json({ response: { total_count: GAMES.length, games: GAMES.map((g) => ({ appid: g.appid, name: g.name, playtime_2weeks: g.two, playtime_forever: g.forever, img_icon_url: g.icon })) } });
    if (p.includes('GetOwnedGames')) {
      // Totals creep up over time so the weekly history has something to diff.
      const drift = Math.floor((now % (30 * DAY)) / (6 * 3_600_000));
      const games = [...GAMES, ...OWNED_EXTRA].map((g, i) => ({ appid: g.appid, name: g.name, playtime_forever: g.forever + (i < 3 ? drift * (3 - i) : 0), img_icon_url: '' }));
      return json({ response: { game_count: games.length, games } });
    }
    if (p.includes('GetPlayerSummaries')) return json({ response: { players: [{ personaname: 'Demo Player', personastate: 1, avatarfull: null, profileurl: null }] } });
  }
  if (u.host === 'navidrome.demo') {
    const all = songs(now);
    if (p === '/auth/login') return json({ token: 'demo-token' });
    if (p === '/api/song') {
      const sort = u.searchParams.get('_sort');
      const end = Number(u.searchParams.get('_end')) || 50;
      const sorted = sort === 'play_count' ? [...all].sort((a, b) => b.playCount - a.playCount) : all;
      return json(sorted.slice(0, end));
    }
    if (p === '/rest/getNowPlaying') {
      const s = all[Math.floor(now / (3 * MIN)) % all.length];
      return subsonic({ nowPlaying: { entry: [{ id: s.id, title: s.title, artist: s.artist, album: s.album, coverArt: s.id, duration: s.duration, username: 'demo', minutesAgo: 0 }] } });
    }
    if (p === '/rest/getAlbumList2') {
      const albums = ARTISTS.map(([artist, album], n) => ({ id: `al-${album.replace(/\W/g, '').toLowerCase()}`, name: album, artist, year: 2012 + n, coverArt: `al-${n}`, playCount: 90 - n * 11, songCount: 10 + n }));
      if (u.searchParams.get('type') === 'frequent') albums.sort((a, b) => b.playCount - a.playCount);
      return subsonic({ albumList2: { album: albums } });
    }
    if (p === '/rest/getCoverArt') return new Response(coverSvg(u.searchParams.get('id') ?? 'x'), { headers: { 'content-type': 'image/svg+xml' } });
  }
  if (u.host === 'jellyfin.demo') {
    if (p === '/Items') return json({ Items: jellyfinItems(now), TotalRecordCount: 12 });
    if (p === '/Items/Counts') return json({ MovieCount: 214, SeriesCount: 37, EpisodeCount: 1288 });
    if (p === '/System/Info/Public') return json({ ServerName: 'demo-media', Version: '10.10.0' });
    const img = p.match(/^\/Items\/([^/]+)\/Images\/Primary$/);
    if (img) return new Response(coverSvg(img[1]), { headers: { 'content-type': 'image/svg+xml' } });
  }
  if (u.host === 'feeds.demo') {
    const xml = (body) => new Response(body, { headers: { 'content-type': 'application/xml' } });
    const ago = (h) => new Date(now - h * 3_600_000);
    if (p === '/selfhosted.xml' || p === '/games.xml') {
      const topics =
        p === '/selfhosted.xml'
          ? ['Home server tips &amp; tricks', 'Building a quiet file server on a budget', 'Hosting your own photo library', 'Snapshots explained', 'Remote access without opening ports', 'Compose patterns that scale', 'Low-power mini PCs compared']
          : ['Lumen Caverns 1.2 patch notes', 'Demo festival highlights', 'Indie gems you missed this month', 'Pupperton&#39;s modding guide', 'Moss Garden Tycoon roadmap', 'Starfall Drifters leaves early access'];
      const items = topics
        .map(
          (t, i) => `<item><title>${t}</title><link>https://example.com${p.replace('.xml', '')}/${i}</link><pubDate>${ago(i * 5 + 1).toUTCString()}</pubDate><description><![CDATA[<p>A short demo summary for <b>${t}</b>. Lorem ipsum about servers, games and open source.</p>]]></description></item>`,
        )
        .join('');
      return xml(`<?xml version="1.0"?><rss version="2.0"><channel><title>Demo ${p}</title><link>https://example.com</link>${items}</channel></rss>`);
    }
    if (p === '/opensource.atom') {
      const topics = ['Spring distro releases roundup', 'Faster filesystems in the next kernel', 'Desktop environment first look', 'Graphics drivers get a speed boost', 'App sandbox permissions deep dive'];
      const entries = topics
        .map((t, i) => `<entry><title type="html">${t}</title><link rel="alternate" href="https://example.com/opensource/${i}"/><updated>${ago(i * 7 + 2).toISOString()}</updated><summary>Demo summary: ${t} &amp;mdash; what changed and why it matters.</summary></entry>`)
        .join('');
      return xml(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Open Source Digest</title><link href="https://example.com/opensource"/>${entries}</feed>`);
    }
  }
  return new Response('not found', { status: 404 });
}

/**
 * failureRate: chance each request fails (as a 500, a timeout, or bad JSON).
 * latencyMs: [min, max] random delay before answering.
 */
export function createFakeFetch({ failureRate = 0.2, latencyMs = [40, 400], random = Math.random, now = Date.now } = {}) {
  return async function fakeFetch(url, { signal } = {}) {
    const delay = latencyMs[0] + random() * (latencyMs[1] - latencyMs[0]);
    const roll = random();
    const failing = roll < failureRate;
    const mode = failing ? Math.floor((roll / failureRate) * 3) : -1; // 0: HTTP 500, 1: hang, 2: bad JSON

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      });
    });
    if (mode === 0) return new Response('upstream exploded', { status: 500 });
    if (mode === 1) {
      // Hang until the caller's timeout aborts us.
      await new Promise((_, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')));
        if (!signal) setTimeout(() => reject(new Error('hung')), 50);
      });
    }
    if (mode === 2) return new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    return route(String(url), now());
  };
}
