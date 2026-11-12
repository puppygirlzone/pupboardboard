#!/bin/sh
# pupboard launcher for macOS: double-click to start (the first time,
# right-click it and choose Open). Keep the Terminal window open while you
# use the dashboard; close it to stop.
cd "$(dirname "$0")" || exit 1
# Files from a downloaded zip are quarantined by macOS; clear that for this folder.
xattr -dr com.apple.quarantine . 2>/dev/null
set --
[ -f .env ] && set -- --env-file=.env
OPEN_BROWSER=1 DEFAULT_HOST=127.0.0.1 ./runtime/node "$@" server/index.js
