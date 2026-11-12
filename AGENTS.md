# AGENTS.md — pupboard

Rules for anyone changing this project, human or AI. Read this before making changes, and update it in the same change when a rule changes.

## What this is

An animated, glanceable stats homepage for self-hosted services, opened in a browser. It pulls several sources into one dashboard:

- **Gaming (Steam):** games played this week, hours spent, which games
- **Music (Navidrome):** what was listened to, with stats about those songs
- **Media (Jellyfin):** movies and TV shows recently added
- **News (RSS/Atom):** latest stories from configured feeds

The overview page is the at-a-glance view. Each source has a detail page with more.

## Core constraints (do not break these)

1. **Free APIs only.** No paid services and no keys that cost money. Steam Web API, Navidrome, Jellyfin and RSS are all free.
2. **Browser-based, like a homepage.** Plain HTML/CSS/JS served by the app; must work in any modern browser on desktop and phone.
3. **Three ways to run it, all kept working:** `npm start` on Linux/macOS/Windows, Docker Compose (including Dockge), and the double-click release downloads for people who have never used a terminal.
4. **Tests protect every change.** Add or update tests with every change so later changes can't silently break earlier work.
5. **Glanceable first.** The overview shows the important numbers at a glance; extra detail goes on the detail pages.
6. **Usable by non-technical people.** Anything a user has to do (set up, update, fix a problem) should be possible without a terminal when they use the release download. Error messages say what to do, in plain words.

### Definition of done (for any change)

- `npm test` passes, and new behaviour has tests.
- The dashboard loads in a browser **3 times in a row without errors** while upstream APIs fail randomly (`npm run demo` fails ~25% of requests on purpose). Check the console.
- The Docker image still builds (`docker compose build`).
- If packaging changed: `NODE_BINARY=$(command -v node) scripts/package-release.sh linux x64` still builds and the unzipped launcher starts.

## Hard rules

### Reliability: upstreams are unreliable, the dashboard is not
- Every upstream call goes through `server/resilience.js` (`fetchJson` / `fetchText` / `settleAll` / `createCachedSource`): timeout, one retry, caching, back-off, stale-while-error.
- A source failing must **never** crash the page or the server, or block other sources. `/api/summary` answers within its time budget even if an upstream hangs.
- Partial failures show what loaded, marked **Partial**; total failures show the last good data, marked **Offline**.
- **Never show a misleading 0.** If a number is unknown because a call failed, show "—" and say why (see `hasSongHistory`, `hasItems`, and the Steam recent-games check).
- Be honest about data limits in the UI (Steam only reports 2-week totals; Navidrome stores only the latest play per song).

### Security and privacy
- **Secrets stay on the server.** API keys and passwords come from `.env` or the settings file only, never reach the browser, and never appear in URLs the browser sees, logs, or error messages (`safeMessage` scrubs them). Images from Navidrome/Jellyfin go through the `/api/img/...` proxy, which caps size and sends a sandboxing CSP.
- `.env`, `data/`, `config/feeds.txt`, `build/` and `node_modules/` are never committed.
- Escape all upstream text in views (`escapeHtml`). Only `http(s)` links are rendered; external links use `target="_blank" rel="noopener noreferrer"`.
- Keep the Content-Security-Policy in `server/app.js` strict (`'self'` scripts and styles). That means no inline `<script>` or `style=""` in HTML; set styles via JS (CSSOM) or CSS classes. Build DOM from data with `textContent`, not `innerHTML` (views.js output is the escaped exception).
- The image proxy only accepts ids matching `SAFE_ID`; static files must stay inside `public/`.
- **Settings page (`/setup.html`, `/api/setup`, `server/settings.js`):** it is the only endpoint that writes anything, so it is locked down three ways and all three stay: the socket must be loopback, the `Host` header must be `localhost`/`127.0.0.1`/`[::1]` (stops DNS rebinding), and the request needs the random code printed at startup (stops a same-machine reverse proxy from exposing it). POSTs must be JSON, same-origin and under 64 KB. Secrets are write-only: the API reports whether one is set, never its value. Saved settings live in `DATA_DIR/settings.json` with mode 0600. Values from the environment always win and show as locked. It is off in demo mode, inside containers, and with `SETUP_PAGE=0`. The startup code is the one deliberate exception to "no secrets in logs": it is a per-run token shown only to the person who started pupboard.

