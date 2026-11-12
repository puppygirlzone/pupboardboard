// Pure render functions: data in, HTML string out. No DOM access, so they
// run in Node tests too. Every function copes with missing/partial data.
//
// Animation hooks read by motion.js:
//   data-anim             element fades/slides in (staggered)
//   data-count=N          number counts up to N (text already holds the final value)
//   data-bar=0..1         bar grows to this fraction of its track

import { escapeHtml as e, formatMinutes, formatDuration, timeAgo, toHours, plural } from './format.js';

const ICONS = {
  steam:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9h4M9 7v4M15 10h.01M18 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M6.5 5h11A4.5 4.5 0 0 1 22 9.5v3.2a3.3 3.3 0 0 1-6 1.9L15 13H9l-1 1.6a3.3 3.3 0 0 1-6-1.9V9.5A4.5 4.5 0 0 1 6.5 5Z" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  navidrome:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="17" cy="16" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>',
  jellyfin:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" stroke="currentColor" stroke-width="1.6"/></svg>',
};

ICONS.rss =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round"/><circle cx="6" cy="18" r="1.8" fill="currentColor"/></svg>';

export const SOURCES = {
  steam: { title: 'Gaming', route: '#/gaming', env: 'STEAM_API_KEY and STEAM_ID' },
  navidrome: { title: 'Music', route: '#/music', env: 'NAVIDROME_URL, NAVIDROME_USER and NAVIDROME_PASSWORD' },
  jellyfin: { title: 'Media', route: '#/media', env: 'JELLYFIN_URL and JELLYFIN_API_KEY' },
  rss: { title: 'News', route: '#/news', env: 'RSS_FEEDS', setup: 'Add feeds on the <a href="/setup.html">Settings</a> page, or to <code>config/feeds.txt</code>, one per line. No restart needed.' },
};

export const coverUrl = (id, size = 300) => (id ? `/api/img/navidrome/${encodeURIComponent(id)}?size=${size}` : '');
export const posterUrl = (id, size = 360) => (id ? `/api/img/jellyfin/${encodeURIComponent(id)}?size=${size}` : '');

const img = (src, alt, cls) =>
  src
    ? `<img class="${cls}" src="${e(src)}" alt="${e(alt)}" loading="lazy" decoding="async" data-fallback>`
    : `<div class="${cls} img-missing" role="img" aria-label="${e(alt)}"></div>`;

const count = (value, text, { decimals = 0, suffix = '' } = {}) =>
  `<span data-count="${Number(value) || 0}" data-decimals="${decimals}" data-suffix="${e(suffix)}">${e(text)}</span>`;

const bar = (fraction, cls = '') =>
  `<span class="bar ${cls}"><span class="bar-fill" data-bar="${Math.max(0, Math.min(1, Number(fraction) || 0)).toFixed(3)}"></span></span>`;

const stat = (label, valueHtml, sub = '') =>
  `<div class="stat" data-anim><div class="stat-value">${valueHtml}</div><div class="stat-label">${e(label)}</div>${sub ? `<div class="stat-sub">${e(sub)}</div>` : ''}</div>`;

/** Small pill describing freshness of a source envelope. */
export function statusPill(env, now = Date.now()) {
  if (!env || env.status === 'loading') return '<span class="pill pill-muted">Loading</span>';
  const warnings = env.data?.warnings ?? [];
  switch (env.status) {
    case 'ok':
      return warnings.length
        ? `<span class="pill pill-warn" title="${e(warnings.join('\n'))}">Partial · ${e(timeAgo(env.updatedAt, now))}</span>`
        : `<span class="pill pill-ok">Live · ${e(timeAgo(env.updatedAt, now))}</span>`;
    case 'stale':
      return `<span class="pill pill-warn" title="${e(env.error ?? '')}">Offline · from ${e(timeAgo(env.updatedAt, now))}</span>`;
    case 'offline':
      return `<span class="pill pill-warn" title="Dashboard server unreachable">Saved copy · ${e(timeAgo(env.updatedAt, now))}</span>`;
    case 'unconfigured':
      return '<span class="pill pill-muted">Not set up</span>';
    default:
      return `<span class="pill pill-err" title="${e(env.error ?? '')}">Unavailable</span>`;
  }
}

