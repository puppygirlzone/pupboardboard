# Customising pupboard

Everything here can be set on the **Settings** page (gear button, top right) or in `.env`. If both have a value, `.env` wins. Inside Docker the Settings page is off, so use `.env` there.

[← Back to the README](../README.md)

- [Themes](#themes)
- [News feeds](#news-feeds)
- [Which service shows on a card](#which-service-shows-on-a-card)
- [Spotify direct](#spotify-direct)
- [Opening it on your phone](#opening-it-on-your-phone)
- [All settings](#all-settings)

## Themes

Pick a theme in the menu at the top right, and flip between day and night with the sun/moon button. Your choice is saved in your browser. Until you press the button, day/night follows your system.

| Theme | Night | Day |
|---|---|---|
| Default | dark | light |
| [Whale](https://github.com/anufrievroman/whale) | Whale | made from Whale's colours (it has no official light version) |
| [Dracula](https://draculatheme.com/) | Dracula | Alucard |
| [Catppuccin](https://catppuccin.com/palette/) | Mocha | Latte |
| [Camellia](https://github.com/camellia-theme/camellia) | Hope Dark | Hope Light |
| [Rosé Pine](https://rosepinetheme.com/) | Main | Dawn |

A few of the grey text colours are nudged slightly from the originals so small text stays readable.

## News feeds

By default you get gaming news: Steam News, GamingOnLinux, r/GameDeals and Rock Paper Shotgun. To use your own feeds, edit them on the Settings page or in `config/feeds.txt`:

```bash
cp config/feeds.example.txt config/feeds.txt
```

One feed per line, with an optional name in front:

```
# lines starting with # are ignored
GamingOnLinux | https://www.gamingonlinux.com/article_rss.php
https://www.reddit.com/r/selfhosted/.rss      <- no name: the feed's own title is used
```

- Changes are picked up by themselves, no restart needed.
- Up to 50 feeds. Duplicates are skipped.
- `feeds.example.txt` has more ideas. Your `feeds.txt` is git-ignored, so it stays yours.
- For a short list you can use `RSS_FEEDS` in `.env` instead (comma-separated). If both exist, the file wins.

## Which service shows on a card

The Music and Media cards can each show one service. Pick it with "Music card" / "Media card" in Settings, or `MUSIC_SOURCE` / `MEDIA_SOURCE` in `.env`.

On **Automatic**, the card uses the first one you've set up:

- **Music:** Navidrome, then Spotify, then ListenBrainz
- **Media:** Jellyfin, then Letterboxd, then game deals

## Spotify direct

This gives you live "now playing" straight from Spotify. Spotify only allows it with **Spotify Premium** and your own free developer app (each app allows at most 5 people). If that sounds like too much, use ListenBrainz instead: it only needs a username.

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and press **Create app**. Any name and description is fine.
2. Under **Redirect URIs**, paste the one shown on pupboard's Settings page, e.g. `http://127.0.0.1:8742/api/spotify/callback` (Spotify doesn't accept `localhost`). Tick **Web API** and save.
3. Copy the app's **Client ID** into pupboard's Settings and press **Save**. No client secret needed.
4. Press **Connect Spotify** and allow access.

And ya done! pupboard keeps the sign-in on your computer and refreshes it by itself.

This needs the Settings page, so it works with the download and `npm start`, but not inside Docker. Docker folks: use ListenBrainz.

## Opening it on your phone

In Settings → Network, choose "Any device on my home network", save, and restart pupboard. Then open `http://<your computer's IP>:8742` on your phone.

With Docker it's reachable on your network already: `http://<server-ip>:8742`.

## All settings

[`.env.example`](../.env.example) has the full list with comments. The main ones, apart from the keys in the README:

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `8742` | Web port |
| `HOST` | `0.0.0.0` (`127.0.0.1` for the download) | Which network address to listen on |
| `TIME_ZONE` | your browser's zone | Time zone for the clock, date and greeting |
| `CLOCK_FORMAT` | `24h` | `12h` for a 12-hour clock |
| `MUSIC_SOURCE`, `MEDIA_SOURCE` | `auto` | Which service fills the Music / Media card |
| `DEALS` | `on` | `off` hides game deals |
| `DEALS_CURRENCY` | `USD` | `AUD` or `GBP` for deal prices |
| `SETUP_PAGE` | `1` | `0` turns the Settings page off |
| `DATA_DIR` | `./data` | Where settings and Steam history are stored |
| `DEMO_MODE` | `0` | `1` shows made-up data |

> [!NOTE]
> **Clock showing the wrong time?** Set `TIME_ZONE` (e.g. `Europe/London`). Some privacy-focused browsers (Firefox's "resist fingerprinting", LibreWolf, Mullvad Browser) report UTC instead of your real zone. Docker's usual `TZ` works too.

> [!TIP]
> **Quoting in `.env`:** if a password or key has `$`, `#`, spaces or quotes in it, wrap it in **single** quotes, like `NAVIDROME_PASSWORD='pa$$ #word'`. Without them, Docker Compose treats `$` as a variable and drops anything after ` #`. Double quotes still expand `$`.
