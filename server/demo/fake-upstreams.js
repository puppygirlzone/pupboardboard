// A fake fetch() that pretends to be Steam, Navidrome, Jellyfin, Spotify,
// ListenBrainz, Letterboxd, the deal sites and RSS feeds.
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
const art = (seed, w = 300, h = 300) => `/api/demo-art/${seed}?w=${w}&h=${h}`;
const albumSeed = (album) => `al-${album.replace(/\W/g, '').toLowerCase()}`;

// Spotify-shaped track from a demo song.
const spotifyTrack = (s) => ({
  id: s.id,
  name: s.title,
  duration_ms: s.duration * 1000,
  artists: [{ name: s.artist }],
  album: { id: s.albumId, name: s.album, images: [{ url: art(albumSeed(s.album), 300, 300), width: 300, height: 300 }] },
});
// ListenBrainz-shaped listen from a demo song.
const listen = (s) => ({
  listened_at: Math.floor(Date.parse(s.playDate) / 1000),
  recording_msid: `msid-${s.id}`,
  track_metadata: { artist_name: s.artist, track_name: s.title, release_name: s.album, additional_info: { duration_ms: s.duration * 1000, demo_art: art(albumSeed(s.album), 250, 250) } },
});

const FREEBIES = [
  ['Starlit Orchard', 'Epic Games Store', 24.99, 5],
  ['Copper Keep', 'GOG', 14.99, 2],
  ['Neon Courier', 'Steam', 9.99, 9],
];
const SALES = [
  ['Moss Garden Tycoon', 19.99, 4.99, 96],
  ['Frostline Outpost', 29.99, 8.99, 91],
  ['Puzzle Orbit', 12.99, 2.59, 94],
  ['Harbor Lights Deluxe', 39.99, 15.99, 88],
  ['Pupperton', 24.99, 12.49, 98],
];
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
  if (u.host === 'api.listenbrainz.org') {
    const all = songs(now);
    if (p === '/1/user/demo/listens') {
      const min = Number(u.searchParams.get('min_ts')) || 0;
      const listens = all.map(listen).filter((l) => l.listened_at >= min);
      return json({ payload: { count: listens.length, user_id: 'demo', listens } });
    }
    if (p === '/1/user/demo/playing-now') {
      const s = all[Math.floor(now / (3 * MIN)) % all.length];
      return json({ payload: { count: 1, playing_now: true, listens: [{ playing_now: true, track_metadata: listen(s).track_metadata }] } });
    }
    if (p === '/1/stats/user/demo/recordings') {
      const top = [...all].sort((a, b) => b.playCount - a.playCount).slice(0, 10);
      return json({ payload: { recordings: top.map((s) => ({ track_name: s.title, artist_name: s.artist, release_name: s.album, listen_count: s.playCount })) } });
    }
  }
  if (u.host === 'api.spotify.com') {
    const all = songs(now);
    if (p === '/v1/me/player/currently-playing') return json({ is_playing: true, currently_playing_type: 'track', item: spotifyTrack(all[Math.floor(now / (3 * MIN)) % all.length]) });
    if (p === '/v1/me/player/recently-played') return json({ items: all.slice(0, 50).map((s) => ({ played_at: s.playDate, track: spotifyTrack(s) })) });
    if (p === '/v1/me/top/tracks') return json({ items: [...all].sort((a, b) => b.playCount - a.playCount).slice(0, 10).map(spotifyTrack) });
  }
  if (u.host === 'www.gamerpower.com' && p === '/api/giveaways') {
    return json(
      FREEBIES.map(([title, store, worth, days], i) => ({
        id: 9100 + i,
        title: `${title} (${store}) Giveaway`,
        worth: `$${worth}`,
        thumbnail: art(`free-${i}`, 460, 215),
        open_giveaway_url: `https://example.com/free/${i}`,
        platforms: `PC, ${store}`,
        end_date: new Date(now + days * DAY).toISOString().replace('T', ' ').slice(0, 19),
        status: 'Active',
      })),
    );
  }
  if (u.host === 'www.cheapshark.com' && p === '/api/1.0/deals') {
    return json(
      SALES.map(([title, normal, sale, rating], i) => ({
        title,
        dealID: `demo-deal-${i}`,
        salePrice: sale.toFixed(2),
        normalPrice: normal.toFixed(2),
        savings: String(((1 - sale / normal) * 100).toFixed(4)),
        steamAppID: String(9900010 + i),
        thumb: art(`deal-${i}`, 231, 87),
        steamRatingPercent: String(rating),
      })),
    );
  }
  if (u.host === 'letterboxd.com' && p === '/demo/rss/') {
    const items = MOVIES.map((name, i) => {
      const watched = new Date(now - (i * 2.5 + 0.5) * DAY).toISOString().slice(0, 10);
      const rating = [4.5, 3.5, 5, 4, 3, 4.5][i % 6];
      return `<item><title>${name}, ${2000 + i * 4}</title><link>https://example.com/film/${i}/</link><letterboxd:watchedDate>${watched}</letterboxd:watchedDate><letterboxd:rewatch>${i === 2 ? 'Yes' : 'No'}</letterboxd:rewatch><letterboxd:filmTitle>${name}</letterboxd:filmTitle><letterboxd:filmYear>${2000 + i * 4}</letterboxd:filmYear><letterboxd:memberRating>${rating}</letterboxd:memberRating><letterboxd:memberLike>${i % 2 ? 'Yes' : 'No'}</letterboxd:memberLike><description><![CDATA[ <p><img src="${art(`film-${i}`, 200, 300)}"/></p> <p>Watched on a demo day.</p> ]]></description></item>`;
    }).join('');
    return new Response(`<?xml version="1.0"?><rss version="2.0" xmlns:letterboxd="https://letterboxd.com"><channel><title>Letterboxd - Demo</title>${items}</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
  }
  // Local prices: invented games, made-up exchange rates.
  const demoRate = { USD: 1, AUD: 1.52, GBP: 0.79 };
  const demoCur = (cc) => ({ US: 'USD', AU: 'AUD', GB: 'GBP', us: 'USD', au: 'AUD', gb: 'GBP' })[cc] ?? 'USD';
  const pic = (seed, w, h) => (typeof art === 'function' ? art(seed, w, h) : '');
  const cents = (usd, cur) => Math.round(usd * demoRate[cur] * 100);
  if (u.host === 'api.frankfurter.dev') return json({ amount: 1, base: 'USD', date: new Date(now).toISOString().slice(0, 10), rates: { AUD: demoRate.AUD, GBP: demoRate.GBP } });
  if (u.host === 'store.steampowered.com' && p === '/api/appdetails') {
    const cur = demoCur(u.searchParams.get('cc'));
    const out = {};
    for (const id of (u.searchParams.get('appids') ?? '').split(',')) {
      const i = Number(id) - 9900010;
      const normal = [19.99, 29.99, 12.99, 39.99, 24.99][i];
      const off = [75, 70, 80, 0, 50][i]; // the fourth isn't on sale in this region
      out[id] = normal ? { success: true, data: { price_overview: { currency: cur, initial: cents(normal, cur), final: Math.round(cents(normal, cur) * (1 - off / 100)), discount_percent: off } } } : { success: false };
    }
    return json(out);
  }
  if (u.host === 'catalog.gog.com') {
    const cur = u.searchParams.get('currencyCode') ?? 'USD';
    const games = [['Lanternfall', 19.99, 60, 46], ['Tiny Lighthouse', 9.99, 50, 44], ['Copper Keep Deluxe', 29.99, 35, 41]];
    return json({ productCount: games.length, products: games.map(([title, normal, off, rating], i) => ({ id: 1700 + i, title, coverHorizontal: pic(`gog-${i}`, 460, 215), storeLink: `https://example.com/gog/${i}`, reviewsRating: rating, price: { discount: `-${off}%`, finalMoney: { amount: (cents(normal, cur) * (1 - off / 100) / 100).toFixed(2), currency: cur }, baseMoney: { amount: (cents(normal, cur) / 100).toFixed(2), currency: cur } } })) });
  }
  if (u.host === 'store-site-backend-static.ak.epicgames.com') {
    const cur = demoCur(u.searchParams.get('country'));
    const offer = { startDate: new Date(now - 2 * DAY).toISOString(), endDate: new Date(now + 5 * DAY).toISOString() };
    return json({ data: { Catalog: { searchStore: { elements: [{ id: 'demo-epic-1', title: 'Starlit Orchard', productSlug: 'starlit-orchard', keyImages: [{ type: 'OfferImageWide', url: pic('free-0', 460, 215) }], price: { totalPrice: { discountPrice: 0, originalPrice: cents(24.99, cur), currencyCode: cur, currencyInfo: { decimals: 2 } } }, promotions: { promotionalOffers: [{ promotionalOffers: [offer] }] } }] } } } });
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
