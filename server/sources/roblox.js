// Roblox: which experiences you played this week, and for how long.
//
// Roblox has no playtime API, so pupboard tracks it itself (roblox-history.js):
//   1. Presence (any device): every ROBLOX_POLL_SECONDS the server asks
//      presence.roblox.com what you're in. Roblox only names the experience
//      when asked by a logged-in account allowed to see it, so this needs a
//      .ROBLOSECURITY cookie (yours, or a second account that's your friend).
//   2. Log files (this computer only, no login): the Roblox app writes exact
//      join/leave times to its logs (roblox-logs.js).
// Names and pictures come from Roblox's public, keyless APIs. All free.
//
// The cookie is a secret: it's only ever sent to roblox.com in a header,
// never to the browser, logs, URLs or error messages.

import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { safeImage } from './common.js';
import { computeRobloxWeek, WEEK } from './roblox-history.js';

const PRESENCE = 'https://presence.roblox.com/v1/presence/users';
const USERS = 'https://users.roblox.com';
const GAMES = 'https://games.roblox.com/v1/games';
const THUMBS = 'https://thumbnails.roblox.com/v1';
const UNIVERSE_OF_PLACE = (placeId) => `https://apis.roblox.com/universes/v1/places/${placeId}/universe`;
const MAX_LOOKUPS = 20; // place -> experience lookups per refresh
const MAX_NAME = 120;
const LOOKUP_AGAIN_MS = 6 * 3_600_000;

export const IN_GAME = 2; // presence types: 0 offline, 1 website, 2 in an experience, 3 Studio, 4 invisible

const okId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;

/**
 * What people paste into "Roblox profile": a profile link
 * (roblox.com/users/<id>/profile), a user id, or a username.
 * Returns { id } or { name }, or null.
 */
export function parseRobloxUser(value) {
  const v = String(value ?? '').trim();
  if (/^\d{1,19}$/.test(v)) return okId(v) ? { id: Number(v) } : null;
  const link = v.match(/^(?:https?:\/\/)?(?:www\.|web\.)?roblox\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/(\d{1,19})(?:\/[^\s]*)?$/i);
  if (link) return okId(link[1]) ? { id: Number(link[1]) } : null;
  return /^[A-Za-z0-9_]{3,20}$/.test(v) ? { name: v } : null;
}

/**
 * The .ROBLOSECURITY cookie value, as people copy it (with or without the
 * ".ROBLOSECURITY=" part or quotes). Returns the bare value, or null.
 */
