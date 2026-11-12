// Pure formatting helpers (no DOM), shared by views and tests.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** 0 -> "0m", 45 -> "45m", 135 -> "2h 15m", 6000 -> "100h" */
export function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h >= 100 || rest === 0) return `${h}h`;
  return `${h}h ${rest}m`;
}

/** Hours with one decimal, as a number (for count-up animations). */
export const toHours = (minutes) => Math.round(((Number(minutes) || 0) / 60) * 10) / 10;

/** 225 -> "3:45" */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 45) return 'just now';
  const units = [
    ['y', 31_536_000],
    ['mo', 2_592_000],
    ['w', 604_800],
    ['d', 86_400],
    ['h', 3_600],
    ['m', 60],
  ];
  for (const [label, secs] of units) {
    if (diff >= secs) return `${Math.floor(diff / secs)}${label} ago`;
  }
  return 'just now';
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/**
 * Calendar day and hour (0-23) in a time zone. timeZone null means the
 * browser's own zone. Works even when the browser hides its real zone,
 * as long as a zone name is given.
 */
export function zonedParts(date = new Date(), timeZone = null) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone ?? undefined,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24 };
}

/** "16:35" (default) or "4:35 PM" with hour12. */
export function formatClock(date = new Date(), { timeZone = null, hour12 = false } = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timeZone ?? undefined,
    hour: '2-digit',
    minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' }),
  }).format(date);
}

/** "Thursday 12 November" style, in the browser's language. */
export function formatLongDate(date = new Date(), { timeZone = null, locale = undefined } = {}) {
  return new Intl.DateTimeFormat(locale, { timeZone: timeZone ?? undefined, weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

export function greeting(date = new Date(), timeZone = null) {
  const h = zonedParts(date, timeZone).hour;
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
