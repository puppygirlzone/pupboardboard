# How pupboard handles your services

Home servers go down, APIs time out, and Wi-Fi does Wi-Fi things. pupboard is built so none of that breaks the page. This is how it copes, and where the numbers come from.

[← Back to the README](../README.md)

## When a service is slow or down

- Every request to a service has an 8 second timeout and one retry.
- The last good data is kept. If a service goes down, its card keeps showing that data with an amber **Offline** pill.
- If only part of a service fails, the rest still shows, marked **Partial**, and it tries again after 30 seconds.
- After a failure it waits 30 seconds before trying again, so a dead server isn't hammered.
- The page never waits more than about 4 seconds for a slow service. That card says *Loading* and fills in when it can.
- If pupboard itself can't be reached, your browser shows the last copy it saved.
- The page refreshes every 60 seconds, and whenever you switch back to the tab.

You'll never see a fake 0. If a number is unknown because something failed, it shows "—" instead.

## How accurate the numbers are

Some services only share so much, so here's what each one can and can't tell pupboard:

- **Steam** only reports playtime for the "last 2 weeks". pupboard saves your total playtime once an hour and compares it with a week ago. Until it has 7 days of history, it shows the 2-week figures and says so.
- **Navidrome** only remembers the most recent play of each song, so "tracks this week" and "listening time" are minimums. A song played 5 times counts once.
- **Spotify** only shares your last 50 plays. If all 50 are from this week, the card shows **50+** instead of a made-up total.
- **ListenBrainz** counts every play, repeats included. If most plays have no track length, listening time shows "—" rather than a number that's too low. "Now playing" depends on your music app reporting it, so it can lag a little.
- **Letterboxd**'s feed holds about your last 50 diary entries, so a very busy month shows as "50+".
- **Game deals** use real local Steam, GOG and Epic prices in your currency. Free games from other stores only have a US price, so those are converted at today's exchange rate and marked "≈". If a deal site is down, its number shows "—", not 0.
