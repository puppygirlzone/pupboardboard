#!/bin/sh
# Prints one version's section of CHANGELOG.md (used as the GitHub release notes).
#   scripts/release-notes.sh 1.3.0
set -eu
version="${1#v}"
awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && /^## \[/ { exit }
  on && /^\[[^]]+\]: / { exit }
  on { print }
' "$(dirname "$0")/../CHANGELOG.md" | sed -e '/./,$!d'
