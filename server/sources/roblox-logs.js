// Roblox play sessions from the Roblox app's own log files on the computer
// pupboard runs on. No login needed: each time you join an experience the
// Roblox app writes a line like
//
//   2026-11-19T12:38:36.083Z,22.08,c575,6 [FLog::Output] ! Joining game '<job>' place 86355335942235 at <ip>
//
// and when you leave, lines such as "Client:Disconnect". Log folders:
//
//   Windows:   %LOCALAPPDATA%\Roblox\logs (also used by Bloxstrap / Fishstrap)
//              %LOCALAPPDATA%\Packages\ROBLOXCORPORATION.ROBLOX_*\LocalState\logs (Microsoft Store)
//   macOS:     ~/Library/Logs/Roblox
//   Linux:     ~/.var/app/org.vinegarhq.Sober/data/sober/sober_logs (Sober)
//   anywhere:  ROBLOX_LOG_DIR (for example a folder mounted into Docker)
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

/** Folders the Roblox app writes its logs to on this system (existing or not). */
export function robloxLogDirs({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [path.win32.join(local, 'Roblox', 'logs'), { storeParent: path.win32.join(local, 'Packages') }];
  }
  if (platform === 'darwin') return [path.join(home, 'Library', 'Logs', 'Roblox')];
  if (platform === 'linux') return [path.join(home, '.var', 'app', 'org.vinegarhq.Sober', 'data', 'sober', 'sober_logs')];
  return [];
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** The log folders that exist right now (custom folder first, if given). */
export async function findRobloxLogDirs({ customDir = '', platform, env, home } = {}) {
  if (customDir) return (await isDir(customDir)) ? [customDir] : [];
  const found = [];
  for (const entry of robloxLogDirs({ platform, env, home })) {
    if (typeof entry === 'string') {
      if (await isDir(entry)) found.push(entry);
    } else if (entry.storeParent) {
      // Microsoft Store install: Packages\ROBLOXCORPORATION.ROBLOX_<id>\LocalState\logs
      try {
        for (const name of await readdir(entry.storeParent)) {
          if (!/^ROBLOXCORPORATION\.ROBLOX_/i.test(name)) continue;
          const dir = path.win32.join(entry.storeParent, name, 'LocalState', 'logs');
          if (await isDir(dir)) found.push(dir);
        }
      } catch {
        /* no Packages folder */
      }
    }
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
