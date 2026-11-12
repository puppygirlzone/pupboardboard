// Spotify, ListenBrainz, Letterboxd, game deals, card slots and Steam profile links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig, resolveSlots, isConfigured } from '../server/config.js';
import { createFakeFetch } from '../server/demo/fake-upstreams.js';
import { coverArtUrl, normalizeListens, normalizePlayingNow, createListenBrainzLoader, validListenBrainzUser } from '../server/sources/listenbrainz.js';
import { createSpotifyAuth, createSpotifyLoader, pkceChallenge, normalizeCurrentlyPlaying, pickImage } from '../server/sources/spotify.js';
import { normalizeFreebies, normalizeDeals, createDealsLoader, localiseSteam, normalizeEpicFree, normalizeGog, mergeFreebies, validCurrency } from '../server/sources/deals.js';
import { formatMoney } from '../public/js/format.js';
import { parseDiary, diaryStats, createLetterboxdLoader, validLetterboxdUser } from '../server/sources/letterboxd.js';
import { parseSteamProfile, createSteamLoader } from '../server/sources/steam.js';
import { safeImage } from '../server/sources/common.js';
import { applyChanges } from '../server/settings.js';
import { ROUTES, overview, slotsOf, stars, musicGlance, dealsGlance, letterboxdGlance } from '../public/js/views.js';
import { stubFetch, json, tempDir, fakeClock, NO_FEEDS_FILE } from './helpers.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const cfg = (extra = {}) => ({ timeoutMs: 200, demo: false, ...extra });

/* ------------------------------------------------------------ shared */

test('safeImage: https only (plus demo art in demo mode)', () => {
  assert.equal(safeImage('https://i.example/a.jpg'), 'https://i.example/a.jpg');
  for (const bad of ['http://i.example/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,xx', '/api/demo-art/x', 42, null, `https://${'a'.repeat(2100)}`]) assert.equal(safeImage(bad), null, String(bad).slice(0, 30));
  assert.equal(safeImage('/api/demo-art/x?w=1&h=2', { demo: true }), '/api/demo-art/x?w=1&h=2');
  assert.equal(safeImage('/api/demo-art/../x', { demo: true }), null);
});

/* ------------------------------------------------------------ slots */

test('card slots: chosen source wins, auto picks the first set up; views fall back for old saved copies', () => {
  {
    const env = { ...NO_FEEDS_FILE };
    assert.deepEqual(resolveSlots(loadConfig(env)), { music: 'listenbrainz', media: 'deals' });
    assert.deepEqual(resolveSlots(loadConfig({ ...env, LISTENBRAINZ_USER: 'me', LETTERBOXD_USER: 'me' })), { music: 'listenbrainz', media: 'letterboxd' });
    assert.deepEqual(resolveSlots(loadConfig({ ...env, LISTENBRAINZ_USER: 'me', NAVIDROME_URL: 'http://n', NAVIDROME_USER: 'u', NAVIDROME_PASSWORD: 'p' })).music, 'navidrome');
    assert.deepEqual(resolveSlots(loadConfig({ ...env, MUSIC_SOURCE: 'SPOTIFY', MEDIA_SOURCE: 'jellyfin' })), { music: 'spotify', media: 'jellyfin' }, 'chosen even when not set up, so the card explains how');
    assert.deepEqual(resolveSlots(loadConfig({ ...env, MUSIC_SOURCE: 'bogus', DEALS: 'off' })).media, 'deals', 'unknown choice = auto; deals card says how to turn it back on');
    assert.equal(isConfigured.spotify(loadConfig({ ...env, SPOTIFY_CLIENT_ID: 'a'.repeat(32) })), false, 'a Client ID alone is not connected');
  }
  {
    assert.deepEqual(slotsOf(null), { music: 'navidrome', media: 'jellyfin' });
    assert.deepEqual(slotsOf({ slots: { music: '<x>', media: 'deals' } }), { music: 'navidrome', media: 'deals' });
    const html = overview({ slots: { music: 'spotify', media: 'letterboxd' }, spotify: { status: 'unconfigured' }, letterboxd: { status: 'unconfigured' } }, NOW);
    assert.match(html, /data-source="spotify"/);
    assert.match(html, /data-source="letterboxd"/);
    assert.match(html, /Connect Spotify/);
    assert.ok(!/data-source="navidrome"|data-source="jellyfin"/.test(html));
  }
});

