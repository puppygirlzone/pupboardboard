// Small helpers shared by the sources.

/**
 * Image URLs from upstreams: only https (shown straight from the provider's
 * CDN, which the CSP allows). Demo mode also allows its own placeholder art.
 */
export function safeImage(url, { demo = false } = {}) {
  if (typeof url !== 'string' || url.length > 2000) return null;
  if (demo && /^\/api\/demo-art\/[A-Za-z0-9_-]{1,80}(\?[\w=&]*)?$/.test(url)) return url;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** http(s) links only (rendered as links by the views). */
export function safeHttpLink(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

export const DAY = 86_400_000;
