# Security

## Reporting a problem

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead: on the repository page, go to **Security → Report a vulnerability**. Include what you found, how to reproduce it, and which version (or commit) you tested.

You should get a reply within a week. This is a hobby project, so fixes may take a little while, but security reports are handled first.

For anything that isn't sensitive (bugs, ideas, questions), regular issues are welcome.

## What pupboard protects, and what it doesn't

- **Your keys and passwords** never leave the server: the browser never sees them, they aren't put in URLs or logs, and the Settings page can only tell whether one is set, not read it back. They're stored in `.env` or `data/settings.json` (readable only by your user account).
- **The Settings page** only works in a browser on the computer running pupboard, and only with the code printed when pupboard starts. It's off inside Docker.
- **The dashboard itself has no login.** Anyone who can reach its port can see your gaming, music, media and news stats. Keep it on your home network, or put it behind a reverse proxy that asks for a password if you need it from outside. The download version only listens on your own computer unless you change that in Settings.
- **News feeds** are fetched by the server, so only add feeds you trust the address of. Text from feeds is escaped and only `http(s)` links are shown.

## Supported versions

Only the latest release gets fixes. Update with Dockge's Update button, `docker compose pull && docker compose up -d`, or by downloading the newest zip.