test('every new card and page renders in every no-data state', () => {
  const states = [undefined, null, { status: 'loading' }, { status: 'unconfigured' }, { status: 'error', error: 'boom <script>' }];
  for (const music of ['spotify', 'listenbrainz', 'navidrome']) {
    for (const media of ['deals', 'letterboxd', 'jellyfin']) {
      for (const state of states) {
        const summary = { slots: { music, media }, [music]: state, [media]: state };
        for (const name of ['', 'music', 'media']) {
          const html = ROUTES[name].render(summary, NOW);
          assert.ok(!html.includes('<script>') && !/undefined|NaN/.test(html), `${music}/${media}/${name}/${JSON.stringify(state)}`);
        }
      }
    }
  }
});

test('views: hostile names escaped, unsafe links dropped, unknown numbers never a misleading 0', () => {
  {
    const bad = '<img src=x onerror=alert(1)>';
    const env = (data) => ({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data });
    const music = musicGlance('spotify', env({ nowPlaying: [{ title: bad, artist: bad, album: bad, art: null }], recentlyPlayed: [{ title: bad, artist: bad, album: bad, playDate: new Date(NOW).toISOString() }], stats: { tracksThisWeek: 1, minutesThisWeek: 3, topArtists: [{ name: bad, plays: 1 }], exact: true }, hasSongHistory: true }), NOW);
    const deals = dealsGlance(env({ freebies: [{ title: bad, store: bad, url: null, image: null, worth: 5 }], deals: [], hasFreebies: true, hasDeals: true, freeWorth: 5, bestSaving: 0 }), NOW);
    const films = letterboxdGlance(env({ films: [{ title: bad, poster: null, rating: 4 }], stats: { thisWeek: 1, thisMonth: 1 } }), NOW);
    for (const html of [music, deals, films]) assert.ok(!html.includes('<img src=x'), html.slice(0, 80));
    assert.equal(stars(3.5), '★★★½');
    assert.equal(stars(null), '');
  }
  {
    const env = (data) => ({ status: 'ok', updatedAt: new Date(NOW).toISOString(), data });
    const deals = dealsGlance(env({ freebies: [], deals: [], hasFreebies: false, hasDeals: false, freeWorth: 0, bestSaving: 0 }), NOW);
    assert.ok(!/data-count="0"/.test(deals), 'failed deal calls do not show 0');
    const lb = musicGlance('listenbrainz', env({ nowPlaying: [], recentlyPlayed: [], stats: { tracksThisWeek: 5, minutesThisWeek: 1, minutesKnown: false, exact: true }, hasSongHistory: true }), NOW);
    assert.match(lb, /track lengths unknown/);
    const sp = musicGlance('spotify', env({ nowPlaying: [], recentlyPlayed: [], stats: { tracksThisWeek: 50, minutesThisWeek: 150, capped: true, exact: true }, hasSongHistory: true }), NOW);
    assert.match(sp, />50\+</);
  }
});

/* ------------------------------------------------------------ ListenBrainz */

