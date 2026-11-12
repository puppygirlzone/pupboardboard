<p align="center">
  <img src="docs/banner.png" alt="pupboard: a blurred screenshot of the dashboard with the name pupboard written over it" width="100%">
</p>

# pupboard

A colourful, animated homepage that shows your week at a glance:

- **Gaming (Steam):** hours played and which games, over the last 7 days
- **Music (Navidrome):** now playing, tracks and listening time this week, top artists, albums and genres, most-played songs
- **Media (Jellyfin):** movies and episodes added recently, library counts
- **News (RSS/Atom):** the latest stories from your feeds, with a page per feed

The overview page is the at-a-glance view. Click a card (or use the top nav) for a detail page with more. Use whichever sources you have; the rest just say "Not set up".

Everything it talks to is free: no paid APIs, no accounts with us, no tracking. Your keys and passwords stay on your machine.

## Pick how to run it

| You are… | Use |
|---|---|
| Not into terminals, on Windows, macOS or Linux | [The download](#the-easy-way-download-and-double-click) |
| Running a home server with Docker / Dockge / Portainer | [Docker Compose](#docker-compose) |
| Comfortable with Node.js | [From source](#from-source) |

### The easy way: download and double-click

1. Go to the [latest release](https://github.com/puppygirlzone/pupboardboard/releases/latest) and download the zip for your computer:
   - Windows: `pupboard-…-win-x64.zip`
   - Mac with Apple chip (M1 or newer): `pupboard-…-darwin-arm64.zip`; older Intel Mac: `…-darwin-x64.zip`
   - Linux: `pupboard-…-linux-x64.zip`
2. Unzip it anywhere (your Documents folder is fine).
3. Start it:
   - **Windows:** double-click **Start pupboard.bat**. If Windows says "Windows protected your PC", click **More info → Run anyway**.
   - **macOS:** right-click **Start pupboard.command → Open → Open** (only the first time; afterwards just double-click).
   - **Linux:** double-click **start-pupboard.sh** and choose "Run in terminal", or run `./start-pupboard.sh`.
4. Your browser opens the **Settings** page. Fill in what you use and press **Save**. That's it.

Keep the small black window open while you use pupboard; closing it stops pupboard. Nothing gets installed: Node.js is included in the zip, and deleting the folder removes everything.

Next time, start it the same way and bookmark <http://localhost:8742>. To change settings later, click the gear button at the top right.

**Updating:** download the new zip, unzip it, and copy the `data` and `config` folders from your old pupboard folder into the new one.

**On your phone:** in Settings → Network, choose "Any device on my home network", save, and restart pupboard. Then open `http://<your computer's IP>:8742` on your phone.

### Docker Compose

Download [`compose.yaml`](compose.yaml) and [`.env.example`](.env.example) into a folder (or clone the repo), then:

```bash
cp .env.example .env     # fill in what you use
mkdir -p config && cp config/feeds.example.txt config/feeds.txt   # optional: your news feeds
docker compose up -d
```

Open `http://<server-ip>:8742`. This pulls the ready-made image from `ghcr.io` (amd64 and arm64, so a Raspberry Pi 4/5 works too). If it can't be pulled, Compose builds it from the folder instead (needs the full repo).

- Steam play history lives in the `pupboard-data` volume, so the 7-day view survives restarts.
- Inside Docker, `localhost` means the container itself. Use your server's LAN IP for Navidrome and Jellyfin, or put pupboard on the same Docker network as them (see the comments in `compose.yaml`).
- The Settings page is turned off inside Docker; use `.env` there.
- **Updating:** `docker compose pull && docker compose up -d`. In **Dockge**, just press **Update**. Podman: `podman compose` works the same.
- Running your own code changes: `docker compose up -d --build`.

**Quoting in `.env`:** if a password or key contains `$`, `#`, spaces or quotes, wrap it in **single** quotes, e.g. `NAVIDROME_PASSWORD='pa$$ #word'`. Unquoted, Docker Compose expands `$` as a variable and drops anything after ` #`; double quotes still expand `$`.

### From source

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/puppygirlzone/pupboardboard.git
cd pupboardboard
npm install
npm start
```

Open <http://localhost:8742>, then set things up either with the Settings page (the link with its access code is printed in the terminal) or by copying `.env.example` to `.env` and filling it in. Values in `.env` win over the Settings page. To keep it running in the background on Linux, see [deploy/pupboard.service](deploy/pupboard.service).

### Just looking? Try the demo

```bash
npm install
npm run demo
```

Demo mode shows made-up data and deliberately fails about 25% of requests, so you can see how the dashboard copes.

## Getting the keys

| Source | Settings | Where to get them |
|---|---|---|
| Steam | `STEAM_API_KEY`, `STEAM_ID` | Key: <https://steamcommunity.com/dev/apikey> (any domain name works). ID: your 17-digit SteamID64, e.g. from <https://steamid.io>. Set your Steam profile's **Game details** privacy to Public. |
| Navidrome | `NAVIDROME_URL`, `NAVIDROME_USER`, `NAVIDROME_PASSWORD` | Your normal Navidrome address and login. |
| Jellyfin | `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Jellyfin Dashboard → API Keys → **+** |
| News | `config/feeds.txt` (optional) | One RSS or Atom feed per line. See [News feeds](#news-feeds). |

Keys stay on the server: the browser only talks to pupboard, and cover art and posters are proxied through it.

## Clock

The clock is 24-hour by default (`CLOCK_FORMAT=12h` for 12-hour). Set `TIME_ZONE` (e.g. `Europe/London`) if the time is wrong: some privacy-focused browsers (Firefox's "resist fingerprinting", LibreWolf, Mullvad Browser) report UTC instead of your real zone. Docker's usual `TZ` also works.

## News feeds

Edit them on the Settings page, or in `config/feeds.txt`, one per line:

```bash
cp config/feeds.example.txt config/feeds.txt
```

```
# lines starting with # are ignored
Hacker News | https://hnrss.org/frontpage
https://www.reddit.com/r/selfhosted/.rss      <- no name: the feed's own title is used
```

- Edits are picked up automatically, with no restart. In Docker, the `config/` folder is mounted read-only into the container.
- Up to 50 feeds; duplicates are skipped.
- Without the file you get Hacker News, Phoronix and Ars Technica. `feeds.txt` is git-ignored.
- For a short list you can also use `RSS_FEEDS` in `.env` (comma-separated). The file wins if both exist.

## Themes

Pick a theme from the dropdown in the top bar, and switch day/night with the sun/moon button. Your choice is saved in the browser. Until you press the button, day/night follows your system setting.

| Theme | Night | Day |
|---|---|---|
| Default | dark | light |
| [Whale](https://github.com/anufrievroman/whale) | Whale | derived from Whale's colours (no official light variant) |
| [Dracula](https://draculatheme.com/) | Dracula | Alucard |
| [Catppuccin](https://catppuccin.com/palette/) | Mocha | Latte |
| [Camellia](https://github.com/camellia-theme/camellia) | Hope Dark | Hope Light |
| [Rosé Pine](https://rosepinetheme.com/) | Main | Dawn |

A few secondary-text greys are slightly adjusted from the originals so small text stays readable.

## How it handles unreliable services

- Each upstream call has a timeout (8 s) and one retry.
- The last good data is cached. If a source goes down, its card shows that data with an amber **Offline** pill.
- If only part of a source fails, the rest still shows, marked **Partial**, and it retries after 30 s.
- After a failure it waits 30 s before trying again, so a dead server isn't hammered.
- The page never waits more than about 4 s for a slow source; that card shows *Loading* and fills in later.
- If pupboard itself is unreachable, the browser shows its last saved copy.
- The page refreshes every 60 seconds, plus whenever you switch back to the tab.

## Accuracy notes

- **Steam** only reports "last 2 weeks" playtime. pupboard saves your total playtime once an hour and compares against a week ago. Until 7 days of history exist, it shows the 2-week figures and says so.
- **Navidrome** only stores the most recent play of each song, so "tracks this week" and "listening time" are minimums: a song played 5 times counts once.

## All settings

Everything can go in `.env` (see [`.env.example`](.env.example) for the full list with comments). The main ones besides the keys above:

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `8742` | Web port |
| `HOST` | `0.0.0.0` (`127.0.0.1` for the download) | Which network address to listen on |
| `TIME_ZONE`, `CLOCK_FORMAT` | browser's zone, `24h` | Clock |
| `SETUP_PAGE` | `1` | `0` turns the Settings page off |
| `DATA_DIR` | `./data` | Where settings and Steam history are stored |
| `DEMO_MODE` | `0` | `1` = made-up data |

## Security

The dashboard has no login: anyone who can reach its port can see your stats (but never your keys). Keep it on your home network, or put it behind a reverse proxy with authentication if you want it reachable from outside. The Settings page only works from the computer pupboard runs on, with a code that changes every start. See [SECURITY.md](SECURITY.md) to report a problem.

## Contributing

Issues and pull requests are welcome. Please read [AGENTS.md](AGENTS.md) first: it holds the project's design and safety rules (it's written for AI coding assistants too).

```bash
npm install
npm test          # Node's built-in test runner, nothing extra to install
npm run demo      # check your change in the browser with flaky fake data
```

The tests cover the retry/cache/back-off logic, each source's parsing (including junk and partial responses), the RSS/Atom parser, the HTTP server under heavy upstream failure, path-traversal and image-proxy safety, the Settings page's access rules, every page in every state, HTML escaping, theme contrast, and the deployment files. Run `npm test` before and after any change.

### Project layout

```
server/       HTTP server, settings, data sources, demo upstreams
public/       the web page: HTML, CSS (themes.css holds all colours), JS
config/       feeds.example.txt
packaging/    launchers for the release downloads
scripts/      package-release.sh (builds the download zips)
tests/        npm test
```

### Making a release

Tag it (`git tag v1.2.0 && git push --tags`). GitHub Actions then runs the tests, publishes the Docker image, and attaches the download zips to a GitHub Release.

## Credits and licence

pupboard is free software under the [GNU GPL v3 or later](LICENSE).

It bundles [Monoid](https://github.com/larsenwork/monoid) (MIT / SIL OFL, see `public/fonts/monoid/LICENSE.txt`) and [anime.js](https://animejs.com/) (MIT). The download zips include [Node.js](https://nodejs.org) (MIT, see `runtime/LICENSE-node.txt`).

Not affiliated with Valve, Navidrome or Jellyfin.
