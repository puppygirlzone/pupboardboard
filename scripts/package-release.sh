#!/usr/bin/env bash
# Builds a ready-to-run zip for people who don't use Docker: the app, its
# node_modules, a Node.js runtime and double-click launchers.
#
#   scripts/package-release.sh <os> <arch>      os: win | linux | darwin   arch: x64 | arm64
#
# Output: build/pupboard-<version>-<os>-<arch>.zip
#
# Environment:
#   VERSION      version in the file name (default: package.json version)
#   NODE_MAJOR   Node.js major to bundle (default 22); the newest release of it is used
#   NODE_VERSION exact Node.js version (e.g. 22.11.0), skips the lookup
#   NODE_BINARY  use this local node binary instead of downloading (local tests only)
#
# Node.js is downloaded from nodejs.org and checked against its SHASUMS256.txt.
set -euo pipefail

os="${1:?usage: package-release.sh <win|linux|darwin> <x64|arm64>}"
arch="${2:?usage: package-release.sh <win|linux|darwin> <x64|arm64>}"
case "$os" in win | linux | darwin) ;; *) echo "unknown os: $os" >&2; exit 2 ;; esac
case "$arch" in x64 | arm64) ;; *) echo "unknown arch: $arch" >&2; exit 2 ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
version="${VERSION:-$(node -p "require('$root/package.json').version")}"
version="${version#v}"
name="pupboard-${version}-${os}-${arch}"
build="$root/build"
stage="$build/$name"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

rm -rf "$stage" "$build/$name.zip"
mkdir -p "$stage/runtime" "$stage/config" "$stage/data"

# --- the app
cp -R "$root/server" "$root/public" "$stage/"
cp "$root/package.json" "$root/package-lock.json" "$root/LICENSE" "$root/README.md" "$root/CHANGELOG.md" "$root/.env.example" "$stage/"
cp "$root/config/feeds.example.txt" "$stage/config/"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

# --- launchers (Windows files get CRLF line endings)
crlf() { sed 's/\r$//; s/$/\r/' "$1" > "$2"; }
crlf "$root/packaging/READ ME FIRST.txt" "$stage/READ ME FIRST.txt"
if [ "$os" = win ]; then
  crlf "$root/packaging/Start pupboard.bat" "$stage/Start pupboard.bat"
elif [ "$os" = darwin ]; then
  cp "$root/packaging/Start pupboard.command" "$stage/"
  chmod 755 "$stage/Start pupboard.command"
else
  cp "$root/packaging/start-pupboard.sh" "$stage/"
  chmod 755 "$stage/start-pupboard.sh"
fi

# --- Node.js runtime
exe="node"
[ "$os" = win ] && exe="node.exe"
if [ -n "${NODE_BINARY:-}" ]; then
  cp "$NODE_BINARY" "$stage/runtime/$exe"
else
  node_version="${NODE_VERSION:-}"
  if [ -z "$node_version" ]; then
    node_version="$(curl -fsSL https://nodejs.org/dist/index.json |
      node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).find(r=>r.version.startsWith('v${NODE_MAJOR:-22}.'));if(!v)process.exit(1);console.log(v.version.slice(1))})")"
  fi
  dist="https://nodejs.org/dist/v${node_version}"
  case "$os" in
    win) archive="node-v${node_version}-win-${arch}.zip" ;;
    darwin) archive="node-v${node_version}-darwin-${arch}.tar.gz" ;;
    linux) archive="node-v${node_version}-linux-${arch}.tar.xz" ;;
  esac
  echo "Bundling Node.js ${node_version} (${archive})"
  curl -fsSL -o "$work/$archive" "$dist/$archive"
  curl -fsSL -o "$work/SHASUMS256.txt" "$dist/SHASUMS256.txt"
  (cd "$work" && grep " ${archive}\$" SHASUMS256.txt | sha256sum -c -)
  inner="${archive%.zip}"
  inner="${inner%.tar.gz}"
  inner="${inner%.tar.xz}"
  if [ "$os" = win ]; then
    unzip -q "$work/$archive" "$inner/node.exe" "$inner/LICENSE" -d "$work"
    cp "$work/$inner/node.exe" "$stage/runtime/node.exe"
  else
    tar -xf "$work/$archive" -C "$work" "$inner/bin/node" "$inner/LICENSE"
    cp "$work/$inner/bin/node" "$stage/runtime/node"
  fi
  cp "$work/$inner/LICENSE" "$stage/runtime/LICENSE-node.txt"
fi
chmod 755 "$stage/runtime/$exe"

# --- zip it (keeps the executable bits for macOS/Linux)
(cd "$build" && zip -qr -X "$name.zip" "$name")
echo "Built $build/$name.zip"