/** Shown in place of content when a source has no data at all. */
export function emptyState(key, env) {
  const meta = SOURCES[key];
  if (!env || env.status === 'loading') return '<div class="empty" data-anim><div class="spinner"></div><p>Loading…</p></div>';
  if (env.status === 'unconfigured') {
    // meta.setup is a fixed string from SOURCES (trusted), not upstream data.
    const how = meta.setup ?? `Connect it on the <a href="/setup.html">Settings</a> page, or set ${e(meta.env)} in your <code>.env</code> file and restart.`;
    return `<div class="empty" data-anim><p><strong>${e(meta.title)} isn't connected yet.</strong></p><p class="muted">${how}</p></div>`;
  }
  return `<div class="empty" data-anim><p><strong>Couldn't reach ${e(key)}.</strong></p><p class="muted">${e(env.error ?? 'Unknown error')}</p><p class="muted">Retrying automatically.</p></div>`;
}

function cardShell(key, env, body, now) {
  const meta = SOURCES[key];
  return `<article class="card card-${key}" data-anim>
  <header class="card-head">
    <a class="card-title" href="${meta.route}"><span class="icon">${ICONS[key]}</span>${e(meta.title)}</a>
    ${statusPill(env, now)}
  </header>
  <div class="card-body">${body}</div>
  <a class="card-more" href="${meta.route}">More details <span aria-hidden="true">→</span></a>
</article>`;
}

/* ---------------------------------------------------------------- Gaming */

function gameRows(games, limit, maxMinutes) {
  return games
    .slice(0, limit)
    .map(
      (g) => `<li class="row" data-anim>
  ${img(g.icon || g.header, g.name, 'thumb thumb-game')}
  <div class="row-main"><div class="row-title">${e(g.name)}</div>${bar(g.minutes / maxMinutes, 'bar-steam')}</div>
  <div class="row-value">${e(formatMinutes(g.minutes))}</div>
</li>`,
    )
    .join('');
}

export function steamGlance(env, now = Date.now()) {
  const d = env?.data;
  if (!d) return cardShell('steam', env, emptyState('steam', env), now);
  const max = d.games[0]?.minutes || 1;
  const playing = d.player?.inGame ? `<div class="now-pill" data-anim><span class="dot"></span>Playing ${e(d.player.inGame)}</div>` : '';
  const body = `${playing}
<div class="stats">
  ${stat(d.period.label, count(toHours(d.totalMinutes), `${toHours(d.totalMinutes)}h`, { decimals: 1, suffix: 'h' }), 'hours played')}
  ${stat('Games played', count(d.gamesPlayed, String(d.gamesPlayed)))}
</div>
${d.games.length ? `<ul class="rows">${gameRows(d.games, 4, max)}</ul>` : '<p class="muted" data-anim>No games played in this period.</p>'}`;
  return cardShell('steam', env, body, now);
}

/**
 * Minutes played in the last 7 days for one game. Exact once a week of
 * history exists; before that, an estimate of half Steam's 2-week figure.
 */
export function sevenDayMinutes(game, period) {
  if (period?.kind === 'week') return { minutes: Number(game?.minutes) || 0, estimated: false };
  return { minutes: Math.round((Number(game?.minutes2Weeks) || 0) / 2), estimated: true };
}

/**
 * Slices for the play-time donut: top games plus an "Other" bucket.
 * Percentages add up to 100; `start` is where each slice begins (0-100).
 */
export function donutSlices(games, maxSlices = 5) {
  const list = (games ?? []).filter((g) => Number(g?.minutes) > 0);
  const total = list.reduce((sum, g) => sum + Number(g.minutes), 0);
  if (!total) return null;
  const top = list.slice(0, maxSlices).map((g, i) => ({ label: String(g.name ?? 'Unknown'), minutes: Number(g.minutes), cls: `seg-${i}` }));
  const rest = list.slice(maxSlices).reduce((sum, g) => sum + Number(g.minutes), 0);
  if (rest > 0) top.push({ label: 'Other', minutes: rest, cls: 'seg-other' });
  let start = 0;
  const slices = top.map((s) => {
    const pct = (s.minutes / total) * 100;
    const slice = { ...s, pct, start };
    start += pct;
    return slice;
  });
  return { total, slices };
}

