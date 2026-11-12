// Spotify Web API. Spotify requires every person to use their own developer
// app (development mode: the owner needs Premium, max 5 users), so this is the
// optional path; ListenBrainz is the no-keys way to show Spotify listening.
//
// Sign-in uses Authorization Code with PKCE: only a Client ID, no secret. The
// refresh token is kept server-side in DATA_DIR/spotify.json (mode 0600) and
// never reaches the browser.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { computeListeningStats } from './navidrome.js';
import { safeImage, DAY } from './common.js';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-recently-played user-top-read';
const STATE_TTL_MS = 10 * 60_000;

export const validSpotifyClientId = (v) => typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v);
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const pkceChallenge = (verifier) => b64url(createHash('sha256').update(verifier).digest());

/**
 * Sign-in and tokens. file: where the refresh token lives.
 * demo: pretend to be connected (demo mode uses a fake Spotify).
 */
export function createSpotifyAuth({ config, fetchImpl, file, now = Date.now, demo = false }) {
  const pending = new Map(); // state -> { verifier, redirectUri, returnTo, at }
  let stored = null; // { clientId, refreshToken, connectedAt }
  let access = null; // { token, expiresAt }
  const opts = () => ({ timeoutMs: config.timeoutMs });

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed.refreshToken === 'string' && typeof parsed.clientId === 'string') stored = parsed;
  } catch {
    /* not connected yet, or unreadable: treat as not connected */
  }

  async function save(next) {
    stored = next;
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
    await rename(tmp, file);
    await chmod(file, 0o600).catch(() => {});
  }

  async function tokenRequest(params) {
    const json = await fetchJson(fetchImpl, `${ACCOUNTS}/api/token`, {
      ...opts(),
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    if (typeof json?.access_token !== 'string') throw new UpstreamError('Spotify sign-in did not return a token');
    return json;
  }

  return {
    /** Connected for the Client ID currently in the settings. */
    isConnected: () => demo || Boolean(stored && stored.clientId === config.spotify.clientId),
    connectedAt: () => (demo ? null : stored?.clientId === config.spotify.clientId ? stored.connectedAt : null),

    /** Starts sign-in: returns the Spotify URL to send the browser to. */
    startLogin({ redirectUri, returnTo }) {
      if (!validSpotifyClientId(config.spotify.clientId)) throw new UpstreamError('Save a valid Spotify Client ID first');
      for (const [k, v] of pending) if (now() - v.at > STATE_TTL_MS) pending.delete(k);
      if (pending.size > 20) pending.clear(); // nobody needs 20 sign-ins at once
      const state = b64url(randomBytes(24));
      const verifier = b64url(randomBytes(48));
      pending.set(state, { verifier, redirectUri, returnTo, at: now() });
      const qs = new URLSearchParams({
        client_id: config.spotify.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        code_challenge_method: 'S256',
        code_challenge: pkceChallenge(verifier),
        scope: SPOTIFY_SCOPES,
        state,
      });
      return `${ACCOUNTS}/authorize?${qs}`;
    },

    /** Spotify sent the browser back. State is single-use. Returns where to send the browser next. */
    async finishLogin({ state, code }) {
      const entry = typeof state === 'string' ? pending.get(state) : null;
      if (!entry || now() - entry.at > STATE_TTL_MS) throw new UpstreamError('This sign-in link expired. Press "Connect Spotify" again.');
      pending.delete(state);
      if (typeof code !== 'string' || !code) throw new UpstreamError('Spotify did not send a sign-in code');
      const json = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: entry.redirectUri,
        client_id: config.spotify.clientId,
        code_verifier: entry.verifier,
      });
      if (typeof json.refresh_token !== 'string') throw new UpstreamError('Spotify did not return a refresh token');
      access = { token: json.access_token, expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 };
      await save({ clientId: config.spotify.clientId, refreshToken: json.refresh_token, connectedAt: new Date(now()).toISOString() });
      return entry.returnTo;
    },

    /** returnTo for a state, so errors can go back to the right page too. */
    returnFor: (state) => pending.get(state)?.returnTo ?? null,
    /** The person said no on Spotify's page: forget that sign-in. */
    cancelLogin: (state) => pending.delete(state),

    async disconnect() {
      stored = null;
      access = null;
      await rm(file, { force: true });
    },

    /** A valid access token, refreshing when needed. force: refresh even if not expired (after a 401). */
    async accessToken({ force = false } = {}) {
      if (demo) return 'demo-token';
      if (!stored || stored.clientId !== config.spotify.clientId) throw new UpstreamError('Spotify is not connected');
      if (!force && access && access.expiresAt - 60_000 > now()) return access.token;
      let json;
      try {
        json = await tokenRequest({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, client_id: stored.clientId });
      } catch (err) {
        if (err.status === 400 || err.status === 401) throw new UpstreamError('Spotify sign-in expired: press "Connect Spotify" in Settings again', err.status);
        throw err;
      }
      access = { token: json.access_token, expiresAt: now() + (Number(json.expires_in) || 3600) * 1000 };
      // Spotify may rotate the refresh token; keep the newest.
      if (typeof json.refresh_token === 'string' && json.refresh_token !== stored.refreshToken) {
        await save({ ...stored, refreshToken: json.refresh_token }).catch((e) => console.warn(`[spotify] could not save token: ${e.code ?? e.message}`));
      }
      return access.token;
    },
  };
}