test('ListenBrainz: parsing, cover art, partial failures, unknown user', async () => {
  {
    assert.equal(coverArtUrl({ mbid_mapping: { caa_release_mbid: '0d4a1d0a-1111-2222-3333-444455556666', caa_id: 123 } }), 'https://coverartarchive.org/release/0d4a1d0a-1111-2222-3333-444455556666/123-250.jpg');
    assert.equal(coverArtUrl({ mbid_mapping: { caa_release_mbid: '../../evil', caa_id: 1 } }), null);
    assert.equal(coverArtUrl({}), null);
    assert.throws(() => normalizeListens({ nope: 1 }));
    const listens = normalizeListens({ payload: { listens: [{ listened_at: NOW / 1000, track_metadata: { track_name: 'A', artist_name: 'B', additional_info: { duration_ms: 180000 } } }, { listened_at: 'junk' }, null] } });
    assert.equal(listens.length, 1);
    assert.equal(listens[0].duration, 180);
    assert.deepEqual(normalizePlayingNow({ payload: { listens: [] } }), []);
    assert.equal(validListenBrainzUser('rob'), true);
    assert.equal(validListenBrainzUser('a/b'), false);
    assert.equal(validListenBrainzUser(''), false);
  }
  {
    const listens = { payload: { listens: [{ listened_at: NOW / 1000 - 3600, track_metadata: { track_name: 'Song', artist_name: 'Band', release_name: 'LP' } }] } };
    const fetchImpl = stubFetch([
      [(u) => u.includes('/playing-now'), () => new Response('boom', { status: 500 })],
      [(u) => u.includes('/stats/'), () => new Response(null, { status: 204 })],
      [(u) => u.includes('/listens'), () => json(listens)],
    ]);
    const load = createListenBrainzLoader({ config: cfg({ listenbrainz: { user: 'me & you' } }), fetchImpl, now: () => NOW });
    const d = await load();
    assert.equal(d.stats.tracksThisWeek, 1);
    assert.equal(d.stats.minutesKnown, false, 'no track lengths: minutes are unknown, not 0');
    assert.deepEqual(d.topSongs, [], '204 from stats = nothing computed yet');
    assert.equal(d.warnings.length, 1);
    assert.match(fetchImpl.calls[0].url, /\/user\/me%20%26%20you\//, 'username is URL-encoded');

    const missing = createListenBrainzLoader({ config: cfg({ listenbrainz: { user: 'ghost' } }), fetchImpl: stubFetch([[() => true, () => new Response('', { status: 404 })]]) });
    await assert.rejects(missing(), /not found/);
  }
});

/* ------------------------------------------------------------ Spotify */

test('Spotify: PKCE challenge, images and now-playing parsing', () => {
  {
    assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  }
  {
    assert.equal(pickImage([{ url: 'https://a/640', width: 640 }, { url: 'https://a/300', width: 300 }, { url: 'https://a/64', width: 64 }]), 'https://a/300');
    assert.equal(pickImage([{ url: 'http://insecure', width: 300 }]), null);
    assert.deepEqual(normalizeCurrentlyPlaying(null), []);
    assert.deepEqual(normalizeCurrentlyPlaying({ is_playing: true, currently_playing_type: 'episode', item: {} }), []);
    assert.equal(normalizeCurrentlyPlaying({ is_playing: true, currently_playing_type: 'track', item: { name: 'X', artists: [{ name: 'A' }, { name: 'B' }] } })[0].artist, 'A, B');
  }
});

const CLIENT = 'a'.repeat(32);

test('Spotify sign-in: state is single-use, token saved owner-only, refresh rotates', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    const clock = fakeClock(NOW);
    let refreshes = 0;
    const fetchImpl = stubFetch([
      [
        (u) => u.includes('/api/token'),
        (u, init) => {
          const body = new URLSearchParams(init.body);
          assert.equal(body.get('client_id'), CLIENT);
          assert.ok(!body.has('client_secret'), 'PKCE: no secret');
          if (body.get('grant_type') === 'authorization_code') {
            assert.ok(body.get('code_verifier')?.length >= 43);
            return json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 });
          }
          refreshes += 1;
          return json({ access_token: `AT${refreshes + 1}`, refresh_token: 'RT2', expires_in: 3600 });
        },
      ],
    ]);
    const config = { timeoutMs: 200, spotify: { clientId: CLIENT } };
    const file = path.join(dir, 'spotify.json');
    const auth = createSpotifyAuth({ config, fetchImpl, file, now: clock });
    assert.equal(auth.isConnected(), false);
    const url = new URL(auth.startLogin({ redirectUri: 'http://127.0.0.1:8742/api/spotify/callback', returnTo: 'http://localhost:8742/setup.html' }));
    assert.equal(url.origin, 'https://accounts.spotify.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8742/api/spotify/callback');
    const state = url.searchParams.get('state');

    await assert.rejects(auth.finishLogin({ state: 'forged', code: 'c' }), /expired/);
    assert.equal(await auth.finishLogin({ state, code: 'c' }), 'http://localhost:8742/setup.html');
    await assert.rejects(auth.finishLogin({ state, code: 'c' }), /expired/, 'state cannot be reused');
    assert.equal(auth.isConnected(), true);
    if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);

    assert.equal(await auth.accessToken(), 'AT1');
    clock.advance(3600_000);
    assert.equal(await auth.accessToken(), 'AT2', 'expired token is refreshed');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).refreshToken, 'RT2', 'rotated refresh token is saved');

    config.spotify.clientId = 'b'.repeat(32);
    assert.equal(auth.isConnected(), false, 'a different Client ID needs a new sign-in');
    await auth.disconnect();
    config.spotify.clientId = CLIENT;
    assert.equal(auth.isConnected(), false);

    const late = createSpotifyAuth({ config, fetchImpl, file, now: clock });
    const s2 = new URL(late.startLogin({ redirectUri: 'x', returnTo: 'y' })).searchParams.get('state');
    clock.advance(11 * 60_000);
    await assert.rejects(late.finishLogin({ state: s2, code: 'c' }), /expired/, 'states expire after 10 minutes');
  } finally {
    await cleanup();
  }
});