/** SVG donut drawn in its final state; motion.js spins and grows it on load. */
function donutChart(games) {
  const data = donutSlices(games);
  if (!data) return '';
  const GAP = data.slices.length > 1 ? 0.8 : 0; // small gap between slices
  const R = 48;
  const segs = data.slices
    .map((s) => {
      const len = Math.max(s.pct - GAP, 0.01).toFixed(3);
      return `<circle class="donut-seg ${s.cls}" cx="60" cy="60" r="${R}" pathLength="100" stroke-dasharray="${len} ${(100 - len).toFixed(3)}" stroke-dashoffset="${(-s.start).toFixed(3)}" data-pct="${len}"><title>${e(s.label)}: ${Math.round(s.pct)}%</title></circle>`;
    })
    .join('');
  const label = data.slices.map((s) => `${s.label} ${Math.round(s.pct)}%`).join(', ');
  const legend = data.slices
    .map((s) => `<li class="legend-item" data-anim><span class="swatch ${s.cls}"></span><span class="legend-name">${e(s.label)}</span><span class="legend-pct">${Math.round(s.pct)}%</span></li>`)
    .join('');
  const hours = toHours(data.total);
  return `<figure class="donut-wrap" data-anim>
  <div class="donut-box">
    <svg class="donut" viewBox="0 0 120 120" role="img" aria-label="${e(`Share of play time: ${label}`)}">
      <circle class="donut-track" cx="60" cy="60" r="${R}"/>
      <g transform="rotate(-90 60 60)">${segs}</g>
    </svg>
    <div class="donut-center">${count(hours, `${hours}h`, { decimals: 1, suffix: 'h' })}<span class="muted small">played</span></div>
  </div>
  <figcaption><ul class="legend">${legend}</ul></figcaption>
</figure>`;
}

export function steamDetail(env, now = Date.now()) {
  const d = env?.data;
  const head = pageHead('steam', 'Gaming', env, now);
  if (!d) return head + emptyState('steam', env);
  const max = d.games[0]?.minutes || 1;
  const player = d.player
    ? `<div class="profile" data-anim>${img(d.player.avatar, d.player.name, 'avatar')}<div><div class="profile-name">${e(d.player.name)}</div><div class="muted">${e(d.player.inGame ? `Playing ${d.player.inGame}` : d.player.status)}</div></div></div>`
    : '';
  const tracking =
    d.period.kind === 'week'
      ? `Counting playtime since ${new Date(d.period.since).toLocaleDateString()}.`
      : d.trackingSince
        ? `Steam only reports 2-week totals. Daily tracking started ${timeAgo(d.trackingSince, now)}; the 7-day view switches on after a week of history.`
        : "Steam only reports 2-week totals. Weekly tracking starts once your game library is readable (set Steam profile 'Game details' to public).";
  const games = d.games
    .map(
      (g) => `<article class="game" data-anim>
  ${img(g.header, g.name, 'game-art')}
  <div class="game-body">
    <h3>${e(g.name)}</h3>
    ${bar(g.minutes / max, 'bar-steam')}
    <dl class="game-stats">
      ${(() => {
        const week = sevenDayMinutes(g, d.period);
        return week.estimated
          ? `<div title="Estimate: half of Steam's 2-week total, until a week of play history has been recorded"><dt>Last 7 days</dt><dd>~${e(formatMinutes(week.minutes))}</dd></div>`
          : `<div><dt>Last 7 days</dt><dd>${e(formatMinutes(week.minutes))}</dd></div>`;
      })()}
      <div><dt>Last 2 weeks</dt><dd>${e(formatMinutes(g.minutes2Weeks))}</dd></div>
      <div><dt>All time</dt><dd>${e(formatMinutes(g.minutesForever))}</dd></div>
    </dl>
  </div>
</article>`,
    )
    .join('');
  return `${head}
<section class="gaming-hero">
  ${player || '<div></div>'}
  ${donutChart(d.games)}
</section>
<section class="stats stats-wide">
  ${stat(d.period.label, count(toHours(d.totalMinutes), `${toHours(d.totalMinutes)}h`, { decimals: 1, suffix: 'h' }), 'hours played')}
  ${stat('Games played', count(d.gamesPlayed, String(d.gamesPlayed)))}
  ${d.period.kind === 'week' ? stat('Last 2 weeks', count(toHours(d.minutes2Weeks), `${toHours(d.minutes2Weeks)}h`, { decimals: 1, suffix: 'h' }), 'per Steam') : ''}
  ${d.ownedCount != null ? stat('Games owned', count(d.ownedCount, String(d.ownedCount))) : ''}
</section>
<p class="note" data-anim>${e(tracking)}</p>
${games ? `<section class="games">${games}</section>` : '<p class="muted" data-anim>No games played in this period.</p>'}
${warningsNote(d)}`;
}

