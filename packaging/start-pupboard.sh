#!/bin/sh
# pupboard launcher for Linux: run it (or double-click and choose "Run in
# terminal"). Keep the terminal open while you use the dashboard; Ctrl+C stops it.
cd "$(dirname "$0")" || exit 1
set --
[ -f .env ] && set -- --env-file=.env
OPEN_BROWSER=1 DEFAULT_HOST=127.0.0.1 exec ./runtime/node "$@" server/index.js
