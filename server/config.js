import { createFeedList } from './sources/rss.js';

// Reads all settings from environment variables (see .env.example).
// Nothing here throws: a missing value just leaves that source "unconfigured".

const positive = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const str = (value) => (typeof value === 'string' ? value.trim() : '');
const baseUrl = (value) => str(value).replace(/\/+$/, '');
const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(str(value).toLowerCase());

/** A valid IANA time zone ("Europe/London"), or null (use the browser's). */
export function validTimeZone(value) {
  const tz = str(value);
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    console.warn(`[config] ignoring unknown time zone "${tz}" (use a name like Europe/London)`);
    return null;
  }
}

export const MUSIC_SOURCES = ['navidrome', 'spotify', 'listenbrainz'];
export const MEDIA_SOURCES = ['jellyfin', 'letterboxd', 'deals'];
const oneOf = (value, list) => (list.includes(str(value).toLowerCase()) ? str(value).toLowerCase() : 'auto');

export function loadConfig(env = process.env) {
  const config = {
    port: positive(env.PORT, 8742),
    // HOST wins; DEFAULT_HOST is set by the double-click launchers so a laptop
    // doesn't share the dashboard with the whole network unless asked to.
    host: str(env.HOST) || str(env.DEFAULT_HOST) || '0.0.0.0',
    // The /setup page (local-only, needs the code printed at startup). SETUP_PAGE=0 turns it off.
    setupEnabled: !/^(0|off|false|no)$/i.test(str(env.SETUP_PAGE)),
    dataDir: str(env.DATA_DIR) || './data',
    demo: truthy(env.DEMO_MODE),
    timeoutMs: positive(env.REQUEST_TIMEOUT_MS, 8000),
    refreshMinutes: positive(env.BACKGROUND_REFRESH_MINUTES, 30),
    // Clock settings sent to the browser. TIME_ZONE wins over Docker's TZ;
    // with neither, the browser's own zone is used.
    display: {
      timeZone: validTimeZone(env.TIME_ZONE) ?? validTimeZone(env.TZ),
      hour12: /^12/.test(str(env.CLOCK_FORMAT)),
    },
    steam: {
      apiKey: str(env.STEAM_API_KEY),
      steamId: str(env.STEAM_ID),
      // What clicking a game name does: launch it in Steam (default) or open its store page.
      links: str(env.STEAM_LINKS).toLowerCase() === 'store' ? 'store' : 'launch',
      hide: str(env.STEAM_HIDE), // empty = the built-in list (DEFAULT_STEAM_HIDE)
      ttlMs: positive(env.STEAM_CACHE_SECONDS, 300) * 1000,
    },
    navidrome: {
      url: baseUrl(env.NAVIDROME_URL),
      user: str(env.NAVIDROME_USER),
      password: str(env.NAVIDROME_PASSWORD),
      ttlMs: positive(env.NAVIDROME_CACHE_SECONDS, 60) * 1000,
    },
    jellyfin: {
      url: baseUrl(env.JELLYFIN_URL),
      apiKey: str(env.JELLYFIN_API_KEY),
      ttlMs: positive(env.JELLYFIN_CACHE_SECONDS, 300) * 1000,
    },
    rss: {
      file: str(env.RSS_FEEDS_FILE) || './config/feeds.txt',
      ttlMs: positive(env.RSS_CACHE_SECONDS, 900) * 1000,
    },
    listenbrainz: {
      user: str(env.LISTENBRAINZ_USER),
      ttlMs: positive(env.LISTENBRAINZ_CACHE_SECONDS, 120) * 1000,
    },
    spotify: {
      clientId: str(env.SPOTIFY_CLIENT_ID),
      ttlMs: positive(env.SPOTIFY_CACHE_SECONDS, 30) * 1000,
    },
    letterboxd: {
      user: str(env.LETTERBOXD_USER),
      ttlMs: positive(env.LETTERBOXD_CACHE_SECONDS, 1800) * 1000,
    },
    deals: {
      enabled: !/^(0|off|false|no)$/i.test(str(env.DEALS)),
      ttlMs: positive(env.DEALS_CACHE_SECONDS, 1800) * 1000,
      // Prices in US dollars, Australian dollars or pounds.
      currency: ['USD', 'AUD', 'GBP'].includes(str(env.DEALS_CURRENCY).toUpperCase()) ? str(env.DEALS_CURRENCY).toUpperCase() : 'USD',
    },
    // Which source fills the Music and Media cards ("auto" = first one set up).
    slots: {
      music: oneOf(env.MUSIC_SOURCE, MUSIC_SOURCES),
      media: oneOf(env.MEDIA_SOURCE, MEDIA_SOURCES),
    },
  };

  if (config.demo) {
    // Demo mode routes every request to fake, deliberately flaky servers.
    config.steam = { ...config.steam, apiKey: 'demo', steamId: '76561190000000000' };
    config.navidrome = { ...config.navidrome, url: 'http://navidrome.demo', user: 'demo', password: 'demo' };
    config.jellyfin = { ...config.jellyfin, url: 'http://jellyfin.demo', apiKey: 'demo' };
    config.listenbrainz = { ...config.listenbrainz, user: 'demo' };
    config.spotify = { ...config.spotify, clientId: '0123456789abcdef0123456789abcdef', isConnected: () => true };
    config.letterboxd = { ...config.letterboxd, user: 'demo' };
    config.deals = { ...config.deals, enabled: true };
    config.rss = {
      ...config.rss,
      demoFeeds: [
        { name: 'Selfhosted Weekly', url: 'http://feeds.demo/selfhosted.xml' },
        { name: 'Open Source Digest', url: 'http://feeds.demo/opensource.atom' },
        { name: 'Indie Game Radar', url: 'http://feeds.demo/games.xml' },
      ],
    };
  }
  // list() returns { feeds, from } and re-reads the feeds file when it changes.
  config.rss.list = createFeedList({ file: config.rss.file, envValue: env.RSS_FEEDS, fixed: config.rss.demoFeeds ?? null });
  return config;
}

export const isConfigured = {
  steam: (c) => Boolean(c.steam.apiKey && c.steam.steamId),
  navidrome: (c) => Boolean(c.navidrome.url && c.navidrome.user && c.navidrome.password),
  jellyfin: (c) => Boolean(c.jellyfin.url && c.jellyfin.apiKey),
  rss: (c) => c.rss.list().feeds.length > 0,
  listenbrainz: (c) => Boolean(c.listenbrainz?.user),
  // Needs a Client ID and a finished "Connect Spotify" (app.js sets isConnected).
  spotify: (c) => Boolean(c.spotify?.clientId && c.spotify.isConnected?.()),
  letterboxd: (c) => Boolean(c.letterboxd?.user),
  deals: (c) => Boolean(c.deals?.enabled),
};

/**
 * The source shown on each card. A chosen source wins (even if it isn't set
 * up yet, so its card can say how). "auto" picks the first one set up, in
 * list order; with none set up, the card explains the options.
 */
export function resolveSlots(c) {
  const pick = (choice, list, fallback) => (choice && choice !== 'auto' ? choice : list.find((k) => isConfigured[k](c)) ?? fallback);
  return {
    music: pick(c.slots?.music, MUSIC_SOURCES, 'listenbrainz'),
    media: pick(c.slots?.media, MEDIA_SOURCES, 'deals'),
  };
}