/* ----------------------------------------------------------------- Music */

function nowPlayingBlock(np, large = false) {
  if (!np) return '';
  return `<div class="now-playing ${large ? 'now-playing-lg' : ''}" data-anim>
  ${img(coverUrl(np.coverId, large ? 400 : 160), np.album || np.title, 'cover')}
  <div class="np-text">
    <div class="np-label"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Now playing${np.user ? ` · ${e(np.user)}` : ''}</div>
    <div class="np-title">${e(np.title)}</div>
    <div class="muted">${e(np.artist)}${np.album ? ` — ${e(np.album)}` : ''}</div>
  </div>
</div>`;
}

function trackRows(tracks, limit, now) {
  return tracks
    .slice(0, limit)
    .map(
      (t) => `<li class="row" data-anim>
  ${img(coverUrl(t.coverId, 96), t.album, 'thumb')}
  <div class="row-main"><div class="row-title">${e(t.title)}</div><div class="muted small">${e(t.artist)}</div></div>
  <div class="row-value muted small">${e(timeAgo(t.playDate, now))}</div>
</li>`,
    )
    .join('');
}

export function navidromeGlance(env, now = Date.now()) {
  const d = env?.data;
  if (!d) return cardShell('navidrome', env, emptyState('navidrome', env), now);
  const s = d.stats ?? {};
  const known = d.hasSongHistory !== false; // false when Navidrome's history call failed
  const top = s.topArtists?.[0];
  const body = `${nowPlayingBlock(d.nowPlaying?.[0])}
<div class="stats">
  ${stat('Tracks this week', known ? count(s.tracksThisWeek, String(s.tracksThisWeek ?? 0)) : '—')}
  ${stat('Listening time', known ? count(toHours(s.minutesThisWeek), `${toHours(s.minutesThisWeek)}h`, { decimals: 1, suffix: 'h' }) : '—', 'at least')}
</div>
${top ? `<p class="highlight" data-anim>Top artist: <strong>${e(top.name)}</strong> <span class="muted">(${plural(top.plays, 'track')})</span></p>` : ''}
${d.recentlyPlayed?.length ? `<ul class="rows">${trackRows(d.recentlyPlayed, 4, now)}</ul>` : `<p class="muted" data-anim>${d.hasSongHistory ? 'Nothing played recently.' : 'Play history unavailable.'}</p>`}`;
  return cardShell('navidrome', env, body, now);
}

function rankList(items, labelFn, cls) {
  if (!items?.length) return '<p class="muted">Nothing yet this week.</p>';
  const max = items[0].plays || 1;
  return `<ol class="rank">${items
    .map(
      (it) => `<li data-anim><div class="rank-head"><span>${labelFn(it)}</span><span class="muted small">${plural(it.plays, 'track')}</span></div>${bar(it.plays / max, cls)}</li>`,
    )
    .join('')}</ol>`;
}

