// Letterboxd: films someone watched, from their public diary RSS feed. No API
// key, just a username.

import { fetchText, settleAll, UpstreamError } from '../resilience.js';
import { tagText, toPlainText, decodeEntities } from './rss.js';
import { safeImage, safeHttpLink, DAY } from './common.js';

export const validLetterboxdUser = (v) => typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v);

/** Diary entries from the feed (list and review-only items are skipped). */
export function parseDiary(xml, opts) {
  const text = String(xml ?? '');
  if (!/<rss\b/i.test(text)) throw new UpstreamError('Letterboxd returned something that is not a feed');
  return [...text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((m) => m[1])
    .map((block) => {
      const title = tagText(block, 'letterboxd:filmTitle');
      if (!title) return null;
      const rating = Number(tagText(block, 'letterboxd:memberRating'));
      const watched = tagText(block, 'letterboxd:watchedDate');
      const poster = decodeEntities(tagText(block, 'description')?.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '');
      return {
        title: toPlainText(title, 200),
        year: /^\d{4}$/.test(tagText(block, 'letterboxd:filmYear') ?? '') ? Number(tagText(block, 'letterboxd:filmYear')) : null,
        rating: Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating : null,
        watchedDate: /^\d{4}-\d{2}-\d{2}$/.test(watched ?? '') ? watched : null,
        rewatch: /^yes$/i.test(tagText(block, 'letterboxd:rewatch') ?? ''),
        liked: /^yes$/i.test(tagText(block, 'letterboxd:memberLike') ?? ''),
        poster: safeImage(poster, opts),
        link: safeHttpLink(tagText(block, 'link')?.trim()),
      };
    })
    .filter(Boolean);
}

/** Pure: counts for the cards. Dates are whole days, compared at UTC noon so time zones can't shift them. */
export function diaryStats(films, now) {
  const age = (f) => (f.watchedDate ? (now - Date.parse(`${f.watchedDate}T12:00:00Z`)) / DAY : Infinity);
  const rated = films.filter((f) => f.rating != null);
  return {
    thisWeek: films.filter((f) => age(f) < 7).length,
    thisMonth: films.filter((f) => age(f) < 30).length,
    averageRating: rated.length ? Math.round((rated.reduce((s, f) => s + f.rating, 0) / rated.length) * 10) / 10 : null,
    liked: films.filter((f) => f.liked).length,
  };
}

export function createLetterboxdLoader({ config, fetchImpl, now = Date.now }) {
  const user = config.letterboxd.user;
  const opts = { timeoutMs: config.timeoutMs, headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8', 'user-agent': 'pupboard/1.0 (RSS reader)' } };
  const memory = {};
  return async function loadLetterboxd() {
    const { values, warnings } = await settleAll({
      diary: async () => {
        try {
          return parseDiary(await fetchText(fetchImpl, `https://letterboxd.com/${encodeURIComponent(user)}/rss/`, opts), { demo: config.demo });
        } catch (err) {
          if (err.status === 404) throw new UpstreamError(`Letterboxd user "${user}" not found`, 404);
          throw err;
        }
      },
    }, memory);
    const films = values.diary ?? [];
    // The feed holds roughly the latest 50 entries, so "this month" can be a minimum for heavy watchers.
    return {
      user,
      profileUrl: `https://letterboxd.com/${encodeURIComponent(user)}/`,
      films,
      stats: diaryStats(films, now()),
      capped: films.length >= 50,
      warnings,
    };
  };
}