### Deployment
- The Compose file runs **only the pupboard container**. It never hosts Navidrome, Jellyfin or anything else; it connects to existing servers by URL.
- `compose.yaml` uses the published `ghcr.io/.../pupboardboard:latest` image with `build: .` as a fallback and `pull_policy: missing`. Don't change it to `always` (breaks starting without internet) or `build` (Dockge's Update button would never fetch new releases). `tests/deploy.test.js` checks this.
- `compose.yaml` loads settings with the plain `env_file: - .env` form on purpose: the `path:`/`required:` form needs Compose 2.24+, and many Dockge installs run older Compose. `.env` values containing `$`, `#`, spaces or quotes must be **single-quoted** (unquoted or double-quoted `$` gets expanded by Compose).
- Default port is **8742**. Keep it in sync in `server/config.js`, `compose.yaml`, `Dockerfile`, `.env.example` and `.claude/launch.json` (a test checks).
- **Listening address:** `HOST` wins, then `DEFAULT_HOST`, then `0.0.0.0`. The release launchers set `DEFAULT_HOST=127.0.0.1` so a laptop on public Wi-Fi doesn't share someone's listening history; the settings page can open it to the home network. Docker and `npm start` keep `0.0.0.0`.
- **Release downloads:** `scripts/package-release.sh` bundles the app, production `node_modules`, a checksum-verified Node.js from nodejs.org, the launchers in `packaging/`, and `READ ME FIRST.txt`. Launchers set `OPEN_BROWSER=1`; on first start with nothing configured, the browser opens the settings page. `.bat` files need CRLF (see `.gitattributes`; the script converts them too). Users update by copying `data/` and `config/` into the new folder, so all user state must live there.
- **Workflows:** `test.yml` (every push/PR), `docker.yml` (image to ghcr.io on main and `v*` tags; `latest` = newest release, `edge` = main), `release.yml` (zips attached to a GitHub Release on `v*` tags).
- **Clock:** 24-hour by default. Time-of-day text (clock, date, greeting, easter-egg greetings) must go through `zonedParts`/`formatClock`/`formatLongDate` in `format.js` with the zone from `/api/display` (`TIME_ZONE`, else `TZ`), never `getHours()`/`toLocaleTimeString` directly: privacy-hardened browsers report UTC.
- **Now playing is live:** `/api/navidrome/now-playing` is never cached. The page fetches it on every load, page switch and tab return, merging it in before drawing (`public/js/live.js`), with short timeouts (2.5 s on load, 0.8 s on page switch) so a slow Navidrome never holds the page up. Navidrome is normally on the same network, so frequent requests are fine.
- **News feeds come from `config/feeds.txt`** (one per line, `Name | url`, `#` comments), mounted read-only in Docker and re-read when it changes. The settings page edits the same file. `RSS_FEEDS` in `.env` is only a fallback for short lists; don't move long lists back into `.env`. `config/feeds.txt` is personal and git-ignored; `config/feeds.example.txt` is the committed template.
- Node 22+, no framework. Keep dependencies minimal (currently only `animejs`); prefer Node built-ins. Assets are self-hosted, with no CDNs at runtime, so it works offline on a LAN.