export function navidromeDetail(env, now = Date.now()) {
  const d = env?.data;
  const head = pageHead('navidrome', 'Music', env, now);
  if (!d) return head + emptyState('navidrome', env);
  const s = d.stats ?? {};
  const known = d.hasSongHistory !== false;
  const nowPlaying = (d.nowPlaying ?? []).map((np) => nowPlayingBlock(np, true)).join('');
  const albumGrid = (albums) =>
    albums?.length
      ? `<div class="tiles">${albums
          .map(
            (a) => `<figure class="tile" data-anim>${img(coverUrl(a.coverId, 300), a.name, 'tile-art')}<figcaption><div class="row-title">${e(a.name)}</div><div class="muted small">${e(a.artist)}${a.playCount ? ` · ${plural(a.playCount, 'play')}` : ''}</div></figcaption></figure>`,
          )
          .join('')}</div>`
      : '<p class="muted">No albums yet.</p>';
  const topSongs = d.topSongs?.length
    ? `<ol class="table">${d.topSongs
        .map(
          (t, i) => `<li data-anim><span class="num">${i + 1}</span><div class="row-main"><div class="row-title">${e(t.title)}</div><div class="muted small">${e(t.artist)} — ${e(t.album)}</div></div><span class="muted small">${formatDuration(t.duration)}</span><span class="row-value">${plural(t.playCount, 'play')}</span></li>`,
        )
        .join('')}</ol>`
    : '<p class="muted">No play counts yet.</p>';

  return `${head}
${nowPlaying}
<section class="stats stats-wide">
  ${stat('Tracks this week', known ? count(s.tracksThisWeek, String(s.tracksThisWeek ?? 0)) : '—')}
  ${stat('Listening time', known ? count(toHours(s.minutesThisWeek), `${toHours(s.minutesThisWeek)}h`, { decimals: 1, suffix: 'h' }) : '—', 'at least, this week')}
  ${stat('Artists this week', known ? count(s.topArtists?.length ?? 0, String(s.topArtists?.length ?? 0)) : '—', 'top 5 shown')}
  ${stat('Top genre', e(s.topGenres?.[0]?.name ?? '—'))}
</section>
<div class="columns">
  <section class="panel" data-anim><h2>Top artists this week</h2>${rankList(s.topArtists, (a) => e(a.name), 'bar-music')}</section>
  <section class="panel" data-anim><h2>Top albums this week</h2>${rankList(s.topAlbums, (a) => `${e(a.name)} <span class="muted small">${e(a.artist)}</span>`, 'bar-music')}</section>
  <section class="panel" data-anim><h2>Top genres this week</h2>${rankList(s.topGenres, (g) => e(g.name), 'bar-music')}</section>
</div>
<div class="columns columns-2">
  <section class="panel" data-anim><h2>Recently played</h2>${d.recentlyPlayed?.length ? `<ul class="rows">${trackRows(d.recentlyPlayed, 15, now)}</ul>` : '<p class="muted">No history available.</p>'}</section>
  <section class="panel" data-anim><h2>Most played songs (all time)</h2>${topSongs}</section>
</div>
<section class="panel" data-anim><h2>Recently played albums</h2>${albumGrid(d.recentAlbums)}</section>
<section class="panel" data-anim><h2>Most played albums</h2>${albumGrid(d.frequentAlbums)}</section>
<p class="note" data-anim>Navidrome stores only the latest play of each song, so weekly counts are a minimum.</p>
${warningsNote(d)}`;
}

/* ----------------------------------------------------------------- Media */

export function jellyfinGlance(env, now = Date.now()) {
  const d = env?.data;
  if (!d) return cardShell('jellyfin', env, emptyState('jellyfin', env), now);
  const c = d.counts;
  const week = d.addedThisWeek ?? { movies: 0, episodes: 0 };
  const posters = (d.timeline ?? [])
    .slice(0, 5)
    .map(
      (t) => `<figure class="poster" data-anim>${img(posterUrl(t.imageId, 300), t.title, 'poster-art')}<figcaption><div class="row-title">${e(t.title)}</div><div class="muted small">${e(t.subtitle)} · ${e(timeAgo(t.addedAt, now))}</div></figcaption></figure>`,
    )
    .join('');
  const known = d.hasItems !== false;
  const body = `<div class="stats">
  ${stat('New movies', known ? count(week.movies, String(week.movies)) : '—', 'this week')}
  ${stat('New episodes', known ? count(week.episodes, String(week.episodes)) : '—', 'this week')}
</div>
${c ? `<p class="highlight" data-anim>Library: <strong>${c.movies}</strong> movies · <strong>${c.series}</strong> shows · <strong>${c.episodes}</strong> episodes</p>` : ''}
${posters ? `<div class="poster-strip">${posters}</div>` : `<p class="muted" data-anim>${known ? 'Nothing added recently.' : 'Recently added items unavailable right now.'}</p>`}`;
  return cardShell('jellyfin', env, body, now);
}

