// Roblox play sessions from the Roblox app's own log files on the computer
// pupboard runs on. No login needed: each time you join an experience the
// Roblox app writes a line like
//
//   2026-11-19T12:38:36.083Z,22.08,c575,6 [FLog::Output] ! Joining game '<job>' place 86355335942235 at <ip>
//
// and when you leave, lines such as "Client:Disconnect". Log folders:
//
//   Windows:   Roblox, Bloxstrap, Fishstrap, Microsoft Store
//   macOS:     Roblox
//   Linux:     Sober, Cordial, Quadra
//   anywhere:  ROBLOX_LOG_DIR (an extra folder, for example mounted into Docker)
// (exact folders in robloxLogDirs below). Every client's folder is read.
//
// Files are only read (never run), scanned line by line with indexOf, and
// capped in number and size. Roblox Studio logs are skipped.

import { readdir, stat, lstat, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MAX_FILES = 60;
export const MAX_LOG_BYTES = 64 * 1024 * 1024;
const KEEP_MS = 35 * 86_400_000;
const LIVE_MS = 3 * 60_000; // a log written to in the last 3 minutes belongs to a running Roblox
const TS = /(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?Z/;
const PLACE = / place (\d{1,20})(?: |$)/;
const JOIN = '! Joining game ';
const LEAVE = ['Client:Disconnect', 'leaveUGCGameInternal', 'Disconnection Notification', 'Time to disconnect replication data'];

function timeOf(line) {
  // Timestamps sit near the start ("info: Roblox: 2026-..." on Sober, first thing on Windows/macOS).
  const m = TS.exec(line.length > 120 ? line.slice(0, 120) : line);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.floor(Number(`0.${m[7]}`) * 1000) : 0);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * One log file's text into sessions [{ placeId, start, end, open }], oldest first.
 * `open` means no "leave" line yet (end is then the last time seen in the file).
 * One pass over the lines, no backtracking regexes on whole lines.
 */
export function parseRobloxLog(text) {
  const s = String(text ?? '');
  const sessions = [];
  let current = null;
  let last = null;
  let i = 0;
  while (i < s.length) {
    let j = s.indexOf('\n', i);
    if (j === -1) j = s.length;
    const line = s.slice(i, Math.min(j, i + 2000));
    i = j + 1;
    const t = timeOf(line);
    if (t == null) continue;
    last = t;
    if (current) current.end = t;
    const join = line.indexOf(JOIN);
    if (join !== -1) {
      const m = PLACE.exec(line.slice(join));
      const placeId = m ? Number(m[1]) : NaN;
      if (current) current.open = false;
      current = null;
      if (Number.isSafeInteger(placeId) && placeId > 0) {
        current = { placeId, start: t, end: t, open: true };
        sessions.push(current);
      }
      continue;
    }
    if (current && LEAVE.some((w) => line.includes(w))) {
      current.end = t;
      current.open = false;
      current = null;
    }
  }
  if (current && last != null) current.end = Math.max(current.end, last);
  return sessions;
}

const ANY = /^[^.][^/\\]{0,200}$/; // one folder of any name (a profile, a user), not hidden

/**
 * Where Roblox clients write the Roblox app's logs, as folder paths split
 * into parts. A RegExp part matches any folder with that name pattern, for
 * clients that keep logs per profile or per user. All of them are checked;
 * finding one client never stops another from being read.
 *   Windows: Roblox itself, Bloxstrap and Fishstrap (same folder), Microsoft Store
 *   Linux:   Sober, Cordial and Quadra (Flatpak or not)
 *   macOS:   Roblox itself
 */
export function robloxLogDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return [
      { client: 'Roblox, Bloxstrap or Fishstrap', parts: [local, 'Roblox', 'logs'] },
      { client: 'Roblox (Microsoft Store)', parts: [local, 'Packages', /^ROBLOXCORPORATION\.ROBLOX_/i, 'LocalState', 'logs'] },
    ];
  }
  if (platform === 'darwin') return [{ client: 'Roblox', parts: [home, 'Library', 'Logs', 'Roblox'] }];
  if (platform === 'linux') {
    const share = env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share');
    const flatpak = (id) => path.posix.join(home, '.var', 'app', id, 'data');
    return [
      { client: 'Sober', parts: [flatpak('org.vinegarhq.Sober'), 'sober', 'sober_logs'] },
      { client: 'Sober', parts: [flatpak('org.vinegarhq.Sober'), 'sober', 'appData', 'logs'] },
      // Cordial runs the Android client; each Cordial profile has its own logs.
      { client: 'Cordial', parts: [flatpak('io.github.luohoa97.Cordial'), 'cordial', 'profiles', ANY, 'data', 'files', 'appData', 'logs'] },
      { client: 'Cordial', parts: [share, 'cordial', 'profiles', ANY, 'data', 'files', 'appData', 'logs'] },
      // Quadra runs the macOS client in its own prefix, so logs sit in a Mac-style home folder.
      { client: 'Quadra', parts: [share, 'quadra', 'prefix', 'root', 'Users', ANY, 'Library', 'Logs', 'Roblox'] },
      { client: 'Quadra', parts: [flatpak('org.quadrahq.Quadra'), 'quadra', 'prefix', 'root', 'Users', ANY, 'Library', 'Logs', 'Roblox'] },
    ];
  }
  return [];
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

const MAX_MATCHES = 10; // folders per wildcard (profiles, users)

/** Every existing folder a parts list points at (RegExp parts matched against folder names). */
async function expand(parts, join) {
  let current = [parts[0]];
  for (const part of parts.slice(1)) {
    const next = [];
    for (const base of current) {
      if (typeof part === 'string') {
        next.push(join(base, part));
        continue;
      }
      try {
        const names = (await readdir(base)).filter((n) => part.test(n)).sort().slice(0, MAX_MATCHES);
        for (const n of names) next.push(join(base, n));
      } catch {
        /* folder missing: nothing here */
      }
    }
    current = next;
    if (!current.length) return [];
  }
  const found = [];
  for (const dir of current) if (await isDir(dir)) found.push(dir);
  return found;
}

/**
 * The log folders that exist right now, for every client found, plus
 * ROBLOX_LOG_DIR if set (an extra folder, e.g. mounted into Docker).
 */
export async function findRobloxLogDirs({ customDir = '', platform = process.platform, env, home } = {}) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  const found = [];
  if (customDir && (await isDir(customDir))) found.push(customDir);
  for (const entry of robloxLogDirs({ platform, env, home })) {
    for (const dir of await expand(entry.parts, join)) if (!found.includes(dir)) found.push(dir);
  }
  return found;
}

