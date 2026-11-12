// Steam Web API (free; key from https://steamcommunity.com/dev/apikey).

import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { computeWeekly, trackingSince } from './steam-history.js';

const API = 'https://api.steampowered.com';

export const steamImages = {
  icon: (appid, hash) => (hash ? `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg` : null),
  header: (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
};

/**
 * What people paste into "Steam profile": a 17-digit SteamID64, a profile link
 * (steamcommunity.com/profiles/<id> or /id/<name>), or just the custom name.
 * Returns { id } or { vanity }, or null if it can't be one of those.
 */
export function parseSteamProfile(value) {
  const v = String(value ?? '').trim();
  if (/^\d{17}$/.test(v)) return { id: v };
  const link = v.match(/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  if (link) {
    if (link[1].toLowerCase() === 'profiles') return /^\d{17}$/.test(link[2]) ? { id: link[2] } : null;
    return /^[A-Za-z0-9_-]{2,32}$/.test(link[2]) ? { vanity: link[2] } : null;
  }
  return /^[A-Za-z0-9_-]{2,32}$/.test(v) ? { vanity: v } : null;
}

/**
 * Steam counts some always-running desktop apps as games, which floods the
 * hours. These are hidden unless STEAM_HIDE says otherwise ("none" shows all).
 */
export const DEFAULT_STEAM_HIDE = ['Soundpad', 'Bongo Cat', 'Wallpaper Engine'];

/** STEAM_HIDE ("Name, 12345, ...") into a matcher on { appid, name }. */
export function parseSteamHide(value) {
  const raw = String(value ?? '').trim();
  const list = raw ? (/^none$/i.test(raw) ? [] : raw.split(',')) : DEFAULT_STEAM_HIDE;
  const ids = new Set();
  const names = new Set();
  for (const item of list.map((x) => x.trim()).filter(Boolean)) {
    if (/^\d{1,10}$/.test(item)) ids.add(Number(item));
    else names.add(item.toLowerCase());
  }
  return { ids, names };
}

const isHidden = (hide, appid, name) =>
  Boolean(hide) && (hide.ids.has(Number(appid)) || (name != null && hide.names.has(String(name).trim().toLowerCase())));

/** Demo mode: invented games get local placeholder art instead of Steam's CDN. */
export function withDemoArt(data) {
  const art = (appid, w, h) => `/api/demo-art/game-${appid}?w=${w}&h=${h}`;
  return { ...data, games: data.games.map((g) => ({ ...g, header: art(g.appid, 460, 215), icon: art(g.appid, 64, 64) })) };
}

export function normalizeRecent(json) {
  const games = json?.response?.games;
  if (!Array.isArray(games)) return [];
  return games
    .filter((g) => g && Number.isFinite(Number(g.appid)))
    .map((g) => ({
      appid: Number(g.appid),
      name: String(g.name ?? `App ${g.appid}`),
      minutes2Weeks: Number(g.playtime_2weeks) || 0,
      minutesForever: Number(g.playtime_forever) || 0,
      icon: steamImages.icon(g.appid, g.img_icon_url),
      header: steamImages.header(g.appid),
    }));
}

export function normalizeOwned(json) {
  const games = json?.response?.games;
  if (!Array.isArray(games)) return null;
  const totals = {};
  const names = {};
  for (const g of games) {
    if (!g || !Number.isFinite(Number(g.appid))) continue;
    totals[g.appid] = Number(g.playtime_forever) || 0;
    names[g.appid] = { name: g.name, icon: steamImages.icon(g.appid, g.img_icon_url) };
  }
  return { totals, names, count: games.length };
}

export function normalizePlayer(json) {
  const p = json?.response?.players?.[0];
  if (!p) return null;
  const states = ['Offline', 'Online', 'Busy', 'Away', 'Snooze', 'Looking to trade', 'Looking to play'];
  return {
    name: String(p.personaname ?? 'Steam user'),
    avatar: p.avatarfull || p.avatarmedium || null,
    profileUrl: p.profileurl || null,
    status: states[p.personastate] ?? 'Offline',
    inGame: p.gameextrainfo || null,
    inGameId: Number(p.gameid) || null,
  };
}

/** Pure: turns raw pieces into the shape the frontend uses. */
export function buildSteamData({ recent: allRecent, owned, player, snapshots, now, warnings = [], hide = null }) {
  // Hidden apps (see STEAM_HIDE) are left out of every number and list.
  const recent = allRecent.filter((g) => !isHidden(hide, g.appid, g.name));
  if (player?.inGame && isHidden(hide, player.inGameId, player.inGame)) player = { ...player, inGame: null };
  const byId = new Map(allRecent.map((g) => [g.appid, g]));
  const currentTotals = owned?.totals ?? Object.fromEntries(recent.map((g) => [g.appid, g.minutesForever]));
  const weekly = snapshots ? computeWeekly(snapshots, currentTotals, now) : null;

  let period;
  let games;
  if (weekly) {
    period = { kind: 'week', label: 'Last 7 days', since: new Date(weekly.since).toISOString() };
    games = Object.entries(weekly.perGame).map(([appid, minutes]) => {
      const id = Number(appid);
      const known = byId.get(id);
      const meta = owned?.names?.[id];
      return {
        appid: id,
        name: known?.name ?? meta?.name ?? `App ${id}`,
        minutes,
        minutes2Weeks: known?.minutes2Weeks ?? minutes,
        minutesForever: currentTotals[id] ?? known?.minutesForever ?? 0,
        icon: known?.icon ?? meta?.icon ?? null,
        header: steamImages.header(id),
      };
    });
  } else {
    period = { kind: 'twoWeeks', label: 'Last 2 weeks', since: new Date(now - 14 * 86_400_000).toISOString() };
    games = recent.map((g) => ({ ...g, minutes: g.minutes2Weeks }));
  }
  games = games.filter((g) => g.minutes > 0 && !isHidden(hide, g.appid, g.name)).sort((a, b) => b.minutes - a.minutes);

  const since = snapshots ? trackingSince(snapshots) : null;
  return {
    player,
    period,
    totalMinutes: games.reduce((sum, g) => sum + g.minutes, 0),
    gamesPlayed: games.length,
    games,
    minutes2Weeks: recent.reduce((sum, g) => sum + g.minutes2Weeks, 0),
    ownedCount: owned?.count ?? null,
    trackingSince: since ? new Date(since).toISOString() : null,
    warnings,
  };
}

export function createSteamLoader({ config, fetchImpl, history, now = Date.now }) {
  const { apiKey } = config.steam;
  const hide = parseSteamHide(config.steam.hide);
  const opts = { timeoutMs: config.timeoutMs };
  const profile = parseSteamProfile(config.steam.steamId);
  let steamId = profile?.id ?? null;

  // A custom profile name is looked up once (Steam's own vanity-name lookup).
  async function resolveId() {
    if (steamId) return steamId;
    if (!profile) throw new UpstreamError('Steam profile not recognised: paste your profile link or 17-digit SteamID64');
    const json = await fetchJson(fetchImpl, `${API}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(profile.vanity)}`, opts);
    if (json?.response?.success !== 1 || !/^\d{17}$/.test(String(json.response.steamid ?? ''))) {
      throw new UpstreamError(`No Steam profile called "${profile.vanity}"`);
    }
    steamId = String(json.response.steamid);
    return steamId;
  }

  const memory = {}; // last good value of each sub-request

  return async function loadSteam() {
    const id = await resolveId();
    const auth = `key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(id)}&format=json`;
    const { values, warnings } = await settleAll({
      recent: async () => normalizeRecent(await fetchJson(fetchImpl, `${API}/IPlayerService/GetRecentlyPlayedGames/v1/?${auth}`, opts)),
      owned: async () =>
        normalizeOwned(await fetchJson(fetchImpl, `${API}/IPlayerService/GetOwnedGames/v1/?${auth}&include_appinfo=1&include_played_free_games=1`, opts)),
      player: async () =>
        normalizePlayer(
          await fetchJson(fetchImpl, `${API}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(id)}`, opts),
        ),
    }, memory);
    if (!values.recent && !values.owned) throw new Error(warnings.join('; ') || 'Steam returned no game data');

    const at = now();
    let snapshots = null;
    // Only a live full-library result becomes a snapshot. If that call failed,
    // settleAll hands back the previous totals: use history, don't record it again.
    const ownedLive = values.owned && !warnings.some((w) => w.startsWith('owned:'));
    if (ownedLive) snapshots = await history.record(values.owned.totals, at, id);
    else if (values.owned) snapshots = await history.current(id);
    const data = buildSteamData({
      recent: values.recent ?? [],
      owned: values.owned ?? null,
      player: values.player ?? null,
      snapshots,
      now: at,
      warnings,
      hide,
    });
    // Without a week of history the numbers come from "recent games". If that
    // call failed, the result would be a misleading 0h, so treat it as a failure
    // (the cache then keeps showing the last good data).
    if (data.period.kind !== 'week' && !values.recent) throw new Error(warnings.find((w) => w.startsWith('recent')) ?? 'Steam recent games unavailable');
    return config.demo ? withDemoArt(data) : data;
  };
}
