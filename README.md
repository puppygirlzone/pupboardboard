<div align="center">
  <img src="docs/banner.png" alt="pupboardboard: a blurred screenshot of the dashboard with the name pupboardboard written over it, because pupboard was already taken by me" width="100%">
  <br>
  <a href="https://github.com/puppygirlzone/pupboardboard/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/puppygirlzone/pupboardboard?style=for-the-badge&logo=github&labelColor=363a4f&color=f5bde6"></a>
  <img alt="Licence: GPL v3" src="https://img.shields.io/badge/Licence-GPL%20v3-c6a0f6?style=for-the-badge&labelColor=363a4f">
  <img alt="Docker image for amd64 and arm64" src="https://img.shields.io/badge/Docker-amd64%20%7C%20arm64-7eb8e2?style=for-the-badge&logo=docker&logoColor=white&labelColor=363a4f">
</div>

# pupboardboard

*Because pupboard was already taken by me.* (The app still calls itself pupboard. The repo just got an extra board.)

A colourful, animated homepage that shows your week at a glance: what you played, what you listened to, what you watched and what's in the news. Open it in any browser, on your computer or your phone.

## What's on it

- 🎮 **Gaming:** hours played on Steam this week, and which games (click one to launch it in Steam, or open its store page if you prefer)
- 🎵 **Music:** now playing, top artists and songs, and listening time, from **Spotify** (through ListenBrainz) or your own **Navidrome**
- 🎬 **Media:** free games and the best Steam sales, films you've logged on **Letterboxd**, or what's new on your **Jellyfin** server
- 📰 **News:** gaming news out of the box, or any RSS/Atom feeds you like

The overview shows the important numbers. Click any card for a page with more detail.

It's also pretty: a dot grid that ripples behind everything, numbers that count up, cards that flip in, and themes like Catppuccin, Dracula and Rosé Pine, each with a day and a night version.

It doesn't fall over either. If one of your services goes down, its card keeps showing the last thing it knew and says so, and the rest of the page carries on. ([How that works](docs/Services.md))

**Free, and as few keys as possible.** News and game deals work with no setup at all. ListenBrainz and Letterboxd only need a username. Only Steam needs a key, and it's free. No paid APIs, no tracking, and your keys stay on your machine.

## Getting it running

Pick whichever suits you:

### 🖱️ Download and double-click (Windows, macOS, Linux)

1. Grab the zip for your computer from the [latest release](https://github.com/puppygirlzone/pupboardboard/releases/latest) (`win-x64`, `darwin-arm64` for M1 or newer Macs, `darwin-x64` for Intel Macs, or `linux-x64`).
2. Unzip it anywhere and start it:
   - **Windows:** double-click **Start pupboard.bat**. If Windows says "Windows protected your PC", click **More info → Run anyway**.
   - **macOS:** right-click **Start pupboard.command → Open → Open** (first time only, then just double-click).
   - **Linux:** run `./start-pupboard.sh`.
3. Your browser opens the **Settings** page. Fill in what you use and press **Save**.

And ya done! Keep the little black window open while you use it, and bookmark <http://localhost:8742>. Nothing gets installed: deleting the folder removes everything.

**Updating:** unzip the new version and copy the `data` and `config` folders across from the old one.

### 🐳 Docker Compose (home servers, Dockge, Portainer)

Grab [`compose.yaml`](compose.yaml) and [`.env.example`](.env.example) (or clone the repo), then:

```bash
cp .env.example .env     # fill in what you use
docker compose up -d
```

Open `http://<server-ip>:8742`. The image works on amd64 and arm64, so a Raspberry Pi 4/5 is fine too.

**Updating:** press **Update** in Dockge, or run `docker compose pull && docker compose up -d`.

> [!TIP]
> Inside Docker, `localhost` means the container itself, so use your server's LAN IP for Navidrome and Jellyfin. If a password has `$`, `#` or spaces in it, wrap it in single quotes in `.env`.

### 💻 From source

Needs [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone https://github.com/puppygirlzone/pupboardboard.git
cd pupboardboard
npm install
npm start
```

Open <http://localhost:8742>. The terminal prints a link to the Settings page, or you can copy `.env.example` to `.env` and fill it in instead. To keep it running in the background on Linux, see [deploy/pupboard.service](deploy/pupboard.service).

Just want a look first? `npm run demo` shows made-up data, and fails a quarter of its requests on purpose so you can watch it cope.

## Connecting your stuff

Only set up what you use. Everything else just stays off.

| Card | Service | What you need |
|---|---|---|
| Gaming | Steam | Your profile link and a [free key](https://steamcommunity.com/dev/apikey) (any domain name works). Set your profile's **Game details** to Public. Background apps such as Soundpad, Bongo Cat and Wallpaper Engine aren't counted as games; change the list with `STEAM_HIDE` or in Settings. |
| Music | Spotify, via [ListenBrainz](https://listenbrainz.org) | **Just a username.** Make a free ListenBrainz account and connect Spotify there (Settings → Music services). Also works with YouTube Music, Jellyfin, Plex and more. |
| Music | Navidrome | Your Navidrome address and normal login. |
| Media | Game deals | **Nothing.** On by default, in US$, A$ or £. |
| Media | Letterboxd | **Just a username.** |
| Media | Jellyfin | Your Jellyfin address and an API key (Dashboard → API Keys → **+**). |
| News | RSS / Atom | **Nothing.** Gaming news until you add your own feeds. |

Want live "now playing" straight from Spotify, your own news feeds, or a different theme? That's all in [Customise.md](docs/Customise.md).

## More reading

- [**Customise.md**](docs/Customise.md): themes, news feeds, Spotify direct, using it on your phone, and every setting
- [**Services.md**](docs/Services.md): how it copes with flaky services, and how accurate each number is
- [**SECURITY.md**](SECURITY.md): what's kept private, and how to report a problem

> [!IMPORTANT]
> pupboard has no login. Anyone who can reach its port can see your stats (never your keys). Keep it on your home network, or put it behind a reverse proxy with a password.

## Contributing

Issues and pull requests are welcome! Please read [AGENTS.md](AGENTS.md) first. It holds the project's design and safety rules (it's written for AI coding assistants too).

```bash
npm install
npm test          # all the tests, using Node's built-in runner
npm run demo      # try your change with flaky fake data
```

Run `npm test` before and after any change. To make a release, push a tag (`git tag v1.2.0 && git push --tags`) and GitHub Actions does the rest.

## Credits and licence

pupboard is free software under the [GNU GPL v3 or later](LICENSE).

It bundles [Monoid](https://github.com/larsenwork/monoid) (MIT / SIL OFL) and [anime.js](https://animejs.com/) (MIT). The download zips include [Node.js](https://nodejs.org) (MIT). Game deals come from [GamerPower](https://www.gamerpower.com), [CheapShark](https://www.cheapshark.com), Steam, GOG and Epic, with exchange rates from [Frankfurter](https://frankfurter.dev). Cover art for ListenBrainz plays comes from the [Cover Art Archive](https://coverartarchive.org).

Not affiliated with Valve, Spotify, ListenBrainz, Letterboxd, Navidrome, Jellyfin, GamerPower or CheapShark.
