# Customising pupboard

Everything here can be set on the **Settings** page (gear button, top right) or in `.env`. The Settings page has a tab per dashboard card (Gaming, Music, Media, News) plus General for the clock and network. If both have a value, `.env` wins. Inside Docker the Settings page is off, so use `.env` there.

[← Back to the README](../README.md)

- [Themes](#themes)
- [News feeds](#news-feeds)
- [Which service shows on a card](#which-service-shows-on-a-card)
- [Spotify direct](#spotify-direct)
- [What's playing on this computer](#whats-playing-on-this-computer)
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

## Roblox

Roblox experiences show up on the Gaming card next to your Steam games: each one gets its own row and its own slice of the donut, with how long you played it this week. Clicking a name asks the Roblox app to join it.

Roblox doesn't keep a play history anyone can read, so pupboard counts it itself. There are two ways, and you can use both:

**1. Roblox on this computer (no login).** If you play Roblox on the computer that runs pupboard, put your profile link in Settings → Gaming (Roblox) and you're done. The Roblox app writes down every time you join or leave an experience, and pupboard reads those notes. This even catches play from before you set it up (as far back as Roblox keeps them) and time when pupboard wasn't running. It looks in:

- **Windows:** `%LOCALAPPDATA%\Roblox\logs` (also used by Bloxstrap and Fishstrap) and the Microsoft Store version's folder
- **macOS:** `~/Library/Logs/Roblox`
- **Linux:** Sober's `~/.var/app/org.vinegarhq.Sober/data/sober/sober_logs`

Set `ROBLOX_LOG_DIR` to use another folder, or `ROBLOX_LOGS=off` to not read them. Inside Docker it only reads a folder you mount and point `ROBLOX_LOG_DIR` at.

**2. Any device (needs a login cookie).** To count play on your phone, console or another PC, pupboard asks Roblox what you're in every minute (`ROBLOX_POLL_SECONDS`). Roblox only answers that for a logged-in account, so pupboard needs that account's `.ROBLOSECURITY` cookie.

> [!WARNING]
> That cookie lets anyone who has it log in as that account. pupboard keeps it on your computer (write-only in Settings, never sent to the browser or written to logs), but the safest choice is a **spare Roblox account** made just for this.

Using a spare account:

1. Make a second, free Roblox account and add it as a friend from your main account.
2. On your main account, open Roblox **Settings → Privacy** and let **Friends** see your online status and join you in experiences. Roblox renames these now and then. If the card says Roblox won't tell it which experience you're in, this is the setting to check.
3. Put your main account's profile link in pupboard.

Getting the cookie (from the spare account, or your own if you'd rather):

1. Sign in to [roblox.com](https://www.roblox.com) in a browser with that account.
2. Press **F12**, open **Application** (Firefox: **Storage**) → **Cookies** → `https://www.roblox.com`.
3. Copy the value of `.ROBLOSECURITY` (it starts with `_|WARNING`) and paste it into Settings, or into `.env` in single quotes: `ROBLOX_COOKIE='_|WARNING…'`.

Logging that account out of the browser ends the cookie, so close the tab instead. If the cookie stops working, the Gaming card tells you to paste a fresh one.

What to expect:

- Counting starts when you set it up (plus whatever the log files cover). Until there's a week, the card says how long it's been tracking instead of pretending it's a full week.
- With a cookie, play is only seen while pupboard is running, and times are accurate to about one check (a minute by default).
- Roblox Studio time isn't counted.
- All the Roblox requests are free and need no API key.

## Spotify direct

This gives you live "now playing" straight from Spotify. Spotify only allows it with **Spotify Premium** and your own free developer app (each app allows at most 5 people). If that sounds like too much, use ListenBrainz instead: it only needs a username.

1. Open the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and press **Create app**. Any name and description is fine.
2. Under **Redirect URIs**, paste the one shown on pupboard's Settings page, e.g. `http://127.0.0.1:8742/api/spotify/callback` (Spotify doesn't accept `localhost`). Tick **Web API** and save.
3. Copy the app's **Client ID** into pupboard's Settings and press **Save**. No client secret needed.
4. Press **Connect Spotify** and allow access.

And ya done! pupboard keeps the sign-in on your computer and refreshes it by itself.

This needs the Settings page, so it works with the download and `npm start`, but not inside Docker. Docker folks: use ListenBrainz.

## What's playing on this computer

Turn on "Also show what's playing on this computer" in Settings (or `LOCAL_NOW_PLAYING=on` in `.env`) and the Music card gets an extra **On this PC** line with the song, artist and album art from a music player on your computer: Spotify, VLC, Strawberry, Feishin, a browser tab, and so on.

It sits next to your music service rather than replacing it, so your weekly stats still come from Navidrome, ListenBrainz or Spotify. If your service already shows the same song, the extra line hides itself.

- Works on **Linux** (any player that supports MPRIS, which is nearly all of them) and **Windows** (anything that shows up in the volume pop-up's media controls).
- Only when pupboard runs on the **same computer** as the music: the download or `npm start`. Inside Docker it can't see your music player, so it says so.
- Not on macOS yet.
- Anyone who can open your dashboard can see what you're playing. The download only listens on your own computer unless you change that.

**Want stats from your local player too?** Most players can send your plays to ListenBrainz ("scrobbling"), which pupboard already reads: foobar2000 and MusicBee have plugins, Linux has MPRIS scrobblers such as `rescrobbled`, and browser extensions like Web Scrobbler cover music sites. Then set the Music card to ListenBrainz.

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
| `ROBLOX_LOGS` | `auto` | `off` stops reading Roblox's log files on this computer |
| `ROBLOX_POLL_SECONDS` | `60` | How often pupboard checks what you're playing on Roblox (with a cookie) |
| `LOCAL_NOW_PLAYING` | `off` | `on` adds what's playing on this computer to the Music card |
| `DEALS` | `on` | `off` hides game deals |
| `DEALS_CURRENCY` | `USD` | `AUD` or `GBP` for deal prices |
| `SETUP_PAGE` | `1` | `0` turns the Settings page off |
| `DATA_DIR` | `./data` | Where settings and Steam and Roblox history are stored |
| `DEMO_MODE` | `0` | `1` shows made-up data |

> [!NOTE]
> **Clock showing the wrong time?** Set `TIME_ZONE` (e.g. `Europe/London`). Some privacy-focused browsers (Firefox's "resist fingerprinting", LibreWolf, Mullvad Browser) report UTC instead of your real zone. Docker's usual `TZ` works too.

> [!TIP]
> **Quoting in `.env`:** if a password or key has `$`, `#`, spaces or quotes in it, wrap it in **single** quotes, like `NAVIDROME_PASSWORD='pa$$ #word'`. Without them, Docker Compose treats `$` as a variable and drops anything after ` #`. Double quotes still expand `$`.
