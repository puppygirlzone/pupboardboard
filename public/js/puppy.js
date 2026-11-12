// Puppy mode easter egg: pure helpers (no DOM), shared by the page and tests.
// Turn it on by typing "woof" anywhere, or tapping the greeting 5 times.

import { zonedParts } from './format.js';

export const PUPPY_KEY = 'pupboard:puppy';
export const SECRET_WORD = 'woof';

// One list per time of day. A line is picked per day, so it stays put.
export const PUPPY_GREETINGS = {
  night: ['Up past bedtime, pup?', 'Late-night zoomies?', 'Shh, the pack is sleeping'],
  morning: ['Rise and shine, pup!', 'Morning, good girl!', 'Tail-wags and coffee time'],
  afternoon: ['Afternoon, good girl!', 'Ears up, pup!', 'Snack time, puppy?'],
  evening: ['Evening, pup. Walkies?', 'Curl up time, good girl', 'Who’s a sleepy pup?'],
};

export function timeSlot(date = new Date(), timeZone = null) {
  const h = zonedParts(date, timeZone).hour;
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

/** Same line all day for a given time slot; changes day to day. */
export function puppyGreeting(date = new Date(), timeZone = null) {
  const lines = PUPPY_GREETINGS[timeSlot(date, timeZone)];
  const { year, month, day } = zonedParts(date, timeZone);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return lines[((dayNumber % lines.length) + lines.length) % lines.length];
}

/** Puppy wording for the "Updated just now" indicator. */
export const syncVerb = (puppy) => (puppy ? 'Fetched' : 'Updated');

/**
 * Feed it key presses; returns true when the secret word has just been typed.
 * Case-insensitive; any other key resets progress.
 */
export function createSequenceDetector(word = SECRET_WORD) {
  const target = word.toLowerCase();
  let progress = '';
  return function press(key) {
    const k = String(key ?? '').toLowerCase();
    if (k.length !== 1) return false; // Shift, Arrow keys and so on are ignored
    progress = (progress + k).slice(-target.length);
    if (progress === target) {
      progress = '';
      return true;
    }
    return false;
  };
}

/** Counts quick taps; returns true on the Nth tap within the time window. */
export function createTapCounter(needed = 5, windowMs = 2000, now = () => Date.now()) {
  let taps = [];
  return function tap() {
    const t = now();
    taps = taps.filter((x) => t - x < windowMs);
    taps.push(t);
    if (taps.length >= needed) {
      taps = [];
      return true;
    }
    return false;
  };
}

/** Paw print icon (inline SVG; fill comes from CSS). */
export const PAW_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="5.6" cy="9.4" rx="2.2" ry="2.9" transform="rotate(-18 5.6 9.4)"/><ellipse cx="9.6" cy="5.4" rx="2.2" ry="2.9" transform="rotate(-6 9.6 5.4)"/><ellipse cx="14.4" cy="5.4" rx="2.2" ry="2.9" transform="rotate(6 14.4 5.4)"/><ellipse cx="18.4" cy="9.4" rx="2.2" ry="2.9" transform="rotate(18 18.4 9.4)"/><path d="M12 11c-3.2 0-6 3.4-6 6.2 0 1.9 1.5 2.8 3.1 2.8 1.2 0 1.9-.6 2.9-.6s1.7.6 2.9.6c1.6 0 3.1-.9 3.1-2.8 0-2.8-2.8-6.2-6-6.2z"/></svg>';