/* ------------------------------------------------------------ data */

/** Smallest album image that is still at least `min` px wide. */
export function pickImage(images, min = 160, opts) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i && safeImage(i.url, opts)).sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0));
  return (list.find((i) => (Number(i.width) || 0) >= min) ?? list.at(-1))?.url ?? null;
}

export function normalizeTrack(t, opts) {
  if (!t || typeof t !== 'object') return null;
  return {
    id: String(t.id ?? ''),
    title: String(t.name ?? 'Unknown track'),
    artist: (Array.isArray(t.artists) ? t.artists : []).map((a) => String(a?.name ?? '')).filter(Boolean).join(', ') || 'Unknown artist',
    album: String(t.album?.name ?? ''),
    albumId: t.album?.id ? String(t.album.id) : null,
    duration: Math.round((Number(t.duration_ms) || 0) / 1000),
    genre: null,
    art: pickImage(t.album?.images, 160, opts),
  };
}

export function normalizeRecent(json, opts) {
  const items = json?.items;
  if (!Array.isArray(items)) throw new UpstreamError('Spotify returned an unexpected response');
  return items
    .map((it) => {
      const t = normalizeTrack(it?.track, opts);
      return t && Number.isFinite(Date.parse(it.played_at)) ? { ...t, playDate: it.played_at } : null;
    })
    .filter(Boolean);
}

export function normalizeCurrentlyPlaying(json, opts) {
  if (!json || json.is_playing !== true || json.currently_playing_type !== 'track') return [];
  const t = normalizeTrack(json.item, opts);
  return t ? [{ ...t, coverId: null, user: null }] : [];
}

export function normalizeTopTracks(json, opts) {
  return (Array.isArray(json?.items) ? json.items : []).map((t) => normalizeTrack(t, opts)).filter(Boolean).map((t) => ({ ...t, playCount: null }));
}

export function createSpotifyLoader({ config, fetchImpl, auth, now = Date.now }) {
  const parse = { demo: config.demo };
  const memory = {};

  // One API call; on 401 refresh the token once and retry.
  async function api(pathAndQuery, extra = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await auth.accessToken({ force: attempt > 0 });
      try {
        return await fetchJson(fetchImpl, `${API}${pathAndQuery}`, { timeoutMs: config.timeoutMs, headers: { authorization: `Bearer ${token}` }, ...extra });
      } catch (err) {
        if (err.status === 401 && attempt === 0) continue;
        if (err.status === 403) throw new UpstreamError('Spotify refused access (is your account added under "User Management" in your Spotify app?)', 403);
        throw err;
      }
    }
    throw new UpstreamError('Spotify authentication failed');
  }

  return async function loadSpotify() {
    const { values, warnings } = await settleAll({
      nowPlaying: async () => normalizeCurrentlyPlaying(await api('/me/player/currently-playing', { allowEmpty: true }), parse),
      recent: async () => normalizeRecent(await api('/me/player/recently-played?limit=50'), parse),
      topSongs: async () => normalizeTopTracks(await api('/me/top/tracks?time_range=short_term&limit=10'), parse),
    }, memory);
    const recent = values.recent ?? [];
    const at = now();
    const stats = computeListeningStats(recent, at);
    // Spotify only hands out the last 50 plays: if all 50 are from this week, the real number is higher.
    stats.capped = recent.length >= 50 && Date.parse(recent.at(-1).playDate) >= at - 7 * DAY;
    stats.minutesKnown = true;
    stats.exact = true;
    return {
      provider: 'Spotify',
      nowPlaying: values.nowPlaying ?? [],
      recentlyPlayed: recent.slice(0, 30),
      stats,
      topSongs: values.topSongs ?? [],
      topSongsLabel: 'Your top songs (last 4 weeks)',
      hasSongHistory: Boolean(values.recent),
      hasGenres: false,
      note: 'Spotify only shares your last 50 plays, so weekly numbers show 50+ when you listen a lot.',
      warnings,
    };
  };
}