test('Spotify loader: refreshes once on 401, 204 means nothing playing, 50 plays this week = 50+', async () => {
  const tokens = [];
  const auth = { accessToken: async ({ force } = {}) => (tokens.push(force), force ? 'fresh' : 'stale') };
  const played = Array.from({ length: 50 }, (_, i) => ({ played_at: new Date(NOW - i * 60_000).toISOString(), track: { id: `t${i}`, name: 'Song', duration_ms: 200000, artists: [{ name: 'Band' }], album: { id: 'a', name: 'LP', images: [] } } }));
  const fetchImpl = stubFetch([
    [
      () => true,
      (u, init) => {
        if (init.headers.authorization === 'Bearer stale') return new Response('', { status: 401 });
        if (u.includes('currently-playing')) return new Response(null, { status: 204 });
        if (u.includes('recently-played')) return json({ items: played });
        return new Response('', { status: 403 }); // top tracks
      },
    ],
  ]);
  const d = await createSpotifyLoader({ config: cfg(), fetchImpl, auth, now: () => NOW })();
  assert.deepEqual(d.nowPlaying, []);
  assert.equal(d.stats.capped, true);
  assert.equal(d.stats.tracksThisWeek, 50);
  assert.equal(d.warnings.length, 1, 'top tracks failing is a partial failure');
  assert.match(d.warnings[0], /User Management/, '403 explains the Spotify app allowlist');
  assert.ok(!JSON.stringify(d).includes('fresh'), 'token never in the data');
});

