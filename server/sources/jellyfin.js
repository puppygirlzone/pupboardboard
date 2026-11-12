// Jellyfin: recently added movies and episodes (API key from
// Dashboard -> API Keys in Jellyfin).

import { fetchJson, settleAll } from '../resilience.js';

const DAY = 86_400_000;
const TICKS_PER_MINUTE = 600_000_000;

export function jellyfinHeaders(apiKey) {
  return {
    Authorization: `MediaBrowser Client="pupboard", Device="server", DeviceId="pupboard", Version="1.0.0", Token="${apiKey}"`,
  };
}

const asArray = (v) => (Array.isArray(v) ? v : []);

export function normalizeItems(json) {
  return asArray(json?.Items).map((i) => ({
    id: String(i.Id),
    type: i.Type,
    name: String(i.Name ?? 'Untitled'),
    year: i.ProductionYear ?? null,
    addedAt: i.DateCreated ?? null,
    overview: i.Overview ?? '',
    genres: asArray(i.Genres).slice(0, 3),
    rating: Number.isFinite(i.CommunityRating) ? Math.round(i.CommunityRating * 10) / 10 : null,
    officialRating: i.OfficialRating ?? null,
    runtimeMinutes: i.RunTimeTicks ? Math.round(i.RunTimeTicks / TICKS_PER_MINUTE) : null,
    seriesId: i.SeriesId ? String(i.SeriesId) : null,
    seriesName: i.SeriesName ?? null,
    season: i.ParentIndexNumber ?? null,
    episode: i.IndexNumber ?? null,
  }));
}

/** Pure: split items into movies and shows, grouping episodes by series. */
export function groupRecent(items, now) {
  const movies = items.filter((i) => i.type === 'Movie');
  const shows = new Map();
  for (const ep of items.filter((i) => i.type === 'Episode')) {
    const key = ep.seriesId ?? ep.seriesName ?? ep.id;
    const show = shows.get(key) ?? {
      id: key,
      imageId: ep.seriesId ?? ep.id,
      name: ep.seriesName ?? ep.name,
      episodes: [],
      latestAddedAt: null,
    };
    show.episodes.push({ id: ep.id, name: ep.name, season: ep.season, episode: ep.episode, addedAt: ep.addedAt });
    if (!show.latestAddedAt || Date.parse(ep.addedAt) > Date.parse(show.latestAddedAt)) show.latestAddedAt = ep.addedAt;
    shows.set(key, show);
  }
  const showList = [...shows.values()].sort((a, b) => (Date.parse(b.latestAddedAt) || 0) - (Date.parse(a.latestAddedAt) || 0));
  const timeline = [
    ...movies.map((m) => ({ kind: 'movie', id: m.id, imageId: m.id, title: m.name, subtitle: m.year ? String(m.year) : 'Movie', addedAt: m.addedAt })),
    ...showList.map((s) => ({
      kind: 'show',
      id: s.id,
      imageId: s.imageId,
      title: s.name,
      subtitle: s.episodes.length === 1 ? 'New episode' : `${s.episodes.length} new episodes`,
      addedAt: s.latestAddedAt,
    })),
  ].sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0));

  const weekAgo = now - 7 * DAY;
  const inWeek = (d) => Date.parse(d) >= weekAgo;
  return {
    movies,
    shows: showList,
    timeline,
    addedThisWeek: {
      movies: movies.filter((m) => inWeek(m.addedAt)).length,
      episodes: items.filter((i) => i.type === 'Episode' && inWeek(i.addedAt)).length,
    },
  };
}

export function createJellyfinLoader({ config, fetchImpl, now = Date.now }) {
  const { url, apiKey } = config.jellyfin;
  const opts = { timeoutMs: config.timeoutMs, headers: jellyfinHeaders(apiKey) };
  const itemsQuery = new URLSearchParams({
    SortBy: 'DateCreated',
    SortOrder: 'Descending',
    IncludeItemTypes: 'Movie,Episode',
    Recursive: 'true',
    Limit: '60',
    Fields: 'DateCreated,Overview,Genres,ProductionYear,CommunityRating,OfficialRating',
  });

  const memory = {}; // last good value of each sub-request

  return async function loadJellyfin() {
    const { values, warnings } = await settleAll({
      items: async () => normalizeItems(await fetchJson(fetchImpl, `${url}/Items?${itemsQuery}`, opts)),
      counts: async () => {
        const c = await fetchJson(fetchImpl, `${url}/Items/Counts`, opts);
        return { movies: c?.MovieCount ?? 0, series: c?.SeriesCount ?? 0, episodes: c?.EpisodeCount ?? 0 };
      },
      server: async () => (await fetchJson(fetchImpl, `${url}/System/Info/Public`, opts))?.ServerName ?? null,
    }, memory);
    return {
      serverName: values.server ?? null,
      counts: values.counts ?? null,
      hasItems: Boolean(values.items), // false: "recently added" failed, so 0s would be wrong
      ...groupRecent(values.items ?? [], now()),
      warnings,
    };
  };
}

export function jellyfinImageUrl(config, id, height) {
  return `${config.jellyfin.url}/Items/${encodeURIComponent(id)}/Images/Primary?fillHeight=${height}&quality=85`;
}
