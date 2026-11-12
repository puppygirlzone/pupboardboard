# Changelog

What changed in each release of pupboard. Versions follow [semantic versioning](https://semver.org): the last number is for fixes, the middle one for new features, and the first one for changes that would break an existing setup (none so far).

Downloads: [Releases](https://github.com/puppygirlzone/pupboardboard/releases). Docker: `ghcr.io/puppygirlzone/pupboardboard` (`latest`, or a version such as `1.3`).

## [Unreleased]

Thanks to Bird for testing pupboard and suggesting most of this release: launching games from Steam, keeping background apps out of your hours, and the Settings page fixes.

### Added
- Gaming: click a game's name to launch it in Steam (on a computer with Steam installed; your browser asks the first time). Prefer the Steam store page? Choose it in Settings → Gaming (`STEAM_LINKS=store`).

### Fixed
- Gaming: apps that run in the background, such as Soundpad, Bongo Cat and Wallpaper Engine, no longer count as games or flood your hours. Change the list in Settings → Gaming, or with `STEAM_HIDE` ("none" counts everything).
- Text could look jagged or pixelated around the edges on normal-density screens; letters now keep their smooth shape.
- Settings: the "Showing now" line under the Music and Media card choices no longer overlaps the dropdown.
- Settings: the Spotify buttons sit at the bottom of their box, with Disconnect as a small red button on the right; the "Connected since" date that got in the way is gone.

## [1.3.1] - 2026-11-12

### Changed
- The secret-word box (five taps on the greeting) is one joined pill: the text field with the OK button as its end, and no extra highlight ring.
- Every release now has readable notes, collected in `CHANGELOG.md` (also included in the downloads).

## [1.3.0] - 2026-11-12

### Added
- **Deal prices in your currency:** choose US dollars, Australian dollars or British pounds in Settings → Game deals (`DEALS_CURRENCY`).
  - Steam sales show Steam's real local price. A game that's on sale in the US but not where you are is left out.
  - **GOG sales**, a new section, priced in your currency.
  - **Epic's free games** with their real local "was" price.
  - Free games from other stores only have a US price, so theirs is converted at the day's exchange rate (European Central Bank, via Frankfurter) and marked "≈".
  - Still no accounts or keys.

### Changed
- If Steam's local prices can't be fetched, the US price is shown and labelled "US$" rather than hiding the deal.
- The test suite is leaner (183 → 107 tests) with the same checks.

## [1.2.0] - 2026-11-12

### Added
- A **menu button** (≡) in the top bar: the theme picker, day/night switch and Settings slide out of it.
- More hidden surprises. Tap the greeting five times to try a secret word (works on phones).

### Fixed
- A broken or hostile news feed could freeze pupboard for minutes; feeds are now read in a way that stays fast on any input.
- Spotify could sign you out at random when its sign-in refreshed; it now refreshes once at a time.
- When a source sends a huge response, pupboard stops reading it as soon as it's too big, instead of loading it all first.
- Some numbers from Jellyfin weren't escaped before being shown.
- Switching Steam accounts no longer mixes the two accounts' play history in "last 7 days".
- A malformed request to the Settings page could hang instead of getting an error.

### Security
- When pupboard only listens on your own computer (the download's default), it now refuses requests that use any other host name, which stops a web page from reading your stats through your browser.

## [1.1.0] - 2026-11-12

### Added
- **Spotify**, two ways: through [ListenBrainz](https://listenbrainz.org) (no keys, just a username) or directly with Spotify sign-in (needs Premium and your own free Spotify developer app).
- **Letterboxd:** films you've watched, with ratings and posters. Just a username.
- **Game deals:** free-to-keep PC games and the best Steam sales, with nothing to set up.
- Choose which service fills the Music and Media cards in Settings; "Automatic" picks the first one set up.
- Steam accepts your **profile link** (or custom name) instead of the 17-digit SteamID.

### Changed
- Default news feeds are now gaming: Steam News, GamingOnLinux, r/GameDeals and Rock Paper Shotgun. Your own feed list isn't affected.
- Without Jellyfin, the Media card shows game deals instead of "Not set up".

## [1.0.0] - 2026-11-12

First public release.

### Added
- Animated stats homepage for Steam playtime, Navidrome music, Jellyfin media and RSS/Atom news, with themes, day/night mode and an animated dot-grid background.
- **Download and double-click** zips for Windows, macOS and Linux with Node.js included, and a **Settings page** in the browser, so no terminal or `.env` editing is needed.
- **Docker image** on ghcr.io (amd64 and arm64), with Compose and Dockge support.
- Copes with unreliable services: timeouts, retries, cached data marked **Offline** or **Partial**, and "—" instead of a misleading 0.

[Unreleased]: https://github.com/puppygirlzone/pupboardboard/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/puppygirlzone/pupboardboard/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/puppygirlzone/pupboardboard/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/puppygirlzone/pupboardboard/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/puppygirlzone/pupboardboard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/puppygirlzone/pupboardboard/releases/tag/v1.0.0