### Look and feel
- **Animations:** anime.js v4, served locally from `/vendor`, all in `public/js/motion.js`. Animate `transform`/`opacity`. Respect `prefers-reduced-motion`. If anime.js fails to load, everything must still appear in its final state: views render the final state (bars, numbers, donut slices) and motion only animates *toward* it. `tests/motion.test.js` checks this fallback.
- **Background:** an animated dot grid on a `<canvas>` (`public/js/backdrop.js`): ripples in the theme's accent colours every few seconds and a soft glow near the pointer. It only redraws while something moves, pauses when the tab is hidden, and is a still grid with reduced motion. No big blurred colour glows behind the cards. Cards and panels are see-through (`--card` ≈ 55% surface) with **no** `backdrop-filter`, so the grid shows through them; only the top bar keeps its blur. Each card keeps its fading accent glow at the top.
- **Never put a CSS `transition` (or `:hover` change) on `transform` for an element anime.js animates.** The transition restarts every frame and fights anime.js, causing visible stutter. Use the separate `translate`/`scale` properties for hover effects; a test enforces this.
- Current effects: staggered fade-ins, posters/covers/game cards flipping up from the centre, news and legend rows sliding in, growing bars, counting numbers, the Gaming donut spinning in while slices grow, a sliding nav highlight, quick page fade-out on navigation, card-icon wiggle on hover, and the day/night button spin. Lively but not overboard: keep new effects short (under ~1.5 s) and purposeful.
- **Themes:** colours come only from tokens in `public/css/themes.css` (each theme has a night and a day block). `styles.css` must not contain hard-coded colours (a test enforces this). New themes need both blocks plus an entry in `public/js/themes.js`. The contrast tests in `tests/themes.test.js` must pass; adjust secondary-text greys for readability, and note any deviation from a theme's official palette in a CSS comment.
- Current themes: Default, Whale, Dracula/Alucard, Catppuccin Mocha/Latte, Camellia Hope Dark/Light, Rosé Pine Main/Dawn.
- **Font:** Monoid, self-hosted in `public/fonts/monoid` (keep its `LICENSE.txt`): Retina weight for normal text, Regular for bold, root size 88%. Don't switch to a system or CDN font.
- **Easter egg:** `public/js/puppy.js` (pure, tested) and `puppy-mode.js` (DOM) hold a hidden mode with its own palette in `themes.css` (overrides every theme, both modes), remembered in localStorage and applied before first paint by `theme-boot.js`. Keep it out of the README so it stays a surprise, and keep it wholesome.
- `<body>` must not paint a background (`<html>` does); otherwise the dot-grid canvas and anything else behind the page (negative z-index) is hidden. A test checks this.
- **Layout:** the overview is a 2×2 grid of equal-height cards, with no empty gaps. Avoid layouts that leave blank holes.
- Views in `public/js/views.js` are **pure functions** (data in, HTML string out, no DOM) so they're testable in Node. Keep it that way.
- **Demo data is invented.** `server/demo/fake-upstreams.js` uses made-up games, artists, films, shows and feed stories, fake Steam app ids, and generated placeholder art (`/api/demo-art/...`, demo mode only). Don't add real titles, artwork or app ids: screenshots of demo mode end up in the README.

## Project map

```
server/index.js            entry (npm start / npm run demo / launchers)
server/app.js              routes, image proxy, setup API, static files, CSP
server/config.js           .env settings and isConfigured checks
server/settings.js         settings page storage, validation, precedence
server/resilience.js       timeouts, retries, caching (use for every upstream)
server/sources/*.js        steam, steam-history, navidrome, jellyfin, rss
server/demo/               fake flaky upstreams for demo mode and tests
config/feeds.example.txt   template for the feed list (feeds.txt)
public/js/views.js         pure renderers   public/js/app.js     fetch/route/refresh
public/js/motion.js        animations       public/js/themes.js  theme list
public/js/setup.js         settings page    public/js/theme-boot.js  theme before first paint
public/css/                themes.css (tokens), styles.css (derived), fonts.css
packaging/                 launchers and READ ME FIRST.txt for the release zips
scripts/package-release.sh builds a release zip
.github/workflows/         tests, Docker image, release zips
tests/                     node:test suites (npm test)
```

## Adding a new data source

1. Write `server/sources/<name>.js` with pure normalisers plus a loader that uses `settleAll(tasks, memory)`.
2. Add config and an `isConfigured` check in `config.js`, fields in `SETTINGS_FIELDS` (`server/settings.js`) and a section in `public/js/setup.js`, and document the settings in `.env.example` and the README.
3. Register it in `server/app.js` (`sources`), and add invented fake responses to `server/demo/fake-upstreams.js`.
4. Add glance and detail renderers plus a route in `views.js`, a `SOURCES` entry, a nav link, and an accent token in every theme block.
5. Add tests: parsing (including junk and partial data), the loader with partial failures, rendering in every state, escaping, and settings validation.
6. Keep the overview free of gaps, and check it in the browser in demo mode.

## Commands

```bash
npm install          # once
npm test             # run all tests
npm run demo         # fake, flaky data at http://localhost:8742
npm start            # real data from .env / the settings page
docker compose up -d --build
NODE_BINARY=$(command -v node) scripts/package-release.sh linux x64   # local test zip
```
