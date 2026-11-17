# Plan: "On this PC" now playing

Status: built on the `feature/local-now-playing` branch (2026-11-18), not merged. Album art was added at the user's request: the player's link stays on the server and the page gets `/api/local/art?k=<hash>` (see AGENTS.md).

## The idea

Someone suggested pulling music from what's playing locally on your PC. Replacing the Music card with that would lose the point of the board (history and stats), so this stays **small**: a live "On this PC: Song – Artist" line on the Music card, added on top of whatever service already fills it (ListenBrainz, Spotify, Navidrome). No history and no stats come from it.

## Scope

1. **Linux first:** read MPRIS over D-Bus with `gdbus` (ships with most desktops; no new npm dependency). List `org.mpris.MediaPlayer2.*` names, read `PlaybackStatus` and `Metadata` (title, artist, album, length) and prefer the player that is `Playing`.
2. **Windows second:** a small PowerShell script reading the system media controls (`GlobalSystemMediaTransportControlsSessionManager`). Test it with fake output, plus one real run on a Windows PC before release.
3. **Docs:** a section in `docs/Customise.md` covering the setting, "doesn't work in Docker", and a tip that local players can scrobble to ListenBrainz (MPRIS scrobblers on Linux, foobar2000, MusicBee, browser extensions) to get real stats.
4. **Later or never:** macOS (since 15.4 the system-wide now playing is locked down; only Apple Music/Spotify through AppleScript) and album art.

## Rules it must follow

- Off by default: `LOCAL_NOW_PLAYING=on` in `.env`, plus a Settings page toggle (`SETTINGS_FIELDS`, `setup.js`).
- Like the existing live now-playing: never cached, short timeout, always answers 200, fails soft. A missing `gdbus`/PowerShell, a hung player or junk output must never crash the server or hold the page up.
- Spawn the command with fixed arguments (no shell, no user input in the command line), a timeout and an output size cap. Escape everything in views.
- **No album art in v1.** Players give art as `file://` paths, and serving those would mean reading files off the disk. If added later, only serve the exact path the player currently reports, and only image files.
- Only meaningful when pupboard runs on the same computer as the music (the download or `npm start`). In Docker, report "not available in Docker", like Spotify direct.
- Privacy: anyone who can open the dashboard sees what's playing. The download only listens on 127.0.0.1 by default; say this in the docs.
- Tests: parsing real-shaped and junk `gdbus`/PowerShell output, several players at once, nothing playing, the command missing or hanging, the setting off, rendering the line in every state, and escaping.
- Add it to the README's "Work in progress" list when work starts, and to `CHANGELOG.md` when it ships.

## Done when

`npm test` passes; the demo loads 3 times without console errors; on Linux, playing something in a real player shows the line within a page load, and stopping it removes the line.
