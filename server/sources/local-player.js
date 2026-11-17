// "On this PC": what a music player on the computer running pupboard is
// playing right now. Only a title, artist and album; no history, no art.
//
//   Linux:   MPRIS over D-Bus, read with `gdbus` (ships with most desktops)
//   Windows: the system media controls, read with a small PowerShell script
//   Others, or inside a container: not available
//
// Commands are run with fixed arguments (never through a shell), with a
// timeout and an output cap, and every failure just means "nothing to show".
//
// Album art: players report a link (a local file, a web address, or on
// Windows the picture itself). That link never leaves the server, because
// some players (Navidrome clients) put a login token in it. The browser gets
// /api/local/art?k=<hash> instead, which serves the current song's picture
// only, and only if it really is an image.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readCapped } from '../resilience.js';

const MAX_OUTPUT = 256 * 1024; // bytes per command (gdbus)
const MAX_WINDOWS_OUTPUT = 8 * 1024 * 1024; // the PowerShell answer can carry one picture
const MAX_PLAYERS = 8;
const MAX_TEXT = 300; // characters per title/artist/album
const MAX_DEPTH = 32;
export const MAX_ART_BYTES = 5 * 1024 * 1024;
const MAX_ART_REF = 4096; // characters in an art link (a Windows picture is sent separately)

/* ------------------------------------------------------------ GVariant text */

/**
 * Parses the text form of a GVariant, as printed by `gdbus call`, into plain
 * JS values: tuples and arrays become arrays, dictionaries objects, variants
 * their content. One pass, no backtracking; throws on anything malformed.
 */
export function parseGVariant(text) {
  const s = String(text ?? '');
  if (s.length > MAX_OUTPUT) throw new Error('too long');
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (what) => {
    throw new Error(`bad GVariant: ${what} at ${i}`);
  };
  const expect = (ch) => {
    ws();
    if (s[i] !== ch) fail(`expected ${ch}`);
    i++;
  };

  function str() {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') {
        const c = s[i + 1];
        i += 2;
        if (c === 'n') out += '\n';
        else if (c === 't') out += '\t';
        else if (c === 'r') out += '\r';
        else if (c === 'u' || c === 'U') {
          const len = c === 'u' ? 4 : 8;
          const hex = s.slice(i, i + len);
          if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len) fail('bad escape');
          const cp = parseInt(hex, 16);
          out += cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
          i += len;
        } else if (c !== undefined) out += c;
      } else out += s[i++];
    }
    if (s[i] !== q) fail('unclosed string');
    i++;
    return out;
  }

  function list(close, depth) {
    const items = [];
    ws();
    if (s[i] === close) {
      i++;
      return items;
    }
    for (;;) {
      items.push(value(depth + 1));
      ws();
      if (s[i] === ',') {
        i++;
        ws();
        if (s[i] === close) {
          i++;
          return items; // trailing comma: one-element tuple "(x,)"
        }
        continue;
      }
      if (s[i] === close) {
        i++;
        return items;
      }
      fail(`expected , or ${close}`);
    }
  }

  function dict(depth) {
    const out = {};
    ws();
    if (s[i] === '}') {
      i++;
      return out;
    }
    for (;;) {
      const key = value(depth + 1);
      expect(':');
      const val = value(depth + 1);
      if (typeof key === 'string' || typeof key === 'number') out[key] = val;
      ws();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === '}') {
        i++;
        return out;
      }
      fail('expected , or }');
    }
  }

  function value(depth = 0) {
    if (depth > MAX_DEPTH) fail('too deep');
    ws();
    const c = s[i];
    if (c === undefined) fail('unexpected end');
    if (c === '(') return i++, list(')', depth);
    if (c === '[') return i++, list(']', depth);
    if (c === '{') return i++, dict(depth);
    if (c === '<') {
      i++;
      const v = value(depth + 1);
      expect('>');
      return v;
    }
    if (c === "'" || c === '"') return str();
    if (c === '@') {
      // Type annotation, e.g. "@as []": skip the type string.
      i++;
      while (i < s.length && !/\s/.test(s[i])) i++;
      return value(depth + 1);
    }
    // A bare word: true/false/nothing, a type prefix (int64 5, objectpath '/x'), or a number.
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i, i + 32));
    if (m) {
      i += m[0].length;
      if (m[0] === 'true') return true;
      if (m[0] === 'false') return false;
      if (m[0] === 'nothing') return null;
      if (m[0] === 'just') return value(depth + 1);
      return value(depth + 1); // int64, uint32, double, objectpath, signature, byte, handle…
    }
    const n = /^[-+]?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|inf|nan)/.exec(s.slice(i, i + 64));
    if (n) {
      i += n[0].length;
      return Number(n[0]);
    }
    return fail(`unexpected ${JSON.stringify(c)}`);
  }

  const result = value();
  ws();
  if (i !== s.length) fail('trailing text');
  return result;
}

