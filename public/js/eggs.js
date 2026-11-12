// Easter eggs: secret words that restyle the dashboard. Pure (no DOM), shared
// by the page and the tests. Puppy mode is one of them (see puppy.js).
//
// Type a word anywhere (or tap the greeting 5 times and type it in the box)
// to switch that mode on; type it again to switch it off. One mode at a time.

import { zonedParts } from './format.js';
import { PUPPY_KEY, PUPPY_GREETINGS, PAW_SVG, timeSlot } from './puppy.js';

/** Where the active mode is remembered (same prefix as the puppy key). */
export const EGG_KEY = PUPPY_KEY.replace(/puppy$/, 'egg');

/* ------------------------------------------------------------ icons */
// Plain shapes; colour comes from CSS (fill: currentColor / --music), except
// the flag, which carries its own colours.

export const ICONS = {
  paw: PAW_SVG,
  gun: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 7.5h17.5l1.5-1.5h1v4h-2l-.6 1.2H13l-1.1 1.6h-2.2l-.4-1.6H8.3L6.6 18.6a1 1 0 0 1-.95.7H3.2a.7.7 0 0 1-.66-.93L4.7 11.2H2.6A.6.6 0 0 1 2 10.6Z"/><path d="M10 11.2h1.6l.4 1.6h-1.6Z" opacity=".6"/></svg>',
  cheese: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M2 15.5 15.2 5.2c3 .6 5.6 2.6 6.8 5.3V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Zm5.5 1.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7-3.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm3.6 4.6a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Zm-6.4 1.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 2.5A9.5 9.5 0 1 0 21.5 17 7.6 7.6 0 0 1 15.5 2.5Z"/><circle cx="19" cy="5" r="1"/><circle cx="21.5" cy="9.5" r=".6"/></svg>',
  // Union flag: public domain design, simplified.
  flag: '<svg viewBox="0 0 30 18" aria-hidden="true"><rect width="30" height="18" fill="#012169"/><path d="M0 0 30 18M30 0 0 18" stroke="#fff" stroke-width="3.6"/><path d="M0 0 30 18M30 0 0 18" stroke="#c8102e" stroke-width="1.2"/><path d="M15 0v18M0 9h30" stroke="#fff" stroke-width="6"/><path d="M15 0v18M0 9h30" stroke="#c8102e" stroke-width="3.6"/></svg>',
  // Protogen head: the visor with LED eyes, and an ear fin.
  visor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5 8 2l1.2 3.4A9 9 0 0 1 21 12.6V16a4 4 0 0 1-4 4H8.5A6.5 6.5 0 0 1 2 13.5V12a7.6 7.6 0 0 1 3-6.1Z"/><path class="visor-glass" d="M6.5 10.5h12a1.5 1.5 0 0 1 1.5 1.5v2.5a2.5 2.5 0 0 1-2.5 2.5h-9A3.5 3.5 0 0 1 5 13.5V12a1.5 1.5 0 0 1 1.5-1.5Z"/><path class="visor-led" d="M8 12.2h2.2v1.3H8Zm7.6 0h2.2v1.3h-2.2Zm-4.3 2.4h3.2v.9h-3.2Z"/></svg>',
};

/* ------------------------------------------------------------ the modes */

