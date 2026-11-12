// Game deals and free games, in US dollars, Australian dollars or pounds.
// No accounts and no keys, so it works for everyone out of the box:
//   CheapShark (cheapshark.com/api)  which Steam games are on sale (a US list)
//   Steam store (appdetails)         the real local price of those games
//   GOG catalog (catalog.gog.com)    GOG sales, natively in each currency
//   Epic store (freeGamesPromotions) Epic's free games, with their local price
//   GamerPower (gamerpower.com/api)  free games from other stores (US worth)
//   Frankfurter (frankfurter.dev)    exchange rates, only to estimate GamerPower worth
// GOG's and Epic's endpoints are public but undocumented: if one changes,
// its section shows "—" like any other failed call.

import { fetchJson, settleAll, UpstreamError } from '../resilience.js';
import { safeImage, safeHttpLink } from './common.js';

export const CURRENCIES = ['USD', 'AUD', 'GBP'];
const COUNTRY = { USD: 'US', AUD: 'AU', GBP: 'GB' };
const STEAM_CC = { USD: 'us', AUD: 'au', GBP: 'gb' };

const GAMERPOWER = 'https://www.gamerpower.com/api/giveaways?platform=pc&type=game&sort-by=date';
const CHEAPSHARK = 'https://www.cheapshark.com/api/1.0/deals?storeID=1&onSale=1&sortBy=Deal%20Rating&pageSize=20';
const gogUrl = (cur) => `https://catalog.gog.com/v1/catalog?limit=12&order=desc:trending&discounted=eq:true&productType=in:game&countryCode=${COUNTRY[cur]}&currencyCode=${cur}&locale=en-US`;
const epicUrl = (cur) => `https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${COUNTRY[cur]}&allowCountries=${COUNTRY[cur]}`;
const steamUrl = (ids, cur) => `https://store.steampowered.com/api/appdetails?appids=${ids.join(',')}&cc=${STEAM_CC[cur]}&filters=price_overview`;
const RATES = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD,GBP';

export const validCurrency = (v) => (CURRENCIES.includes(String(v ?? '').toUpperCase()) ? String(v).toUpperCase() : 'USD');

const money = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};
const endDate = (v) => {
  const t = Date.parse(String(v ?? '').replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/* ------------------------------------------------------------ free games */

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
      worthCurrency: 'USD',
      image: safeImage(g.thumbnail, opts) ?? safeImage(g.image, opts),
      url: safeHttpLink(g.open_giveaway_url) ?? safeHttpLink(g.gamerpower_url),
      endsAt: endDate(g.end_date),
    }));
}

/** Epic games that are free right now, with their normal local price. */
export function normalizeEpicFree(json, opts, now = Date.now()) {
  const els = json?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(els)) throw new UpstreamError('Epic returned an unexpected response');
  return els
    .map((e) => {
      const offer = e?.promotions?.promotionalOffers?.[0]?.promotionalOffers?.find((o) => Date.parse(o.startDate) <= now && Date.parse(o.endDate) > now);
      const price = e?.price?.totalPrice;
      if (!offer || !price || price.discountPrice !== 0 || !(price.originalPrice > 0)) return null;
      const decimals = Number(price.currencyInfo?.decimals ?? 2);
      const slug = [e.productSlug, e.catalogNs?.mappings?.[0]?.pageSlug, e.offerMappings?.[0]?.pageSlug].find((s) => typeof s === 'string' && /^[\w-]+$/.test(s));
      const image = (e.keyImages ?? []).find((k) => k.type === 'OfferImageWide') ?? (e.keyImages ?? []).find((k) => k.type === 'Thumbnail');
      return {
        id: `epic-${String(e.id ?? slug)}`,
        title: String(e.title ?? 'Free game'),
        store: 'Epic Games Store',
        worth: Math.round(price.originalPrice) / 10 ** decimals,
        worthCurrency: String(price.currencyCode ?? 'USD'),
        image: safeImage(image?.url, opts),
        url: slug ? `https://store.epicgames.com/p/${slug}` : 'https://store.epicgames.com/free-games',
        endsAt: endDate(offer.endDate),
      };
    })
    .filter(Boolean);
}

/**
 * Epic's own list first (local prices), then GamerPower's other stores.
 * GamerPower only knows US worth: with an exchange rate it's converted and
 * marked approximate; without one it stays in US dollars.
 */
export function mergeFreebies({ epic, gamerpower, currency, rate }) {
  const titles = new Set((epic ?? []).map((g) => g.title.toLowerCase()));
  const others = (gamerpower ?? [])
    .filter((g) => !(epic && /epic/i.test(g.store)) && !titles.has(g.title.toLowerCase()))
    .map((g) => (currency !== 'USD' && g.worth && rate ? { ...g, worth: Math.round(g.worth * rate * 100) / 100, worthCurrency: currency, worthApprox: true } : g));
  return [...(epic ?? []), ...others];
}