export function jellyfinDetail(env, now = Date.now()) {
  const d = env?.data;
  const head = pageHead('jellyfin', 'Media', env, now);
  if (!d) return head + emptyState('jellyfin', env);
  const c = d.counts;
  const known = d.hasItems !== false;
  const added = (d.addedThisWeek?.movies ?? 0) + (d.addedThisWeek?.episodes ?? 0);
  const movies = (d.movies ?? [])
    .map(
      (m) => `<article class="media-card" data-anim>
  ${img(posterUrl(m.id, 360), m.name, 'media-art')}
  <div class="media-body">
    <h3>${e(m.name)} ${m.year ? `<span class="muted">(${m.year})</span>` : ''}</h3>
    <div class="chips">${[m.officialRating, m.runtimeMinutes ? formatMinutes(m.runtimeMinutes) : null, m.rating ? `★ ${m.rating}` : null, ...m.genres]
      .filter(Boolean)
      .map((x) => `<span class="chip">${e(x)}</span>`)
      .join('')}</div>
    <p class="overview">${e(m.overview)}</p>
    <div class="muted small">Added ${e(timeAgo(m.addedAt, now))}</div>
  </div>
</article>`,
    )
    .join('');
  const shows = (d.shows ?? [])
    .map(
      (s) => `<article class="media-card" data-anim>
  ${img(posterUrl(s.imageId, 360), s.name, 'media-art')}
  <div class="media-body">
    <h3>${e(s.name)}</h3>
    <div class="muted small">${plural(s.episodes.length, 'new episode')} · latest ${e(timeAgo(s.latestAddedAt, now))}</div>
    <ul class="episodes">${s.episodes
      .map((ep) => `<li><span class="chip">${ep.season != null ? `S${String(ep.season).padStart(2, '0')}` : ''}${ep.episode != null ? `E${String(ep.episode).padStart(2, '0')}` : ''}</span> ${e(ep.name)}</li>`)
      .join('')}</ul>
  </div>
</article>`,
    )
    .join('');
  return `${head}
<section class="stats stats-wide">
  ${c ? stat('Movies', count(c.movies, String(c.movies)), 'in library') : ''}
  ${c ? stat('Shows', count(c.series, String(c.series)), 'in library') : ''}
  ${c ? stat('Episodes', count(c.episodes, String(c.episodes)), 'in library') : ''}
  ${stat('Added this week', known ? count(added, String(added)) : '—', 'movies + episodes')}
</section>
<h2 class="section-title" data-anim>Recently added movies</h2>
${movies ? `<section class="media-grid">${movies}</section>` : `<p class="muted" data-anim>${known ? 'No movies added recently.' : 'Recently added items unavailable right now.'}</p>`}
<h2 class="section-title" data-anim>Recently added episodes</h2>
${shows ? `<section class="media-grid">${shows}</section>` : '<p class="muted" data-anim>No episodes added recently.</p>'}
${warningsNote(d)}`;
}

/* ------------------------------------------------------------------ News */

/** Only http(s) links are ever rendered as links. */
const safeHref = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null);

function feedItem(it, now, { summary = false, showFeed = true } = {}) {
  const href = safeHref(it.link);
  const title = href
    ? `<a class="feed-title" href="${e(href)}" target="_blank" rel="noopener noreferrer">${e(it.title)}</a>`
    : `<span class="feed-title">${e(it.title)}</span>`;
  const meta = [showFeed ? e(it.feed) : '', it.date ? e(timeAgo(it.date, now)) : ''].filter(Boolean).join(' · ');
  return `<li class="feed-item" data-anim>
  ${title}
  ${summary && it.summary ? `<p class="feed-summary">${e(it.summary)}</p>` : ''}
  ${meta ? `<div class="muted small">${meta}</div>` : ''}
</li>`;
}

