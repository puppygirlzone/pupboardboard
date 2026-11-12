// ListenBrainz (listenbrainz.org): free, open listening history. No API key:
// public listens are readable with just a username. People connect Spotify
// (or YouTube Music, Navidrome, Jellyfin, ...) on the ListenBrainz website
// once, and their plays show up here.

import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { computeListeningStats } from './navidrome.js';
import { safeImage, DAY } from './common.js';

const API = 'https://api.listenbrainz.org/1';
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_LISTENS = 1000; // most the API returns in one call

/** ListenBrainz usernames are MusicBrainz names: be generous, but no slashes or control characters. */
export const validListenBrainzUser = (v) => typeof v === 'string' && /^[^/\\?#\s\0-\x1f]{1,64}$/.test(v);

/** Cover Art Archive thumbnail for a listen, when ListenBrainz knows the release. */
export function coverArtUrl(meta, size = 250) {
  const m = meta?.mbid_mapping;
  if (!m || !MBID.test(String(m.caa_release_mbid ?? '')) || !/^\d{1,20}$/.test(String(m.caa_id ?? ''))) return null;
  return `https://coverartarchive.org/release/${m.caa_release_mbid}/${m.caa_id}-${size}.jpg`;
}

function normalizeTrack(meta = {}, { demo = false } = {}) {
  const info = meta.additional_info ?? {};
  const ms = Number(info.duration_ms) || Number(info.duration) * 1000 || 0;
  const art = demo && typeof info.demo_art === 'string' ? safeImage(info.demo_art, { demo }) : coverArtUrl(meta);
  return {
    title: String(meta.track_name ?? 'Unknown track'),
    artist: String(meta.artist_name ?? 'Unknown artist'),
    album: String(meta.release_name ?? ''),
    albumId: meta.mbid_mapping?.release_mbid ?? (meta.release_name ? `${meta.artist_name}|${meta.release_name}` : null),
    duration: Math.round(ms / 1000),
    genre: null,
    art,
  };
}

export function normalizeListens(json, opts) {
  const list = json?.payload?.listens;
  if (!Array.isArray(list)) throw new UpstreamError('ListenBrainz returned an unexpected response');
  return list
    .filter((l) => l && Number.isFinite(Number(l.listened_at)))
    .map((l, i) => ({ id: String(l.recording_msid ?? `l${i}`), ...normalizeTrack(l.track_metadata, opts), playDate: new Date(Number(l.listened_at) * 1000).toISOString() }));
}

export function normalizePlayingNow(json, opts) {
  const l = json?.payload?.listens?.[0];
  if (!l?.track_metadata) return [];
  const t = normalizeTrack(l.track_metadata, opts);
  return [{ id: 'now', title: t.title, artist: t.artist, album: t.album, art: t.art, coverId: null, duration: t.duration, user: null }];
}

/** All-time top recordings. The stats endpoint answers 204 until ListenBrainz has computed them. */
export function normalizeTopRecordings(json) {
  const list = json?.payload?.recordings;
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({
    title: String(r.track_name ?? 'Unknown track'),
    artist: String(r.artist_name ?? 'Unknown artist'),
    album: String(r.release_name ?? ''),
    playCount: Number(r.listen_count) || 0,
    duration: 0,
    art: coverArtUrl({ mbid_mapping: { caa_release_mbid: r.caa_release_mbid, caa_id: r.caa_id } }),
  }));
}

export function createListenBrainzLoader({ config, fetchImpl, now = Date.now }) {
  const user = encodeURIComponent(config.listenbrainz.user);
  const opts = { timeoutMs: config.timeoutMs, headers: { 'user-agent': 'pupboard/1.0 (+https://github.com/puppygirlzone/pupboardboard)' } };
  const parse = { demo: config.demo };
  const memory = {};

  return async function loadListenBrainz() {
    const weekAgo = Math.floor((now() - 7 * DAY) / 1000);
    const { values, warnings } = await settleAll({
      listens: async () => {
        try {
          return normalizeListens(await fetchJson(fetchImpl, `${API}/user/${user}/listens?min_ts=${weekAgo}&count=${MAX_LISTENS}`, opts), parse);
        } catch (err) {
          if (err.status === 404) throw new UpstreamError(`ListenBrainz user "${config.listenbrainz.user}" not found`, 404);
          throw err;
        }
      },
      nowPlaying: async () => normalizePlayingNow(await fetchJson(fetchImpl, `${API}/user/${user}/playing-now`, opts), parse),
      topSongs: async () => normalizeTopRecordings(await fetchJson(fetchImpl, `${API}/stats/user/${user}/recordings?range=all_time&count=10`, { ...opts, allowEmpty: true })),
    }, memory);

    const listens = values.listens ?? [];
    const stats = computeListeningStats(listens, now());
    // Minutes need track lengths, which not every listen has. Say so instead of under-counting.
    const timed = listens.filter((l) => l.duration > 0).length;
    stats.minutesKnown = listens.length === 0 || timed / listens.length >= 0.8;
    stats.capped = listens.length >= MAX_LISTENS;
    stats.exact = true;
    return {
      provider: 'ListenBrainz',
      nowPlaying: values.nowPlaying ?? [],
      recentlyPlayed: listens.slice(0, 30),
      stats,
      topSongs: values.topSongs ?? [],
      topSongsLabel: 'Most played songs (all time)',
      hasSongHistory: Boolean(values.listens),
      hasGenres: false,
      profileUrl: `https://listenbrainz.org/user/${user}/`,
      note: 'Every play counts, repeats included. "Now playing" depends on your music app reporting it, so it can lag behind.',
      warnings,
    };
  };
}
