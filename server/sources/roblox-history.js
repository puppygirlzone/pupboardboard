// Roblox has no play-history API, so pupboard keeps its own: a list of play
// sessions (which experience, from when to when) in DATA_DIR/roblox-history.json.
// Sessions come from two places:
//   presence: the server asks Roblox what you're in every ROBLOX_POLL_SECONDS
//   log:      the Roblox app's log files on this computer (exact join/leave times)
// Overlapping time is only counted once.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DAY = 86_400_000;
export const WEEK = 7 * DAY;
const KEEP_MS = 35 * DAY;
const MAX_SESSIONS = 5000;

const okId = (v) => Number.isSafeInteger(v) && v > 0;

function clean(parsed) {
  const s = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    account: typeof s.account === 'string' ? s.account : null,
    since: Number.isFinite(s.since) ? s.since : null,
    sessions: Array.isArray(s.sessions)
      ? s.sessions.filter((x) => x && okId(x.p) && Number.isFinite(x.s) && Number.isFinite(x.e) && x.e >= x.s && (x.src === 'presence' || x.src === 'log'))
      : [],
    universes: s.universes && typeof s.universes === 'object' ? s.universes : {}, // placeId -> universeId
  };
}

export function createRobloxHistory({ dataDir, fileName = 'roblox-history.json', seed = null }) {
  const file = path.join(dataDir, fileName);
  let state = null;

  async function load() {
    if (state) return state;
    try {
      state = clean(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      state = clean(null); // missing or corrupt file: start fresh
    }
    if (seed && !state.sessions.length) Object.assign(state, clean(seed()));
    return state;
  }

  // One write at a time (checks, log reads and lookups can overlap).
  let writing = Promise.resolve();
  function save() {
    writing = writing.then(async () => {
      try {
        await mkdir(dataDir, { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(state));
        await rename(tmp, file);
      } catch (err) {
        console.warn(`[roblox] could not save play history: ${err.message}`);
      }
    });
    return writing;
  }

  function prune(at) {
    state.sessions = state.sessions.filter((x) => at - x.e <= KEEP_MS).slice(-MAX_SESSIONS);
  }

  return {
    /** Everything so far: { account, since, sessions, universes }. */
    async current() {
      return load();
    },
    /** A different Roblox account's history would be wrong: start over. */
    async forAccount(account) {
      const s = await load();
      if (account && s.account && s.account !== String(account)) {
        Object.assign(s, clean(null));
        console.log('[roblox] different Roblox account: starting play history again');
      }
      if (account) s.account = String(account);
      return s;
    },
    /** Start of tracking (first successful check). */
    async markTracking(at) {
      const s = await load();
      if (s.since == null) {
        s.since = at;
        await save();
      }
    },
    /**
     * One presence check: in an experience (placeId, universeId) or not (null).
     * A sighting within gapMs of the last one for the same experience extends
     * that session; otherwise a new one starts half a check before (the middle
     * of the time we couldn't see).
     */
    async addPresence({ at, placeId = null, universeId = null, pollMs, gapMs = pollMs * 2.5 }) {
      const s = await load();
      if (!okId(placeId)) return;
      if (okId(universeId)) s.universes[placeId] = universeId;
      const last = [...s.sessions].reverse().find((x) => x.src === 'presence');
      const same = last && (last.u && universeId ? last.u === universeId : last.p === placeId);
      if (same && at - last.e <= gapMs && at >= last.e) last.e = at;
      else s.sessions.push({ p: placeId, u: okId(universeId) ? universeId : null, s: at - Math.round(pollMs / 2), e: at, src: 'presence' });
      prune(at);
      await save();
    },
    /** Sessions read from Roblox's log files ({ placeId, start, end }). */
    async addLogSessions(list, at) {
      const s = await load();
      let changed = false;
      for (const l of list) {
        if (!okId(l.placeId) || !(l.end >= l.start) || at - l.end > KEEP_MS) continue;
        const known = s.sessions.find((x) => x.src === 'log' && x.p === l.placeId && Math.abs(x.s - l.start) < 2000);
        if (known) {
          if (known.e !== l.end) {
            known.e = Math.max(known.e, l.end);
            changed = true;
          }
        } else {
          s.sessions.push({ p: l.placeId, u: s.universes[l.placeId] ?? null, s: l.start, e: l.end, src: 'log' });
          changed = true;
        }
      }
      if (changed) {
        s.sessions.sort((a, b) => a.s - b.s);
        prune(at);
        await save();
      }
    },
    /** placeId -> universeId, learned from Roblox (log files only know the place). */
    async setUniverse(placeId, universeId) {
      const s = await load();
      if (!okId(placeId) || !okId(universeId)) return;
      s.universes[placeId] = universeId;
      for (const x of s.sessions) if (x.p === placeId) x.u = universeId;
      await save();
    },
  };
}

/**
 * Pure: minutes per experience in the last 7 days (or since tracking began,
 * if that's more recent). Time covered by two sessions at once counts once.
 * Returns { from, perExperience: { key: { minutes, sessions, placeId, universeId } } }.
 * key is the universe id, or "place:<id>" while the universe isn't known yet.
 */
export function computeRobloxWeek(state, at) {
  const sessions = (state?.sessions ?? []).filter((x) => x.e > at - WEEK && x.s <= at).sort((a, b) => a.s - b.s);
  const earliest = (state?.sessions ?? []).reduce((m, x) => Math.min(m, x.s), state?.since ?? at);
  const from = Math.max(at - WEEK, earliest);
  const per = {};
  let cursor = from;
  for (const x of sessions) {
    const u = x.u ?? state?.universes?.[x.p] ?? null;
    const key = u ? String(u) : `place:${x.p}`;
    const a = Math.max(x.s, cursor);
    const b = Math.min(x.e, at);
    const entry = (per[key] ??= { minutes: 0, sessions: 0, placeId: x.p, universeId: u });
    if (x.e > from) entry.sessions += 1;
    if (b > a) {
      entry.minutes += (b - a) / 60_000;
      cursor = b;
    }
  }
  for (const [k, v] of Object.entries(per)) {
    v.minutes = Math.round(v.minutes);
    if (v.minutes <= 0) delete per[k];
  }
  return { from, perExperience: per };
}