/* ------------------------------------------------------------ sales */

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
        appid,
        title: String(d.title),
        price: money(d.salePrice) ?? 0,
        normalPrice: money(d.normalPrice),
        savings: Math.round(Number(d.savings) || 0),
        currency: 'USD',
        store: 'Steam',
        rating: Number(d.steamRatingPercent) || null,
        image: (opts?.demo ? safeImage(d.thumb, opts) : null) ?? (appid ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/capsule_231x87.jpg` : safeImage(d.thumb, opts)),
        url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(String(d.dealID))}`, // CheapShark's terms ask for their redirect links
      };
    })
    .filter((d) => d.savings > 0);
}

/**
 * Swap CheapShark's US prices for Steam's real local ones. A game that isn't
 * discounted (or isn't sold) in that region is dropped; a deal Steam can't
 * price keeps its US price, labelled as such.
 */
export function localiseSteam(deals, json, currency) {
  return deals
    .map((d) => {
      const entry = d.appid ? json?.[d.appid] : null;
      if (!entry) return d; // Steam said nothing about it: keep the US price
      const po = entry.success ? entry.data?.price_overview : null;
      if (!po || po.currency !== currency || !(po.discount_percent > 0)) return null; // not on sale (or not sold) here
      return { ...d, price: po.final / 100, normalPrice: po.initial / 100, savings: po.discount_percent, currency };
    })
    .filter(Boolean);
}

export function normalizeGog(json, opts) {
  const products = json?.products;
  if (!Array.isArray(products)) throw new UpstreamError('GOG returned an unexpected response');
  return products
    .map((p) => {
      const final = money(p?.price?.finalMoney?.amount);
      const base = money(p?.price?.baseMoney?.amount);
      const savings = Math.abs(parseInt(p?.price?.discount, 10)) || (final && base ? Math.round((1 - final / base) * 100) : 0);
      if (!p?.title || final == null || !(savings > 0)) return null;
      return {
        id: `gog-${String(p.id)}`,
        title: String(p.title),
        price: final,
        normalPrice: base,
        savings,
        currency: String(p.price.finalMoney.currency ?? 'USD'),
        store: 'GOG',
        rating: Number(p.reviewsRating) > 0 ? Number(p.reviewsRating) * 2 : null, // GOG rates out of 50
        image: safeImage(p.coverHorizontal, opts),
        url: safeHttpLink(p.storeLink) ?? 'https://www.gog.com/en/games?discounted=true',
      };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------ loader */

export function createDealsLoader({ config, fetchImpl }) {
  const opts = { timeoutMs: config.timeoutMs, headers: { 'user-agent': 'pupboard/1.0' } };
  const parse = { demo: config.demo };
  const currency = validCurrency(config.deals?.currency);
  const memory = {};
  const steamMemory = {};
  return async function loadDeals() {
    const tasks = {
      freebies: async () => normalizeFreebies(await fetchJson(fetchImpl, GAMERPOWER, opts), parse),
      epic: async () => normalizeEpicFree(await fetchJson(fetchImpl, epicUrl(currency), opts), parse),
      deals: async () => normalizeDeals(await fetchJson(fetchImpl, CHEAPSHARK, opts), parse),
      gog: async () => normalizeGog(await fetchJson(fetchImpl, gogUrl(currency), opts), parse),
    };
    if (currency !== 'USD') tasks.rate = async () => Number((await fetchJson(fetchImpl, RATES, opts))?.rates?.[currency]) || null;
    const { values, warnings } = await settleAll(tasks, memory);

    // Steam's local prices for the sales (one request for all of them).
    let deals = values.deals ?? [];
    const ids = deals.map((d) => d.appid).filter(Boolean).slice(0, 25);
    if (currency !== 'USD' && ids.length) {
      const local = await settleAll({ steam: async () => fetchJson(fetchImpl, steamUrl(ids, currency), opts) }, steamMemory).catch((err) => ({ values: {}, warnings: [`steam prices: ${err.message} (showing US prices)`] }));
      if (local.values.steam) deals = localiseSteam(deals, local.values.steam, currency);
      warnings.push(...local.warnings);
    }

    const freebies = mergeFreebies({ epic: values.epic, gamerpower: values.freebies, currency, rate: values.rate });
    const gog = values.gog ?? [];
    const freeWorth = freebies.filter((g) => g.worth && g.worthCurrency === currency).reduce((sum, g) => sum + g.worth, 0);
    return {
      currency,
      freebies,
      deals,
      gog,
      hasFreebies: Boolean(values.freebies || values.epic), // false: every call failed, so "0 free games" would be wrong
      hasDeals: Boolean(values.deals),
      hasGog: Boolean(values.gog),
      freeWorth: Math.round(freeWorth * 100) / 100,
      freeWorthApprox: freebies.some((g) => g.worthApprox),
      bestSaving: [...deals, ...gog].reduce((max, d) => Math.max(max, d.savings), 0),
      warnings,
    };
  };
}