async function readUpTo(file, maxBytes) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * Reads Roblox logs on this computer. read() returns
 *   { dirs, sessions: [{ placeId, start, end, live }] }
 * where `live` marks a session still going on right now.
 * Files that haven't changed since the last read are not read again.
 */
export function createRobloxLogReader({ customDir = '', now = Date.now, platform, env, home, maxBytes = MAX_LOG_BYTES } = {}) {
  const cache = new Map(); // file -> { mtimeMs, size, sessions }

  return {
    async read() {
      const at = now();
      const dirs = await findRobloxLogDirs({ customDir, platform, env, home });
      const files = [];
      for (const dir of dirs) {
        let names = [];
        try {
          names = await readdir(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (!/\.log$/i.test(name) || /studio/i.test(name)) continue;
          const file = path.join(dir, name);
          try {
            const st = await lstat(file); // skips links such as Sober's latest.log (a second copy)
            if (st.isFile() && at - st.mtimeMs <= KEEP_MS) files.push({ file, mtimeMs: st.mtimeMs, size: st.size });
          } catch {
            /* vanished: fine */
          }
        }
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const keep = files.slice(0, MAX_FILES);
      const sessions = [];
      const seen = new Set();
      for (const f of keep) {
        seen.add(f.file);
        let entry = cache.get(f.file);
        if (!entry || entry.mtimeMs !== f.mtimeMs || entry.size !== f.size) {
          try {
            entry = { mtimeMs: f.mtimeMs, size: f.size, sessions: parseRobloxLog(await readUpTo(f.file, Math.min(f.size, maxBytes))) };
          } catch {
            continue; // unreadable (locked on Windows, permissions): skip this file
          }
          cache.set(f.file, entry);
        }
        const fresh = at - f.mtimeMs <= LIVE_MS;
        for (const sess of entry.sessions) {
          const live = sess.open && fresh;
          sessions.push({ placeId: sess.placeId, start: sess.start, end: live ? Math.max(sess.end, at) : sess.end, live });
        }
      }
      for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
      sessions.sort((a, b) => a.start - b.start);
      return { dirs, sessions };
    },
  };
}