/* ------------------------------------------------------------ shaping */

const clean = (v) => {
  const t = (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

/** A usable art link: a local file, a web address or an inline picture. Anything else is dropped. */
export function artRef(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v.length > MAX_ART_REF) return null;
  return /^(?:file:\/\/\/|https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(v) ? v : null;
}

/**
 * The few fields we show, plus the art link (kept on the server: see
 * publicTrack). Nothing else from the player is kept.
 */
export function shapeTrack({ title, artist, album, player, status, seconds, art }) {
  const t = { title: clean(title), artist: clean(artist), album: clean(album), player: clean(player), playing: status === 'Playing' };
  if (Number.isFinite(seconds) && seconds > 0 && seconds < 86_400) t.seconds = Math.round(seconds);
  const ref = art?.startsWith?.('base64:') ? art : artRef(art);
  if (ref) t.artRef = ref;
  return t.title ? t : null;
}

/** Short, one-way name for an art link: changes with the picture, reveals nothing about the link. */
export const artKey = (ref) => createHash('sha256').update(String(ref)).digest('hex').slice(0, 20);

/** What the browser may see: no art link, just pupboard's own address for the picture. */
export function publicTrack(t) {
  if (!t) return null;
  const { artRef: ref, ...rest } = t;
  return ref ? { ...rest, art: `/api/local/art?k=${artKey(ref)}` } : rest;
}

/** "org.mpris.MediaPlayer2.Feishin" / "...vlc.instance1234" -> "Feishin" / "vlc". */
export function playerName(busName) {
  const rest = String(busName ?? '').replace(/^org\.mpris\.MediaPlayer2\./, '');
  return rest.split('.')[0] || rest;
}

/** MPRIS bus names from `gdbus ... ListNames` output. */
export function parseMprisNames(text) {
  const parsed = parseGVariant(text);
  const names = Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0] : [];
  return names.filter((n) => typeof n === 'string' && /^org\.mpris\.MediaPlayer2\.[A-Za-z0-9_.-]+$/.test(n)).slice(0, MAX_PLAYERS);
}

/** One player's state from `gdbus ... Properties.GetAll org.mpris.MediaPlayer2.Player`. */
export function parseMprisPlayer(text, busName) {
  const parsed = parseGVariant(text);
  const props = Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object' && !Array.isArray(parsed[0]) ? parsed[0] : {};
  const meta = props.Metadata && typeof props.Metadata === 'object' && !Array.isArray(props.Metadata) ? props.Metadata : {};
  const micro = Number(meta['mpris:length']);
  return shapeTrack({
    title: meta['xesam:title'],
    artist: meta['xesam:artist'],
    album: meta['xesam:album'],
    player: playerName(busName),
    status: props.PlaybackStatus,
    seconds: micro / 1e6,
    art: meta['mpris:artUrl'],
  });
}

/** "Spotify.exe", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" -> a readable app name. */
export function windowsAppName(id) {
  const s = String(id ?? '').split('!').pop();
  return s.replace(/\.exe$/i, '');
}

/** The PowerShell script's JSON: a list of { app, status, title, artist, album }. */
export function parseWindowsSessions(text) {
  if (String(text ?? '').length > MAX_WINDOWS_OUTPUT) throw new Error('too long');
  const parsed = JSON.parse(String(text || '[]').trim() || '[]');
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : [];
  return list
    .slice(0, MAX_PLAYERS)
    .map((x) =>
      x && typeof x === 'object'
        ? shapeTrack({
            title: x.title,
            artist: x.artist,
            album: x.album,
            player: windowsAppName(x.app),
            status: x.status,
            // The picture itself, base64 (only sent for the playing session).
            art: typeof x.art === 'string' && x.art && x.art.length <= (MAX_ART_BYTES * 4) / 3 + 4 && /^[A-Za-z0-9+/]+=*$/.test(x.art) ? `base64:${x.art}` : null,
          })
        : null,
    )
    .filter(Boolean);
}

/** The one to show: the first player that is playing, if any. */
export const pickPlaying = (tracks) => tracks.find((t) => t?.playing) ?? null;

/* ------------------------------------------------------------ commands */

// Windows PowerShell 5.1 (built into Windows) can reach the WinRT media API.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $null = $t.Wait(2000); $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$out = @()
foreach ($s in $mgr.GetSessions()) {
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $status = [string]$s.GetPlaybackInfo().PlaybackStatus
  $art = ''
  if ($status -eq 'Playing' -and $p.Thumbnail) {
    try {
      $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      $size = [uint32]$stream.Size
      if ($size -gt 0 -and $size -le 5242880) {
        $reader = [Windows.Storage.Streams.DataReader]::new($stream)
        $null = Await ($reader.LoadAsync($size)) ([uint32])
        $bytes = New-Object byte[] $size
        $reader.ReadBytes($bytes)
        $art = [Convert]::ToBase64String($bytes)
      }
    } catch { $art = '' }
  }
  $out += [pscustomobject]@{ app = [string]$s.SourceAppUserModelId; status = $status; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle; art = $art }
}
ConvertTo-Json -InputObject @($out) -Compress
`;
export const windowsCommand = () => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')]];

/** Runs a command without a shell. Resolves to stdout; rejects on error, timeout or too much output. */
export function runCommand(cmd, args, timeoutMs, maxBuffer = MAX_OUTPUT) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

const MPRIS_PATH = '/org/mpris/MediaPlayer2';

async function readLinux(run, timeoutMs) {
  const names = parseMprisNames(await run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.ListNames'], timeoutMs));
  const players = await Promise.all(
    names.map(async (name) => {
      try {
        const out = await run('gdbus', ['call', '--session', '--dest', name, '--object-path', MPRIS_PATH, '--method', 'org.freedesktop.DBus.Properties.GetAll', 'org.mpris.MediaPlayer2.Player'], timeoutMs);
        return parseMprisPlayer(out, name);
      } catch {
        return null; // one stuck or odd player doesn't hide the others
      }
    }),
  );
  return pickPlaying(players);
}

async function readWindows(run, timeoutMs) {
  const [cmd, args] = windowsCommand();
  return pickPlaying(parseWindowsSessions(await run(cmd, args, timeoutMs, MAX_WINDOWS_OUTPUT)));
}

/* ------------------------------------------------------------ album art */

/** The picture's type from its first bytes (JPEG, PNG, GIF or WebP), or null. SVG and anything else is refused. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function readLocalFile(file) {
  const fh = await open(file, 'r');
  try {
    const info = await fh.stat();
    if (!info.isFile() || info.size > MAX_ART_BYTES || info.size === 0) return null;
    const buf = Buffer.alloc(info.size);
    const { bytesRead } = await fh.read(buf, 0, info.size, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * The picture behind an art link, as { type, body }, or null. Local files are
 * read only if they are a regular file under the size cap; web pictures are
 * fetched with a timeout and a cap. Either way it must really be an image.
 */
export async function loadArt(ref, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  try {
    let body = null;
    if (ref.startsWith('base64:')) body = Buffer.from(ref.slice(7), 'base64');
    else if (/^data:image\//i.test(ref)) body = Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64');
    else if (/^file:\/\/\//i.test(ref)) body = await readLocalFile(fileURLToPath(ref));
    else if (/^https?:\/\//i.test(ref)) {
      const res = await fetchImpl(ref, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) body = await readCapped(res, MAX_ART_BYTES, 'album art');
    }
    if (!body || body.length > MAX_ART_BYTES) return null;
    const type = sniffImage(body);
    return type ? { type, body } : null;
  } catch {
    return null; // missing file, offline, too big: just no picture
  }
}

/* ------------------------------------------------------------ reader */

/**
 * Returns { read, art }.
 * read() -> { status, playing }:
 *   status 'off'          LOCAL_NOW_PLAYING isn't on
 *   status 'unavailable'  this system can't be asked (macOS, a container), with a reason
 *   status 'ok'           playing: { title, artist, album, player, seconds?, art? } or null
 *   status 'error'        the player couldn't be read this time
 * art(key) -> { type, body } | null: the current song's picture, only when
 * key matches it (keys come from read()).
 * Never throws. Calls close together share one reading (minAgeMs), so many
 * open tabs don't start many processes.
 */
export function createLocalPlayer({ enabled, platform = process.platform, inContainer = false, run = runCommand, fetchImpl = globalThis.fetch, timeoutMs, minAgeMs = 1500, now = Date.now } = {}) {
  const limit = timeoutMs ?? (platform === 'win32' ? 4000 : 1200);
  let last = null; // public result
  let lastRef = null; // current song's art link (server only)
  let lastAt = 0;
  let pending = null;
  let picture = { key: null, image: null };

  async function readOnce() {
    try {
      const track = platform === 'win32' ? await readWindows(run, limit) : await readLinux(run, limit);
      lastRef = track?.artRef ?? null;
      return { status: 'ok', playing: publicTrack(track) };
    } catch (err) {
      const missing = err?.code === 'ENOENT';
      return missing
        ? { status: 'unavailable', playing: null, reason: platform === 'win32' ? 'PowerShell was not found' : 'gdbus was not found (install glib2)' }
        : { status: 'error', playing: null, reason: err?.killed ? 'the player took too long to answer' : 'the player could not be read' };
    }
  }

  async function read() {
    if (!enabled) return { status: 'off', playing: null };
    if (inContainer) return { status: 'unavailable', playing: null, reason: 'not available inside Docker' };
    if (platform !== 'linux' && platform !== 'win32') return { status: 'unavailable', playing: null, reason: 'only works on Linux and Windows' };
    if (last && now() - lastAt < minAgeMs) return last;
    pending ??= readOnce().then((r) => {
      last = r;
      lastAt = now();
      pending = null;
      return r;
    });
    return pending;
  }

  async function art(key) {
    if (!enabled || !lastRef || typeof key !== 'string' || key !== artKey(lastRef)) return null;
    if (picture.key !== key) picture = { key, image: loadArt(lastRef, { fetchImpl }) };
    return picture.image;
  }

  return { read, art };
}

/* ------------------------------------------------------------ demo */

const DEMO_TRACKS = [
  { title: 'Lantern Static', artist: 'The Paper Comets', album: 'Night Bus Atlas', player: 'Strawberry' },
  { title: 'Kettle Song', artist: 'Mossgrove', album: 'Small Kitchens', player: 'Spotify' },
  { title: 'Overpass Bloom', artist: 'Juniper Vale', album: 'Overpass Bloom', player: 'Feishin' },
];

/** Demo mode: invented songs that change every minute, sometimes nothing, sometimes a failure. */
export function createDemoLocalPlayer({ now = Date.now, random = Math.random } = {}) {
  async function read() {
    const r = random();
    if (r < 0.15) return { status: 'error', playing: null, reason: 'the player could not be read' };
    if (r < 0.3) return { status: 'ok', playing: null };
    const n = Math.floor(now() / 60_000) % DEMO_TRACKS.length;
    return { status: 'ok', playing: { ...DEMO_TRACKS[n], playing: true, seconds: 214, art: `/api/demo-art/local-${n}?w=160&h=160` } };
  }
  return { read, art: async () => null };
}