export const EGGS = {
  puppy: {
    words: ['woof'],
    name: 'Puppy mode',
    icon: 'paw',
    greetings: PUPPY_GREETINGS,
    verb: 'Fetched',
  },
  aiko: {
    words: ['aiko'],
    name: 'アイコモード',
    icon: 'gun',
    lang: 'ja',
    greetings: {
      night: ['夜更かしですね、アイコ', 'まだ起きてるの？', '静かな夜ですね'],
      morning: ['おはよう、アイコ！', 'おはようございます！', '今日もがんばろう！'],
      afternoon: ['こんにちは、アイコ！', 'お昼ですよ！', 'いい午後を！'],
      evening: ['こんばんは、アイコ！', 'お疲れさまでした！', 'ゆっくり休んでね'],
    },
    verb: '更新',
    on: 'アイコモード オン！もう一度 aiko と入力するとオフ',
    off: 'アイコモード オフ',
  },
  cheese: {
    words: ['cheese'],
    name: 'Cheese mode',
    icon: 'cheese',
    greetings: {
      night: ["Brie quiet, it's late", 'Sweet dreams, brie-loved', 'Up late? Brie careful'],
      morning: ['Rise and brie!', 'Brie-akfast time!', "Good morning, you brie-lliant thing"],
      afternoon: ['Feeling brie-zy?', 'Let it brie', "You're looking grate today"],
      evening: ['Brie-lax, it’s evening', 'Unwind and brie yourself', 'Time to brie cosy'],
    },
    verb: 'Grated',
  },
  luna: {
    words: ['luna'],
    name: 'Luna mode',
    icon: 'moon',
    rare: { icon: 'flag', chance: 0.25 }, // now and then, one moon is a Union flag
    greetings: {
      night: ['The moon is up, good girl', 'Moonlit and lovely, good girl', 'Sleep softly, good girl'],
      morning: ['Good morning, good girl', 'Rise gently, good girl', 'The moon says hi, good girl'],
      afternoon: ['Good afternoon, good girl', 'Shine on, good girl', 'Still glowing, good girl'],
      evening: ['Good evening, good girl', 'Moonrise soon, good girl', 'Rest well tonight, good girl'],
    },
    verb: 'Updated',
  },
  bird: {
    words: ['bird', 'clanker'],
    name: 'Clanker mode',
    icon: 'visor',
    greetings: {
      night: ['Low-power mode, good boy?', 'Visor dimmed, good boy', 'Late-night firmware update?'],
      morning: ['Booting up, good boy! Beep!', 'Morning, good boy. Systems nominal', 'Visor on, good boy!'],
      afternoon: ['Good boy! Fans spinning nicely', 'Afternoon, good boy. Beep boop', 'Good boy! LEDs looking bright'],
      evening: ['Evening, good boy. Time to recharge?', 'Good boy! Running cool tonight', 'Cool your circuits, good boy'],
    },
    verb: 'Synced',
  },
};

export const EGG_NAMES = Object.keys(EGGS);
const BY_WORD = new Map(EGG_NAMES.flatMap((name) => EGGS[name].words.map((w) => [w, name])));

/** "Luna" -> "luna"; unknown words -> null. */
export function eggForWord(word) {
  return BY_WORD.get(String(word ?? '').trim().toLowerCase()) ?? null;
}

/** A known mode name, or null (old or junk storage values are ignored). */
export const validEgg = (name) => (EGG_NAMES.includes(name) ? name : null);

/** Toast text when a mode is switched on or off. */
export function eggToast(name, on) {
  const egg = EGGS[name];
  if (!egg) return '';
  if (on) return egg.on ?? `${egg.name} on! Type ${egg.words[0]} again to turn it off`;
  return egg.off ?? `${egg.name} off`;
}

/** The mode's greeting: same line all day for a time slot, changes day to day. Null when no mode. */
export function eggGreeting(name, date = new Date(), timeZone = null) {
  const egg = EGGS[name];
  if (!egg) return null;
  const lines = egg.greetings[timeSlot(date, timeZone)];
  const { year, month, day } = zonedParts(date, timeZone);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return lines[((dayNumber % lines.length) + lines.length) % lines.length];
}

/** Word for the "Updated just now" indicator. */
export const eggVerb = (name) => EGGS[name]?.verb ?? 'Updated';

/**
 * Feed it key presses; returns the mode whose word was just typed, else null.
 * Case-insensitive; keys like Shift are ignored.
 */
export function createWordDetector(words = [...BY_WORD.keys()]) {
  const list = words.map((w) => w.toLowerCase());
  const longest = Math.max(...list.map((w) => w.length));
  let progress = '';
  return function press(key) {
    const k = String(key ?? '').toLowerCase();
    if (k.length !== 1) return null;
    progress = (progress + k).slice(-longest);
    const hit = list.find((w) => progress.endsWith(w));
    if (!hit) return null;
    progress = '';
    return BY_WORD.get(hit) ?? hit;
  };
}

/**
 * Background floaters for a mode: 12 fixed spots, each with an icon name.
 * random() decides whether a rare icon (Luna's flag) replaces one of them.
 */
export function floaterIcons(name, random = Math.random) {
  const egg = EGGS[name];
  if (!egg) return [];
  const icons = Array(12).fill(egg.icon);
  if (egg.rare && random() < egg.rare.chance) icons[Math.floor(random() * icons.length) % icons.length] = egg.rare.icon;
  return icons;
}
