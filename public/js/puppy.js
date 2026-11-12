// Puppy mode data and small helpers shared by the easter eggs (see eggs.js).

import { zonedParts } from './format.js';

export const PUPPY_KEY = 'pupboard:puppy';

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