test('Spotify routes: sign-in needs the setup code, callback checks state and is local-only', async () => {
  const { dir, cleanup } = await tempDir();
  const CODE = 'c'.repeat(32);
  const env = { ...NO_FEEDS_FILE, SPOTIFY_CLIENT_ID: CLIENT };
  const config = { ...loadConfig(env), dataDir: dir };
  const fetchImpl = stubFetch([[(u) => u.includes('/api/token'), () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })]]);
  const app = createApp({ config, fetchImpl, retryDelayMs: 0, setup: { code: CODE, env, file: path.join(dir, 'settings.json') } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (p, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  try {
    assert.equal((await post('/api/spotify/login')).status, 403, 'no code, no sign-in');
    const res = await post('/api/spotify/login', { 'x-setup-code': CODE });
    assert.equal(res.status, 200);
    const authorize = new URL((await res.json()).url);
    const state = authorize.searchParams.get('state');
    assert.match(authorize.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/api\/spotify\/callback$/);

    const bad = await fetch(`${base}/api/spotify/callback?state=nope&code=x`, { redirect: 'manual' });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/spotify/callback?state=${state}&code=x`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get('location'), /\/setup\.html\?spotify=connected$/);
    assert.equal(isConfigured.spotify(config), true);

    const setupInfo = await (await fetch(`${base}/api/setup`, { headers: { 'x-setup-code': CODE } })).json();
    assert.equal(setupInfo.spotify.connected, true);
    assert.ok(!JSON.stringify(setupInfo).includes('RT') && !JSON.stringify(setupInfo).includes('"AT"'), 'tokens never sent to the page');

    assert.equal((await post('/api/spotify/disconnect')).status, 403);
    assert.equal((await post('/api/spotify/disconnect', { 'x-setup-code': CODE })).status, 200);
    assert.equal(isConfigured.spotify(config), false);
  } finally {
    await new Promise((r) => app.server.close(r));
    await cleanup();
  }
});

/* ------------------------------------------------------------ Deals */

test('deals: junk and unsafe values dropped; Epic, GOG and Steam local prices; money formatting', () => {
  // GamerPower
  assert.deepEqual(normalizeFreebies({ status: 0, status_message: 'No active giveaways' }), []);
  assert.throws(() => normalizeFreebies('junk'));
  const [g] = normalizeFreebies([{ id: 1, title: 'Cool Game (Epic Games) Giveaway', worth: '$19.99', thumbnail: 'http://insecure/x.jpg', image: 'https://ok/y.jpg', open_giveaway_url: 'javascript:alert(1)', gamerpower_url: 'https://gp/1', platforms: 'PC, Epic Games Store', end_date: 'N/A', status: 'Active' }, { title: 'Old', status: 'Expired' }]);
  assert.deepEqual([g.title, g.store, g.worth, g.worthCurrency, g.image, g.url, g.endsAt], ['Cool Game', 'Epic Games Store', 19.99, 'USD', 'https://ok/y.jpg', 'https://gp/1', null]);

  // CheapShark: duplicates and 0% deals dropped, CheapShark's redirect link kept
  assert.throws(() => normalizeDeals({}));
  const deals = normalizeDeals([{ title: 'A', dealID: 'x/y', salePrice: '1.00', normalPrice: '10.00', savings: '90.0', steamAppID: '123' }, { title: 'A', dealID: 'dup', savings: '50' }, { title: 'B', dealID: 'z', savings: '0' }]);
  assert.equal(deals.length, 1);
  assert.equal(deals[0].url, 'https://www.cheapshark.com/redirect?dealID=x%2Fy');

  // Steam local prices: discounted here -> local price; not discounted / not sold here -> dropped; unknown -> US price kept
  const usd = (appid) => ({ appid, title: appid ?? 'no id', price: 5, normalPrice: 10, savings: 50, currency: 'USD' });
  const local = localiseSteam([usd('1'), usd('2'), usd('3'), usd(null), usd('4')], {
    1: { success: true, data: { price_overview: { currency: 'AUD', initial: 1500, final: 750, discount_percent: 50 } } },
    2: { success: true, data: { price_overview: { currency: 'AUD', initial: 1500, final: 1500, discount_percent: 0 } } },
    3: { success: false },
  }, 'AUD');
  assert.deepEqual(local.map((d) => [d.title, d.price, d.normalPrice, d.currency]), [['1', 7.5, 15, 'AUD'], ['no id', 5, 10, 'USD'], ['4', 5, 10, 'USD']]);

  // Epic: only games free right now, with their local price
  const offer = (from, to) => ({ promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(NOW + from).toISOString(), endDate: new Date(NOW + to).toISOString() }] }] });
  const epic = normalizeEpicFree({ data: { Catalog: { searchStore: { elements: [
    { id: 'x', title: 'Free One', productSlug: 'free-one', keyImages: [{ type: 'OfferImageWide', url: 'https://img/x.jpg' }], price: { totalPrice: { discountPrice: 0, originalPrice: 3595, currencyCode: 'AUD', currencyInfo: { decimals: 2 } } }, promotions: offer(-1e6, 1e6) },
    { title: 'On sale, not free', price: { totalPrice: { discountPrice: 500, originalPrice: 1000 } }, promotions: offer(-1e6, 1e6) },
    { title: 'Was free', price: { totalPrice: { discountPrice: 0, originalPrice: 1000 } }, promotions: offer(-2e6, -1e6) },
    { title: 'Bad slug', productSlug: '../x', price: { totalPrice: { discountPrice: 0, originalPrice: 100, currencyCode: 'AUD' } }, promotions: offer(-1e6, 1e6) },
  ] } } } }, {}, NOW);
  assert.deepEqual(epic.map((x) => [x.title, x.worth, x.worthCurrency, x.url]), [['Free One', 35.95, 'AUD', 'https://store.epicgames.com/p/free-one'], ['Bad slug', 1, 'AUD', 'https://store.epicgames.com/free-games']]);
  assert.throws(() => normalizeEpicFree({}));

  // GOG: native currency; full-price games dropped; unsafe picture and link replaced
  const gog = normalizeGog({ products: [
    { id: 1, title: 'G', price: { discount: '-50%', finalMoney: { amount: '7.49', currency: 'GBP' }, baseMoney: { amount: '14.99', currency: 'GBP' } }, coverHorizontal: 'http://insecure', storeLink: 'javascript:x', reviewsRating: 45 },
    { id: 2, title: 'Full price', price: { discount: '0%', finalMoney: { amount: '5', currency: 'GBP' }, baseMoney: { amount: '5', currency: 'GBP' } } },
  ] });
  assert.deepEqual(gog.map((x) => [x.title, x.price, x.currency, x.savings, x.image, x.rating, x.store]), [['G', 7.49, 'GBP', 50, null, 90, 'GOG']]);
  assert.match(gog[0].url, /^https:\/\/www\.gog\.com\//);
  assert.throws(() => normalizeGog([]));

  // Free games: Epic's own list wins; others converted (≈) only when there's a rate
  const merged = mergeFreebies({ epic: [{ title: 'Free One', store: 'Epic Games Store', worth: 35.95, worthCurrency: 'AUD' }], gamerpower: [{ title: 'free one', store: 'Epic Games Store', worth: 24.99, worthCurrency: 'USD' }, { title: 'Other', store: 'GOG', worth: 10, worthCurrency: 'USD' }], currency: 'AUD', rate: 1.5 });
  assert.deepEqual(merged.map((x) => [x.title, x.worth, x.worthCurrency, Boolean(x.worthApprox)]), [['Free One', 35.95, 'AUD', false], ['Other', 15, 'AUD', true]]);
  assert.equal(mergeFreebies({ gamerpower: [{ title: 'Other', store: 'GOG', worth: 10, worthCurrency: 'USD' }], currency: 'AUD', rate: null })[0].worthCurrency, 'USD', 'no rate: stays in US dollars');

  // Money formatting
  assert.equal(formatMoney(7.5, 'AUD'), 'A$7.50');
  assert.equal(formatMoney(3, 'GBP'), '£3.00');
  assert.equal(formatMoney(5, 'USD'), '$5.00');
  assert.equal(formatMoney(5, 'USD', { shown: 'AUD' }), 'US$5.00', 'a fallback US price is labelled');
  assert.equal(formatMoney(15, 'AUD', { approx: true }), '≈A$15.00');
  assert.equal(formatMoney(null), '');
  assert.deepEqual(['gbp', 'AUD', 'EUR', undefined].map(validCurrency), ['GBP', 'AUD', 'USD', 'USD']);
});

test('deals loader: local currency end to end; failures flagged (never a fake 0), US prices labelled when Steam is down', async () => {
  const demo = await createDealsLoader({ config: { timeoutMs: 300, demo: true, deals: { currency: 'AUD' } }, fetchImpl: createFakeFetch({ failureRate: 0, latencyMs: [0, 0] }) })();
  assert.equal(demo.currency, 'AUD');
  assert.ok(demo.deals.length && demo.deals.every((d) => d.currency === 'AUD'), 'Steam sales in A$');
  assert.ok(demo.gog.length && demo.gog.every((d) => d.currency === 'AUD'), 'GOG sales in A$');
  assert.deepEqual(demo.freebies.map((f) => [f.worthCurrency, Boolean(f.worthApprox)]), [['AUD', false], ['AUD', true], ['AUD', true]], 'Epic exact, others ≈');
  assert.ok(demo.warnings.length === 0);

  const fetchImpl = stubFetch([
    [(u) => u.includes('gamerpower') || u.includes('epicgames'), () => new Response('', { status: 503 })],
    [(u) => u.includes('cheapshark'), () => json([{ title: 'A', dealID: '1', salePrice: '5', normalPrice: '10', savings: '50', steamAppID: '7' }])],
    [(u) => u.includes('appdetails'), () => new Response('', { status: 500 })],
    [(u) => u.includes('frankfurter'), () => json({ rates: { AUD: 1.5 } })],
    [(u) => u.includes('gog'), () => json({ products: [] })],
  ]);
  const d = await createDealsLoader({ config: { timeoutMs: 200, deals: { currency: 'AUD' } }, fetchImpl })();
  assert.equal(d.hasFreebies, false, 'free-game calls failed: "—", not 0');
  assert.equal(d.hasGog, true);
  assert.deepEqual(d.deals.map((x) => [x.price, x.currency]), [[5, 'USD']], 'Steam down: US price kept');
  assert.ok(d.warnings.some((w) => /steam prices/.test(w)), 'and said so');
});

/* ------------------------------------------------------------ Letterboxd */

const DIARY = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title>Film, 2026 - ★★★★</title><link>https://letterboxd.com/me/film/film/</link><letterboxd:watchedDate>2026-11-10</letterboxd:watchedDate><letterboxd:rewatch>Yes</letterboxd:rewatch><letterboxd:filmTitle>Film &amp; Co</letterboxd:filmTitle><letterboxd:filmYear>2026</letterboxd:filmYear><letterboxd:memberRating>4.5</letterboxd:memberRating><letterboxd:memberLike>Yes</letterboxd:memberLike><description><![CDATA[ <p><img src="https://a.ltrbxd.com/poster.jpg"/></p> ]]></description></item>
<item><title>Bad</title><link>javascript:alert(1)</link><letterboxd:filmTitle>Bad</letterboxd:filmTitle><letterboxd:memberRating>99</letterboxd:memberRating><letterboxd:watchedDate>not a date</letterboxd:watchedDate><description><![CDATA[<img src="http://insecure/p.jpg">]]></description></item>
<item><title>A list I made</title><link>https://letterboxd.com/me/list/x/</link></item>
</channel></rss>`;

test('Letterboxd: diary parsing, stats, unknown user', async () => {
  {
    const films = parseDiary(DIARY);
    assert.equal(films.length, 2);
    assert.deepEqual(films[0], { title: 'Film & Co', year: 2026, rating: 4.5, watchedDate: '2026-11-10', rewatch: true, liked: true, poster: 'https://a.ltrbxd.com/poster.jpg', link: 'https://letterboxd.com/me/film/film/' });
    assert.equal(films[1].link, null);
    assert.equal(films[1].poster, null);
    assert.equal(films[1].rating, null);
    assert.equal(films[1].watchedDate, null);
    assert.throws(() => parseDiary('<html>nope</html>'));
    const stats = diaryStats(films, NOW);
    assert.equal(stats.thisWeek, 1);
    assert.equal(stats.averageRating, 4.5);
    assert.equal(validLetterboxdUser('dave'), true);
    assert.equal(validLetterboxdUser('../x'), false);
  }
  {
    const load = createLetterboxdLoader({ config: cfg({ letterboxd: { user: 'ghost' } }), fetchImpl: stubFetch([[() => true, () => new Response('', { status: 404 })]]) });
    await assert.rejects(load(), /not found/);
  }
});

/* ------------------------------------------------------------ Steam links */

test('Steam: profile links, IDs and custom names (looked up once)', async () => {
  {
    assert.deepEqual(parseSteamProfile('76561198000000000'), { id: '76561198000000000' });
    assert.deepEqual(parseSteamProfile('https://steamcommunity.com/profiles/76561198000000000/'), { id: '76561198000000000' });
    assert.deepEqual(parseSteamProfile('steamcommunity.com/id/Pup_Name/?l=en'), { vanity: 'Pup_Name' });
    assert.deepEqual(parseSteamProfile('pupname'), { vanity: 'pupname' });
    for (const bad of ['', 'https://evil.example/id/x', 'steamcommunity.com/profiles/123', 'a', 'two words']) assert.equal(parseSteamProfile(bad), null, bad);
  }
  {
    let lookups = 0;
    const fetchImpl = stubFetch([
      [(u) => u.includes('ResolveVanityURL'), () => (lookups++, json({ response: { success: 1, steamid: '76561198000000009' } }))],
      [(u) => u.includes('GetRecentlyPlayedGames'), () => json({ response: { games: [{ appid: 1, name: 'G', playtime_2weeks: 60, playtime_forever: 600 }] } })],
      [() => true, () => new Response('', { status: 500 })],
    ]);
    const history = { record: async () => [] };
    const load = createSteamLoader({ config: cfg({ steam: { apiKey: 'K', steamId: 'https://steamcommunity.com/id/pupname' } }), fetchImpl, history, now: () => NOW });
    await load();
    await load();
    assert.equal(lookups, 1);
    assert.ok(fetchImpl.calls.some((c) => c.url.includes('steamid=76561198000000009')));

    const unknown = createSteamLoader({ config: cfg({ steam: { apiKey: 'K', steamId: 'nobody' } }), fetchImpl: stubFetch([[() => true, () => json({ response: { success: 42 } })]]), history });
    await assert.rejects(unknown(), /No Steam profile called "nobody"/);
  }
});

/* ------------------------------------------------------------ settings */

test('settings: pasted profile links become usernames; bad Client IDs are refused', () => {
  const { settings, errors } = applyChanges({}, {
    values: { LETTERBOXD_USER: 'https://letterboxd.com/dave/films/', LISTENBRAINZ_USER: 'listenbrainz.org/user/rob/', MUSIC_SOURCE: 'listenbrainz', MEDIA_SOURCE: 'nope', SPOTIFY_CLIENT_ID: 'short', DEALS: 'off' },
  });
  assert.equal(settings.LETTERBOXD_USER, 'dave');
  assert.equal(settings.LISTENBRAINZ_USER, 'rob');
  assert.equal(settings.DEALS, 'off');
  assert.deepEqual(errors.map((e) => e.key).sort(), ['MEDIA_SOURCE', 'SPOTIFY_CLIENT_ID']);
});

/* ------------------------------------------------------------ demo contract */

test('demo data renders on every page for every card choice (server and views agree)', async () => {
  const { dir, cleanup } = await tempDir();
  try {
    for (const [music, media] of [['spotify', 'deals'], ['listenbrainz', 'letterboxd']]) {
      const config = { ...loadConfig({ DEMO_MODE: '1', MUSIC_SOURCE: music, MEDIA_SOURCE: media }), dataDir: dir };
      const app = createApp({ config, fetchImpl: createFakeFetch({ failureRate: 0, latencyMs: [0, 0] }), retryDelayMs: 0 });
      const summary = { slots: { music, media }, [music]: await app.sources[music].get(), [media]: await app.sources[media].get() };
      assert.equal(summary[music].status, 'ok');
      assert.equal(summary[media].status, 'ok');
      for (const name of ['', 'music', 'media']) {
        const html = ROUTES[name].render(summary, Date.now());
        assert.ok(!/undefined|NaN|\[object/.test(html), `${music}/${media}/${name}`);
      }
      assert.match(ROUTES.media.render(summary, Date.now()), media === 'deals' ? /Pupperton/ : /Dunes of Varra/);
    }
  } finally {
    await cleanup();
  }
});
