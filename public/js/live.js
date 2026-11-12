// Live "now playing": merged into the summary right before a page draws.
// Pure (no DOM) so it can be tested.

/** Swap in the live now-playing list; anything unusable leaves the summary as is. */
export function mergeNowPlaying(summary, live) {
  if (!live || live.status !== 'ok' || !Array.isArray(live.nowPlaying)) return summary;
  const env = summary?.navidrome;
  if (!env?.data) return summary;
  return { ...summary, navidrome: { ...env, data: { ...env.data, nowPlaying: live.nowPlaying } } };
}

/** Fetch the live list; resolves to null on any failure or after timeoutMs. */
export async function fetchNowPlaying(timeoutMs = 2500, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/api/navidrome/now-playing', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