export function rssGlance(env, now = Date.now()) {
  const d = env?.data;
  if (!d) return cardShell('rss', env, emptyState('rss', env), now);
  const feeds = d.feeds ?? [];
  const working = feeds.filter((f) => f.ok).length;
  const body = `<div class="stats">
  ${stat('New today', count(d.newToday ?? 0, String(d.newToday ?? 0)), 'last 24 hours')}
  ${stat('Feeds', `${working}/${feeds.length}`, working === feeds.length ? 'all reachable' : 'some unreachable')}
</div>
${d.latest?.length ? `<ul class="feed-list">${d.latest.slice(0, 6).map((it) => feedItem(it, now)).join('')}</ul>` : '<p class="muted" data-anim>No stories yet.</p>'}`;
  return cardShell('rss', env, body, now);
}

export function rssDetail(env, now = Date.now()) {
  const d = env?.data;
  const head = pageHead('rss', 'News', env, now);
  if (!d) return head + emptyState('rss', env);
  const latest = d.latest?.length
    ? `<ul class="feed-list">${d.latest.slice(0, 15).map((it) => feedItem(it, now, { summary: true })).join('')}</ul>`
    : '<p class="muted">No stories yet.</p>';
  const perFeed = (d.feeds ?? [])
    .map((f) => {
      const site = safeHref(f.site);
      const name = site ? `<a href="${e(site)}" target="_blank" rel="noopener noreferrer">${e(f.name)}</a>` : e(f.name);
      const list = f.items?.length
        ? `<ul class="feed-list">${f.items.slice(0, 10).map((it) => feedItem(it, now, { showFeed: false })).join('')}</ul>`
        : `<p class="muted">${f.ok ? 'No stories in this feed.' : "Couldn't load this feed right now."}</p>`;
      return `<section class="panel" data-anim><h2>${name}</h2>${list}</section>`;
    })
    .join('');
  return `${head}
<section class="stats stats-wide">
  ${stat('New today', count(d.newToday ?? 0, String(d.newToday ?? 0)), 'last 24 hours')}
  ${stat('Feeds', String((d.feeds ?? []).length), { file: 'from config/feeds.txt', env: 'from RSS_FEEDS', default: 'built-in defaults', demo: 'demo feeds' }[d.listFrom] ?? 'subscribed')}
</section>
<div class="columns columns-2">
  <section class="panel" data-anim><h2>Latest from all feeds</h2>${latest}</section>
  ${perFeed}
</div>
${warningsNote(d)}`;
}

/* ---------------------------------------------------------------- Shared */

function pageHead(key, title, env, now) {
  return `<header class="page-head" data-anim>
  <a class="back" href="#/">← Overview</a>
  <h1><span class="icon icon-${key}">${ICONS[key]}</span>${e(title)}</h1>
  ${statusPill(env, now)}
</header>`;
}

function warningsNote(d) {
  if (!d?.warnings?.length) return '';
  return `<details class="warnings" data-anim><summary>Some data couldn't be loaded (${d.warnings.length})</summary><ul>${d.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul></details>`;
}

export function overview(summary, now = Date.now()) {
  return `<section class="grid">
${steamGlance(summary?.steam, now)}
${navidromeGlance(summary?.navidrome, now)}
${jellyfinGlance(summary?.jellyfin, now)}
${rssGlance(summary?.rss, now)}
</section>`;
}

/** Route name -> { source key or null, render(summary, now) } */
export const ROUTES = {
  '': { key: null, render: (s, now) => overview(s, now) },
  gaming: { key: 'steam', render: (s, now) => steamDetail(s?.steam, now) },
  music: { key: 'navidrome', render: (s, now) => navidromeDetail(s?.navidrome, now) },
  media: { key: 'jellyfin', render: (s, now) => jellyfinDetail(s?.jellyfin, now) },
  news: { key: 'rss', render: (s, now) => rssDetail(s?.rss, now) },
};

export function resolveRoute(hash) {
  const name = String(hash ?? '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return ROUTES[name] ? name : '';
}
