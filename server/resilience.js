// Helpers that make flaky upstream APIs safe to call.
//
// fetchJson: timeout + HTTP/JSON error handling, with error messages that never
//            include the URL's query string (which may hold API keys).
// createCachedSource: TTL cache, retry, back-off after failure, and
//            stale-while-error. Its get() never throws.

export class UpstreamError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'upstream';
  }
}

/**
 * Reads a response body, giving up as soon as it passes maxBytes (a server
 * that never sends Content-Length can't make us buffer gigabytes).
 */
export async function readCapped(res, maxBytes, label = 'upstream') {
  if (Number(res.headers.get('content-length')) > maxBytes) throw new UpstreamError(`${label} response too large`);
  if (!res.body) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  let tooBig = false;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      tooBig = true;
      break; // leaving the loop cancels the stream
    }
    chunks.push(Buffer.from(chunk));
  }
  if (tooBig) throw new UpstreamError(`${label} response too large`);
  return Buffer.concat(chunks);
}

async function readBodyText(res, url, maxBytes) {
  try {
    return (await readCapped(res, maxBytes, hostOf(url))).toString('utf8');
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timed out' : 'response could not be read';
    throw new UpstreamError(`${hostOf(url)} ${reason}`);
  }
}

/** allowEmpty: a 204 / empty body resolves to null instead of "invalid JSON". */
export async function fetchJson(fetchImpl, url, { timeoutMs = 8000, headers, method = 'GET', body, allowEmpty = false, maxBytes = 5_000_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : 'unreachable';
    throw new UpstreamError(`${hostOf(url)} ${reason}`);
  }
  if (!res.ok) throw new UpstreamError(`${hostOf(url)} returned HTTP ${res.status}`, res.status);
  const text = await readBodyText(res, url, maxBytes);
  if (allowEmpty && (res.status === 204 || !text.trim())) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError(`${hostOf(url)} returned invalid JSON`);
  }
}

/** Like fetchJson but returns text, refusing bodies over maxBytes. */
export async function fetchText(fetchImpl, url, { timeoutMs = 8000, headers, maxBytes = 3_000_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : 'unreachable';
    throw new UpstreamError(`${hostOf(url)} ${reason}`);
  }
  if (!res.ok) throw new UpstreamError(`${hostOf(url)} returned HTTP ${res.status}`, res.status);
  return readBodyText(res, url, maxBytes);
}

// Runs several named requests at once. Returns the successful values plus a
// list of warnings for the ones that failed. If `memory` (a plain object kept
// by the caller) holds an earlier good value for a failed request, that value
// is used instead. Throws only if every request fails.
export async function settleAll(tasks, memory = null) {
  const names = Object.keys(tasks);
  const results = await Promise.allSettled(names.map((n) => tasks[n]()));
  const values = {};
  const warnings = [];
  results.forEach((r, i) => {
    const name = names[i];
    if (r.status === 'fulfilled') {
      values[name] = r.value;
      if (memory) memory[name] = r.value;
    } else if (memory && name in memory) {
      values[name] = memory[name];
      warnings.push(`${name}: ${safeMessage(r.reason)} (showing older data)`);
    } else {
      warnings.push(`${name}: ${safeMessage(r.reason)}`);
    }
  });
  if (warnings.length === names.length) {
    throw new UpstreamError(safeMessage(results[0].reason));
  }
  return { values, warnings };
}

export function safeMessage(err) {
  const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  // Belt and braces: strip anything that looks like a credential parameter.
  return msg.replace(/([?&](key|api_key|apikey|token|t|s|p|u|password)=)[^&\s]*/gi, '$1***').slice(0, 300);
}

export function createCachedSource({ name, ttlMs, isConfigured, load, retries = 1, retryDelayMs = 300, now = Date.now, version = () => null }) {
  let cache = null; // { data, fetchedAt, version }
  let lastError = null; // { message, at }
  let inflight = null;
  const backoffMs = Math.min(ttlMs, 30_000);
  // Data where some sub-requests failed is re-fetched sooner than full data.
  const ttlFor = (data) => (data?.warnings?.length ? Math.min(ttlMs, 30_000) : ttlMs);

  async function refresh() {
    let error;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const v = version();
        const data = await load();
        cache = { data, fetchedAt: now(), version: v };
        lastError = null;
        return;
      } catch (err) {
        error = err;
        if (attempt < retries && retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
    lastError = { message: safeMessage(error), at: now() };
  }

  function envelope(status, extra = {}) {
    return {
      source: name,
      status,
      data: cache?.data ?? null,
      updatedAt: cache ? new Date(cache.fetchedAt).toISOString() : null,
      error: lastError?.message ?? null,
      ...extra,
    };
  }

  return {
    name,
    /** Current state without triggering a fetch. */
    peek() {
      if (!isConfigured()) return { source: name, status: 'unconfigured', data: null, updatedAt: null, error: null };
      if (cache) return envelope(lastError ? 'stale' : 'ok');
      if (inflight) return envelope('loading', { error: null });
      return envelope('error', { error: lastError?.message ?? 'No data yet' });
    },
    async get() {
      try {
        if (!isConfigured()) return { source: name, status: 'unconfigured', data: null, updatedAt: null, error: null };
        // version() changing (e.g. the feed list was edited) skips the cache.
        const changed = cache && cache.version !== version();
        const fresh = cache && !changed && now() - cache.fetchedAt < ttlFor(cache.data);
        const coolingDown = !changed && lastError && now() - lastError.at < backoffMs;
        if (!fresh && !coolingDown) {
          inflight ??= refresh().finally(() => {
            inflight = null;
          });
          await inflight;
        }
        if (!cache) return envelope('error', { error: lastError?.message ?? 'No data yet' });
        // "ok" as long as the last attempt succeeded; "stale" if it failed and
        // we're showing an older result.
        return envelope(lastError ? 'stale' : 'ok');
      } catch (err) {
        // Should be unreachable, but a dashboard must never 500 because of a source.
        return { source: name, status: 'error', data: cache?.data ?? null, updatedAt: null, error: safeMessage(err) };
      }
    },
  };
}
