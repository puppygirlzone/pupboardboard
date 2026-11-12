// Navidrome: the Subsonic API for now-playing and album lists, and Navidrome's
// own REST API (/api/song) for per-song play dates and counts.

import { createHash, randomBytes } from 'node:crypto';
import { fetchJson, settleAll, UpstreamError } from '../resilience.js';

const DAY = 86_400_000;
const CLIENT = 'pupboard';

export function subsonicAuthParams(user, password, salt = randomBytes(6).toString('hex')) {
  const token = createHash('md5').update(password + salt).digest('hex');
  return new URLSearchParams({ u: user, t: token, s: salt, v: '1.16.1', c: CLIENT, f: 'json' });
}

export function unwrapSubsonic(json) {
  const body = json?.['subsonic-response'];
  if (!body) throw new UpstreamError('Navidrome returned an unexpected response');
  if (body.status !== 'ok') throw new UpstreamError(`Navidrome: ${body.error?.message ?? 'request failed'}`);
  return body;
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export function normalizeNowPlaying(body) {
  return asArray(body?.nowPlaying?.entry).map((e) => ({
    id: String(e.id),
    title: String(e.title ?? 'Unknown track'),
    artist: String(e.artist ?? 'Unknown artist'),
    album: String(e.album ?? ''),
    coverId: e.coverArt ? String(e.coverArt) : null,
    duration: Number(e.duration) || 0,
    user: e.username ?? null,
    minutesAgo: Number(e.minutesAgo) || 0,
  }));
}

export function normalizeAlbums(body) {
  return asArray(body?.albumList2?.album).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? a.title ?? 'Unknown album'),
    artist: String(a.artist ?? 'Unknown artist'),
    year: a.year ?? null,
    coverId: a.coverArt ? String(a.coverArt) : null,
    playCount: Number(a.playCount) || 0,
    played: a.played ?? null,
    songCount: Number(a.songCount) || 0,
  }));
}

export function normalizeSongs(list) {
  return asArray(list).map((s) => ({
    id: String(s.id),
    title: String(s.title ?? 'Unknown track'),
    artist: String(s.artist ?? 'Unknown artist'),
    album: String(s.album ?? ''),
    albumId: s.albumId ? String(s.albumId) : null,
    coverId: String(s.id),
    duration: Number(s.duration) || 0,
    playCount: Number(s.playCount) || 0,
    playDate: s.playDate ?? null,
    genre: s.genre || null,
    year: s.year ?? null,
  }));
}

function topBy(items, keyFn, labelFn, limit = 5) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const entry = counts.get(key) ?? { ...labelFn(item), plays: 0, seconds: 0 };
    entry.plays += 1;
    entry.seconds += item.duration;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, limit);
}

/** Pure: week stats from songs sorted by most recent play. */
export function computeListeningStats(recentSongs, now) {
  const weekAgo = now - 7 * DAY;
  const thisWeek = recentSongs.filter((s) => {
    const t = Date.parse(s.playDate);
    return Number.isFinite(t) && t >= weekAgo && t <= now + 60_000;
  });
  return {
    tracksThisWeek: thisWeek.length,
    // Navidrome keeps only the latest play per song, so this is a lower bound.
    minutesThisWeek: Math.round(thisWeek.reduce((sum, s) => sum + s.duration, 0) / 60),
    topArtists: topBy(thisWeek, (s) => s.artist, (s) => ({ name: s.artist })),
    topAlbums: topBy(thisWeek, (s) => s.albumId ?? s.album, (s) => ({ name: s.album, artist: s.artist, coverId: s.coverId, art: s.art ?? null })),
    topGenres: topBy(thisWeek, (s) => s.genre, (s) => ({ name: s.genre })),
  };
}

/** One Subsonic API call (fresh salt and token every time). */
async function subsonicCall(config, fetchImpl, endpoint, params = {}, timeoutMs = config.timeoutMs) {
  const { url, user, password } = config.navidrome;
  const qs = subsonicAuthParams(user, password);
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return unwrapSubsonic(await fetchJson(fetchImpl, `${url}/rest/${endpoint}?${qs}`, { timeoutMs }));
}

/**
 * Live "now playing", never cached: one cheap request, used on every page
 * load so the song shown is current. Short timeout so pages never wait long.
 */
export function createNowPlayingFetcher({ config, fetchImpl, timeoutMs = Math.min(config.timeoutMs, 4000) }) {
  return async () => normalizeNowPlaying(await subsonicCall(config, fetchImpl, 'getNowPlaying', {}, timeoutMs));
}

export function createNavidromeLoader({ config, fetchImpl, now = Date.now }) {
  const { url, user, password } = config.navidrome;
  const opts = { timeoutMs: config.timeoutMs };
  let nativeToken = null;

  const subsonic = (endpoint, params = {}) => subsonicCall(config, fetchImpl, endpoint, params);

  const login = async () => {
    const res = await fetchJson(fetchImpl, `${url}/auth/login`, {
      ...opts,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    });
    if (!res?.token) throw new UpstreamError('Navidrome login did not return a token');
    nativeToken = res.token;
    return nativeToken;
  };

  const native = async (query) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = nativeToken ?? (await login());
      try {
        return await fetchJson(fetchImpl, `${url}/api/song?${query}`, { ...opts, headers: { 'x-nd-authorization': `Bearer ${token}` } });
      } catch (err) {
        if (err.status === 401 && attempt === 0) {
          nativeToken = null; // token expired: log in again once
          continue;
        }
        throw err;
      }
    }
    throw new UpstreamError('Navidrome authentication failed');
  };

  const memory = {}; // last good value of each sub-request

  return async function loadNavidrome() {
    const { values, warnings } = await settleAll({
      nowPlaying: async () => normalizeNowPlaying(await subsonic('getNowPlaying')),
      recentAlbums: async () => normalizeAlbums(await subsonic('getAlbumList2', { type: 'recent', size: 12 })),
      frequentAlbums: async () => normalizeAlbums(await subsonic('getAlbumList2', { type: 'frequent', size: 8 })),
      recentSongs: async () => normalizeSongs(await native('_sort=play_date&_order=DESC&_start=0&_end=200')),
      topSongs: async () => normalizeSongs(await native('_sort=play_count&_order=DESC&_start=0&_end=10')),
    }, memory);
    const at = now();
    const recentSongs = (values.recentSongs ?? []).filter((s) => s.playDate);
    return {
      nowPlaying: values.nowPlaying ?? [],
      recentlyPlayed: recentSongs.slice(0, 30),
      stats: computeListeningStats(recentSongs, at),
      topSongs: (values.topSongs ?? []).filter((s) => s.playCount > 0),
      recentAlbums: values.recentAlbums ?? [],
      frequentAlbums: values.frequentAlbums ?? [],
      hasSongHistory: Boolean(values.recentSongs),
      warnings,
    };
  };
}

/** Builds the upstream URL for a cover image (used by the image proxy). */
export function navidromeCoverUrl(config, id, size) {
  const { url, user, password } = config.navidrome;
  const qs = subsonicAuthParams(user, password);
  qs.set('id', id);
  qs.set('size', String(size));
  return `${url}/rest/getCoverArt?${qs}`;
}
