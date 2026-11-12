// Steam only reports "minutes played in the last 2 weeks". To show the last
// 7 days, we save total playtime per game at most once an hour and compare the
// current totals with a snapshot from about a week ago.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
const KEEP_MS = 35 * DAY;

export function createSteamHistory({ dataDir, fileName = 'steam-history.json' }) {
  const file = path.join(dataDir, fileName);
  let state = null;

  async function load() {
    if (state) return state;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      state = Array.isArray(parsed?.snapshots) ? parsed : { snapshots: [] };
    } catch {
      state = { snapshots: [] }; // missing or corrupt file: start fresh
    }
    return state;
  }

  async function save() {
    try {
      await mkdir(dataDir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, file);
    } catch (err) {
      console.warn(`[steam] could not save play history: ${err.message}`);
    }
  }

  return {
    /** totals: { [appid]: minutesForever }. Returns all snapshots, oldest first. */
    async record(totals, at) {
      const s = await load();
      const last = s.snapshots.at(-1);
      if (!last || at - last.at >= HOUR) {
        s.snapshots.push({ at, totals });
        s.snapshots = s.snapshots.filter((snap) => at - snap.at <= KEEP_MS);
        await save();
      }
      return s.snapshots;
    },
  };
}

/**
 * Compare current totals with the newest snapshot that is at least 7 days old.
 * Returns null when there is not a week of history yet.
 */
export function computeWeekly(snapshots, totals, at) {
  const baseline = [...snapshots].reverse().find((snap) => at - snap.at >= WEEK);
  if (!baseline) return null;
  const perGame = {};
  for (const [appid, minutes] of Object.entries(totals)) {
    const before = baseline.totals[appid] ?? 0;
    const delta = minutes - before;
    if (delta > 0) perGame[appid] = delta;
  }
  return { since: baseline.at, days: (at - baseline.at) / DAY, perGame };
}

export function trackingSince(snapshots) {
  return snapshots.length ? snapshots[0].at : null;
}
