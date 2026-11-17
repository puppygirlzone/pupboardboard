// Keeps pictures ready so page switches and refreshes don't flash empty
// boxes. Every page draw makes new <img> tags; holding a decoded copy of
// each picture in memory lets the browser paint them straight away.

/** Picture URLs (http/https images, or pupboard's own /api/img and /api/demo-art links) found in the Steam part of a summary, deduped, at most `max`. */
export function steamImageUrls(summary, max = 80) {
  const urls = new Set();
  const walk = (v, depth) => {
    if (urls.size >= max || depth > 6 || v == null) return;
    if (typeof v === 'string') {
      const web = /^https?:\/\/[^\s"'<>]+$/i.test(v) && /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(v);
      const ours = /^\/api\/(?:img|demo-art)\/[^\s"'<>]+$/.test(v); // pupboard's own picture links
      if (web || ours) urls.add(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(summary?.steam?.data, 0);
  return [...urls];
}

/**
 * Holds up to `max` pictures in memory (oldest dropped first). `make` builds
 * an image object (new Image() in the browser; injectable for tests).
 */
export function createImageWarmer({ make = () => new Image(), max = 300 } = {}) {
  const held = new Map();
  return {
    warm(urls) {
      for (const src of urls ?? []) {
        if (!src || held.has(src)) continue;
        try {
          const img = make();
          img.decoding = 'async';
          img.src = src;
          img.decode?.().catch(() => {}); // a failed picture just isn't held ready
          held.set(src, img);
        } catch {
          /* no Image support: nothing to warm */
        }
        if (held.size > max) held.delete(held.keys().next().value);
      }
    },
    has: (src) => held.has(src),
    get size() {
      return held.size;
    },
  };
}