export function parseRobloxCookie(value) {
  let v = String(value ?? '').trim();
  v = v.replace(/^\.?ROBLOSECURITY=/i, '').replace(/^["']|["']$/g, '');
  return /^[\x21-\x7e]{50,4000}$/.test(v) && !/[;,"\\]/.test(v) ? v : null;
}

/** ROBLOX_POLL_SECONDS: 30 to 3600, default 60. */
export function robloxPollSeconds(value) {
  const n = Number(String(value ?? '').trim());
  if (!String(value ?? '').trim() || !Number.isFinite(n)) return 60;
  return Math.min(3600, Math.max(30, Math.round(n)));
}

/** A roblox:// link asks the Roblox app to join the experience. Whole-number place IDs only. */
export function robloxLaunchUrl(placeId) {
  return okId(placeId) ? `roblox://experiences/start?placeId=${Number(placeId)}` : null;
}

/** Presence answer for one user: { type, placeId, universeId, name }. */
export function normalizePresence(json, userId) {
  const list = Array.isArray(json?.userPresences) ? json.userPresences : [];
  const p = list.find((x) => Number(x?.userId) === Number(userId)) ?? list[0];
  if (!p || typeof p !== 'object') return null;
  return {
    type: Number(p.userPresenceType) || 0,
    placeId: okId(p.rootPlaceId) ? Number(p.rootPlaceId) : okId(p.placeId) ? Number(p.placeId) : null,
    universeId: okId(p.universeId) ? Number(p.universeId) : null,
    name: typeof p.lastLocation === 'string' ? p.lastLocation.slice(0, MAX_NAME) : null,
  };
}

/** games.roblox.com/v1/games -> { universeId: { name, rootPlaceId } } */
export function normalizeGames(json) {
  const out = {};
  for (const g of Array.isArray(json?.data) ? json.data : []) {
    if (!okId(g?.id)) continue;
    out[g.id] = { name: String(g.name ?? '').slice(0, MAX_NAME) || null, rootPlaceId: okId(g.rootPlaceId) ? Number(g.rootPlaceId) : null };
  }
  return out;
}

/** Thumbnail answers -> { targetId: https url } (icons, avatars). */
export function normalizeThumbs(json, { demo = false } = {}) {
  const out = {};
  for (const t of Array.isArray(json?.data) ? json.data : []) {
    const url = t?.state === 'Completed' ? safeImage(t.imageUrl, { demo }) : null;
    if (okId(t?.targetId) && url) out[t.targetId] = url;
  }
  return out;
}

/** games/multiget/thumbnails -> { universeId: first wide picture } */
export function normalizeWideThumbs(json, { demo = false } = {}) {
  const out = {};
  for (const g of Array.isArray(json?.data) ? json.data : []) {
    const first = Array.isArray(g?.thumbnails) ? g.thumbnails.find((t) => t?.state === 'Completed') : null;
    const url = first ? safeImage(first.imageUrl, { demo }) : null;
    if (okId(g?.universeId) && url) out[g.universeId] = url;
  }
  return out;
}

/** Pure: history + names into what the Gaming card shows. */
export function buildRobloxData({ state, now, info = {}, icons = {}, wide = {}, user = null, playing = null, methods = {}, warnings = [] }) {
  const week = computeRobloxWeek(state, now);
  const games = Object.entries(week.perExperience)
    .map(([key, v]) => {
      const u = v.universeId;
      const meta = u ? info[u] : null;
      const placeId = meta?.rootPlaceId ?? v.placeId;
      return {
        universeId: u ?? null,
        placeId,
        name: meta?.name || (key.startsWith('place:') ? `Roblox experience ${v.placeId}` : `Roblox experience ${u}`),
        minutes: v.minutes,
        sessions: v.sessions,
        icon: (u && icons[u]) || null,
        header: (u && wide[u]) || (u && icons[u]) || null,
      };
    })
    .filter((g) => g.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const fullWeek = week.from <= now - WEEK;
  return {
    user,
    playing,
    period: fullWeek ? { kind: 'week', label: 'Last 7 days', since: new Date(week.from).toISOString() } : { kind: 'since', label: 'So far', since: new Date(week.from).toISOString() },
    trackingSince: new Date(week.from).toISOString(),
    games,
    totalMinutes: games.reduce((sum, g) => sum + g.minutes, 0),
    gamesPlayed: games.length,
    methods,
    warnings,
  };
}

/** Wraps fetch so Roblox's CSRF handshake (403 + x-csrf-token, then retry) is handled. */
export function withRobloxCsrf(fetchImpl) {
  let token = null;
  return async (url, opts = {}) => {
    const send = () => fetchImpl(url, { ...opts, headers: { ...opts.headers, ...(token ? { 'x-csrf-token': token } : {}) } });
    let res = await send();
    const fresh = res?.status === 403 ? res.headers?.get?.('x-csrf-token') : null;
    if (fresh && fresh !== token) {
      token = fresh;
      res = await send();
    }
    return res;
  };
}

const cookieError = (err) =>
  err instanceof UpstreamError && (err.status === 401 || err.status === 403)
    ? new UpstreamError('Roblox didn’t accept the login cookie (it changes when that account logs out). Paste a fresh one in Settings.', err.status)
    : err;

/**
 * The Roblox tracker. poll() records one check (run on a timer by the server,
 * whether or not anyone has the dashboard open); load() builds the card data.
 */
export function createRobloxTracker({ config, fetchImpl, history, logReader = null, now = Date.now }) {
  const rc = config.roblox;
  const cookie = parseRobloxCookie(rc.cookie);
  const profile = parseRobloxUser(rc.user);
  const opts = { timeoutMs: config.timeoutMs };
  const authFetch = withRobloxCsrf(fetchImpl);
  const authed = cookie ? { cookie: `.ROBLOSECURITY=${cookie}` } : {};
  const pollMs = rc.pollSeconds * 1000;
  const memory = {};
  const info = {}; // universeId -> { name, rootPlaceId }
  const icons = {};
  const wide = {};
  const tried = {}; // universeId -> when its pictures were last asked for
  let userId = profile?.id ?? null;
  let lastPoll = { at: 0, error: null, hidden: false, playing: null, logs: null };
  let polling = null;

  async function resolveUser() {
    if (userId) return userId;
    if (profile?.name) {
      const json = await fetchJson(fetchImpl, `${USERS}/v1/usernames/users`, {
        ...opts,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: [profile.name], excludeBannedUsers: true }),
      });
      const id = json?.data?.[0]?.id;
      if (!okId(id)) throw new UpstreamError(`No Roblox user called "${profile.name}"`);
      userId = Number(id);
      return userId;
    }
    if (cookie) {
      // No username given: use the account the cookie belongs to.
      const json = await fetchJson(authFetch, `${USERS}/v1/users/authenticated`, { ...opts, headers: authed }).catch((err) => {
        throw cookieError(err);
      });
      if (!okId(json?.id)) throw new UpstreamError('Roblox didn’t say which account the cookie belongs to');
      userId = Number(json.id);
      return userId;
    }
    return null;
  }

  async function pollOnce() {
    const at = now();
    const next = { at, error: null, hidden: false, playing: null, logs: null };
    if (logReader) {
      try {
        const { dirs, sessions } = await logReader.read();
        next.logs = dirs.length > 0;
        if (dirs.length) {
          await history.addLogSessions(sessions, at);
          const live = sessions.findLast((x) => x.live);
          if (live) next.playing = { placeId: live.placeId, universeId: null, name: null };
        }
      } catch (err) {
        next.logs = false;
        console.warn(`[roblox] could not read Roblox's log files: ${err?.code ?? 'error'}`);
      }
    }
    if (cookie) {
      try {
        const id = await resolveUser();
        await history.forAccount(id);
        const json = await fetchJson(authFetch, PRESENCE, {
          ...opts,
          method: 'POST',
          headers: { ...authed, 'content-type': 'application/json' },
          body: JSON.stringify({ userIds: [id] }),
        }).catch((err) => {
          throw cookieError(err);
        });
        const p = normalizePresence(json, id);
        if (p?.type === IN_GAME && p.placeId) {
          await history.addPresence({ at, placeId: p.placeId, universeId: p.universeId, pollMs });
          next.playing = { placeId: p.placeId, universeId: p.universeId, name: p.name || null };
        } else if (p?.type === IN_GAME) {
          next.hidden = true; // in an experience, but Roblox won't say which
        }
        await history.markTracking(at);
      } catch (err) {
        next.error = err;
      }
    } else if (next.logs) {
      await history.markTracking(at);
    }
    lastPoll = next;
    return next;
  }

  /** One check; overlapping calls share it. */
  function poll() {
    polling ??= pollOnce().finally(() => {
      polling = null;
    });
    return polling;
  }

  async function lookUpUniverses(state) {
    // Newest first, so this week's experiences get their names first.
    const missing = [...new Set([...state.sessions].reverse().filter((x) => !x.u && !state.universes[x.p]).map((x) => x.p))].slice(0, MAX_LOOKUPS);
    await Promise.all(
      missing.map(async (placeId) => {
        try {
          const json = await fetchJson(fetchImpl, UNIVERSE_OF_PLACE(placeId), opts);
          if (okId(json?.universeId)) await history.setUniverse(placeId, Number(json.universeId));
        } catch {
          /* tried again next refresh */
        }
      }),
    );
  }

  return {
    poll,
    pollMs,
    async load() {
      if (now() - lastPoll.at >= pollMs || !lastPoll.at) await poll();
      const methods = { presence: Boolean(cookie), logs: Boolean(lastPoll.logs) };
      if (!methods.presence && !methods.logs) {
        throw new UpstreamError(
          logReader
            ? 'Roblox needs a login cookie (Settings → Roblox) to see which experience you’re in, or the Roblox app on this computer. No Roblox log files were found here yet.'
            : 'Roblox needs a login cookie (Settings → Roblox) to see which experience you’re in.',
        );
      }
      const state = await history.current();
      // A failed check only hides the card when the cookie is refused or there is no
      // history yet (anything else would be a misleading 0); otherwise it's a warning.
      if (cookie && lastPoll.error && !methods.logs && (lastPoll.error.status === 401 || lastPoll.error.status === 403 || state.since == null)) throw lastPoll.error;

      await lookUpUniverses(state);
      const week = computeRobloxWeek(state, now());
      const ids = [...new Set(Object.values(week.perExperience).map((v) => v.universeId).filter(okId))].slice(0, 50);
      if (lastPoll.playing?.universeId) ids.push(lastPoll.playing.universeId);
      const liveUniverse = lastPoll.playing && !lastPoll.playing.universeId ? state.universes[lastPoll.playing.placeId] : null;
      if (liveUniverse) ids.push(liveUniverse);
      const want = [...new Set(ids)].filter((u) => !info[u] || (!icons[u] && now() - (tried[u] ?? 0) > LOOKUP_AGAIN_MS));
      const list = want.join(',');
      const demo = Boolean(config.demo);
      const tasks = {};
      if (want.length) {
        tasks.names = async () => normalizeGames(await fetchJson(fetchImpl, `${GAMES}?universeIds=${list}`, opts));
        tasks.icons = async () => normalizeThumbs(await fetchJson(fetchImpl, `${THUMBS}/games/icons?universeIds=${list}&size=150x150&format=Png&isCircular=false`, opts), { demo });
        tasks.pictures = async () =>
          normalizeWideThumbs(await fetchJson(fetchImpl, `${THUMBS}/games/multiget/thumbnails?universeIds=${list}&countPerUniverse=1&size=768x432&format=Png&isCircular=false`, opts), { demo });
      }
      const id = await resolveUser().catch(() => userId);
      if (id) {
        tasks.profile = async () => {
          const u = await fetchJson(fetchImpl, `${USERS}/v1/users/${id}`, opts);
          return { id, name: String(u?.name ?? '').slice(0, 40), displayName: String(u?.displayName ?? u?.name ?? '').slice(0, 40) };
        };
        tasks.avatar = async () => normalizeThumbs(await fetchJson(fetchImpl, `${THUMBS}/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=false`, opts), { demo })[id] ?? null;
      }
      let values = {};
      const warnings = [];
      if (Object.keys(tasks).length) {
        try {
          const r = await settleAll(tasks, memory);
          values = r.values;
          // Missing pictures aren't worth a warning; missing names are.
          warnings.push(...r.warnings.filter((w) => /^(names|profile):/.test(w)));
        } catch (err) {
          warnings.push(`names: ${err.message}`);
        }
      }
      for (const u of want) tried[u] = now();
      Object.assign(info, values.names ?? {});
      Object.assign(icons, values.icons ?? {});
      Object.assign(wide, values.pictures ?? {});

      if (cookie && lastPoll.error) warnings.push(`presence: ${lastPoll.error.message}`);
      if (lastPoll.hidden)
        warnings.push(
          'Roblox says you’re in an experience but not which one. If the cookie is from a second account, make the two accounts friends and set “Who can see what experience I’m in” (Privacy settings) to Friends.',
        );

      let playing = null;
      if (lastPoll.playing) {
        const u = lastPoll.playing.universeId ?? state.universes[lastPoll.playing.placeId] ?? null;
        playing = { placeId: lastPoll.playing.placeId, universeId: u, name: (u && info[u]?.name) || lastPoll.playing.name || 'a Roblox experience' };
      }
      const user = values.profile ? { ...values.profile, avatar: values.avatar ?? null, profileUrl: `https://www.roblox.com/users/${values.profile.id}/profile` } : null;
      return buildRobloxData({ state, now: now(), info, icons, wide, user, playing, methods, warnings });
    },
  };
}
