// Game deals and freebies. No accounts and no keys, so it works for everyone
// out of the box:
//   GamerPower (gamerpower.com/api)  free-to-keep PC games (Epic, Steam, GOG, ...)
//   CheapShark (cheapshark.com/api)  the best current Steam sales (US prices)
// Both ask for attribution, which the views show.

import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { safeImage, safeHttpLink } from './common.js';

const GAMERPOWER = 'https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date';
const CHEAPSHARK = 'https://www.cheapshark.com/api/1.0/deals?storeID=1&onSale=1&sortBy=Deal%20Rating&pageSize=20';

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const endDate = (v) => {
  const t = Date.parse(String(v ?? '').replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export function normalizeFreebies(json, opts) {
  // GamerPower answers {status: 0, ...} instead of [] when nothing is on.
  if (!Array.isArray(json)) {
    if (json && typeof json === 'object' && 'status' in json) return [];
    throw new UpstreamError('GamerPower returned an unexpected response');
  }
  return json
    .filter((g) => g && g.title && String(g.status ?? 'Active').toLowerCase() === 'active')
    .map((g) => ({
      id: String(g.id),
      title: String(g.title).replace(/\s*\(([^)]*)\)\s*Giveaway$/i, '').replace(/\s*Giveaway$/i, ''),
      store: String(g.platforms ?? '').split(',').map((s) => s.trim()).find((s) => s && !/^pc$/i.test(s)) ?? 'PC',
      worth: money(g.worth),
      image: safeImage(g.thumbnail, opts) ?? safeImage(g.image, opts),
      url: safeHttpLink(g.open_giveaway_url) ?? safeHttpLink(g.gamerpower_url),
      endsAt: endDate(g.end_date),
    }));
}

export function normalizeDeals(json, opts) {
  if (!Array.isArray(json)) throw new UpstreamError('CheapShark returned an unexpected response');
  const seen = new Set();
  return json
    .filter((d) => d && d.title && d.dealID)
    .filter((d) => (seen.has(d.title) ? false : seen.add(d.title)))
    .map((d) => {
      const appid = /^\d{1,10}$/.test(String(d.steamAppID ?? '')) ? String(d.steamAppID) : null;
      return {
        id: String(d.dealID),
        title: String(d.title),
        price: money(d.salePrice) ?? 0,
        normalPrice: money(d.normalPrice),
        savings: Math.round(Number(d.savings) || 0),
        rating: Number(d.steamRatingPercent) || null,
        image: (opts?.demo ? safeImage(d.thumb, opts) : null) ?? (appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg` : safeImage(d.thumb, opts)),
        url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(d.dealID))}`,
      };
    })
    .filter((d) => d.savings > 0);
}

export function createDealsLoader({ config, fetchImpl }) {
  const opts = { timeoutMs: config.timeoutMs, headers: { 'user-agent': 'pupboard/1.0 (+https://github.com/puppygirlzone/pupboardboard)' } };
  const parse = { demo: config.demo };
  const memory = {};
  return async function loadDeals() {
    const { values, warnings } = await settleAll({
      freebies: async () => normalizeFreebies(await fetchJson(fetchImpl, GAMERPOWER, opts), parse),
      deals: async () => normalizeDeals(await fetchJson(fetchImpl, CHEAPSHARK, opts), parse),
    }, memory);
    const freebies = values.freebies ?? [];
    const deals = values.deals ?? [];
    return {
      freebies,
      deals,
      hasFreebies: Boolean(values.freebies), // false: the call failed, so "0 free games" would be wrong
      hasDeals: Boolean(values.deals),
      freeWorth: Math.round(freebies.reduce((sum, g) => sum + (g.worth ?? 0), 0) * 100) / 100,
      bestSaving: deals.reduce((max, d) => Math.max(max, d.savings), 0),
      warnings,
    };
  };
}
