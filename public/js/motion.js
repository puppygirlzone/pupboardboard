// All animation lives here, using anime.js v4 (served locally from /vendor).
// Rule: every effect must leave the page in its correct final state if
// anime.js fails to load or the user prefers reduced motion.

let anime = null;
let active = [];

const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const canAnimate = () => Boolean(anime) && !prefersReduced();

/** Load anime.js once. Gives up after `timeoutMs` so the page never waits on it. */
export async function preload(timeoutMs = 1500) {
  if (anime || prefersReduced()) return anime;
  try {
    anime = await Promise.race([import('/vendor/anime.esm.min.js'), new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
  } catch (err) {
    console.warn('[motion] anime.js unavailable, animations off', err);
    anime = null;
  }
  return anime;
}

/** Run an animation without ever throwing; returns it (or null). */
function run(targets, params, track = true) {
  if (!canAnimate()) return null;
  try {
    const a = anime.animate(targets, params);
    if (track) active.push(a);
    return a;
  } catch (err) {
    console.warn('[motion] animation skipped', err);
    return null;
  }
}

function stopAll() {
  for (const a of active) {
    try {
      a.pause();
    } catch {
      /* already finished */
    }
  }
  active = [];
}

const formatCount = (el, value) => `${value.toFixed(Number(el.dataset.decimals) || 0)}${el.dataset.suffix ?? ''}`;

/** The correct end state, applied first so nothing depends on animations. */
function finalState(root) {
  root.style.opacity = '';
  root.style.transform = '';
  root.querySelectorAll('[data-bar]').forEach((b) => {
    b.style.transform = `scaleX(${b.dataset.bar})`;
  });
}

/* ---------------------------------------------------------------- entrance */

const FLIP = '.poster, .tile, .media-card, .game';
const SLIDE = '.feed-item, .legend-item';

/** Big entrance: staggered fades, flipping posters, growing bars, counting numbers, spinning donuts. */
export function enter(root) {
  stopAll();
  finalState(root);
  if (!canAnimate()) return;
  const { stagger } = anime;

  // Only animate what's likely on screen; the rest just appears.
  const all = [...root.querySelectorAll('[data-anim]')].slice(0, 60);
  const flips = all.filter((el) => el.matches(FLIP));
  const slides = all.filter((el) => el.matches(SLIDE));
  const plain = all.filter((el) => !el.matches(FLIP) && !el.matches(SLIDE));

  run(plain, { opacity: [0, 1], translateY: [16, 0], duration: 650, delay: stagger(40), ease: 'outExpo' });

  // Posters, covers and game cards flip up from below, rippling out from the middle.
  if (flips.length) {
    run(flips, {
      opacity: [0, 1],
      rotateX: [-65, 0],
      translateY: [24, 0],
      scale: [0.92, 1],
      duration: 900,
      delay: stagger(55, { from: 'center', start: 180 }),
      ease: 'outBack(1.3)',
    });
  }

  // News items and legend rows slide in from the left.
  if (slides.length) {
    run(slides, { opacity: [0, 1], translateX: [-18, 0], duration: 600, delay: stagger(35, { start: 220 }), ease: 'outQuart' });
  }

  root.querySelectorAll('[data-bar]').forEach((b, i) => {
    run(b, { scaleX: [0, Number(b.dataset.bar) || 0], duration: 900, delay: 250 + Math.min(i, 12) * 50, ease: 'outQuart' });
  });

  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    const state = { value: 0 };
    el.textContent = formatCount(el, 0);
    const a = run(state, {
      value: target,
      duration: 1100,
      delay: 200,
      ease: 'outExpo',
      onUpdate: () => {
        el.textContent = formatCount(el, state.value);
      },
      onComplete: () => {
        el.textContent = formatCount(el, target);
      },
    });
    if (!a) el.textContent = formatCount(el, target);
  });

  root.querySelectorAll('.donut').forEach(spinDonut);
}

/** Donut: one full spin while each slice grows into place, one after another. */
function spinDonut(svg) {
  run(svg, { rotate: [-360, 0], scale: [0.55, 1], opacity: [0, 1], duration: 1500, ease: 'outExpo' });
  svg.querySelectorAll('.donut-seg').forEach((seg, i) => {
    const pct = Number(seg.dataset.pct) || 0;
    const state = { v: 0 };
    const set = (v) => seg.setAttribute('stroke-dasharray', `${v.toFixed(3)} ${(100 - v).toFixed(3)}`);
    set(0);
    const a = run(state, { v: pct, duration: 900, delay: 250 + i * 140, ease: 'outQuart', onUpdate: () => set(state.v), onComplete: () => set(pct) });
    if (!a) set(pct);
  });
}

/** Gentle update after a background refresh (no big entrance). */
export function refresh(root) {
  stopAll();
  finalState(root);
  run(root, { opacity: [0.65, 1], duration: 400, ease: 'outQuad' });
}

/** Quick fade-out before switching pages. Resolves when done (or at once). */
export function leave(root) {
  return new Promise((resolve) => {
    if (!canAnimate()) return resolve();
    stopAll();
    const done = () => resolve();
    const a = run(root, { opacity: [1, 0], translateY: [0, -10], duration: 170, ease: 'inQuad', onComplete: done });
    if (!a) return resolve();
    setTimeout(done, 400); // safety net if onComplete never fires
  });
}

/* ------------------------------------------------------------- small touches */

/** Little "tick" on the refresh indicator. */
export function pulse(el) {
  if (el) run(el, { scale: [1, 1.8, 1], duration: 700, ease: 'outElastic(1, .6)' }, false);
}

/** Spin (used by the day/night button). */
export function spin(el) {
  if (el) run(el, { rotate: [0, 360], scale: [1, 0.85, 1], duration: 700, ease: 'outBack(1.4)' }, false);
}

/** Slide the nav highlight under the active link. */
export function moveNavIndicator(nav, { instant = false } = {}) {
  const pill = nav?.querySelector('.nav-indicator');
  const link = nav?.querySelector('a.active');
  if (!pill) return;
  if (!link) {
    pill.style.opacity = '0';
    return;
  }
  const x = link.offsetLeft;
  const w = link.offsetWidth;
  const first = !pill.dataset.placed;
  pill.dataset.placed = '1';
  pill.style.opacity = '1';
  if (instant || first || !canAnimate()) {
    pill.style.transform = `translateX(${x}px)`;
    pill.style.width = `${w}px`;
    return;
  }
  run(pill, { translateX: x, width: w, duration: 650, ease: 'outElastic(1, .75)' }, false);
}

/** Card icons wiggle when the pointer enters a card (one listener for the whole page). */
export function initHoverEffects() {
  let current = null;
  document.addEventListener('pointerover', (e) => {
    const card = e.target instanceof Element ? e.target.closest('.card') : null;
    if (card === current) return;
    current = card;
    const icon = card?.querySelector('.card-title .icon');
    if (icon) run(icon, { rotate: [0, -14, 10, -5, 0], scale: [1, 1.18, 1], duration: 750, ease: 'outQuad' }, false);
  });
}

/* ------------------------------------------------------------- puppy mode */

/** Paw prints burst out from an element and fade (only when animating). */
export function pawBurst(fromEl, pawSvg, count = 14) {
  if (!canAnimate() || !fromEl?.getBoundingClientRect) return;
  const box = fromEl.getBoundingClientRect();
  const cx = box.left + Math.min(box.width, 220) / 2;
  const cy = box.top + box.height / 2;
  for (let i = 0; i < count; i++) {
    const paw = document.createElement('div');
    paw.className = 'paw-burst';
    paw.innerHTML = pawSvg;
    paw.style.left = `${cx - 11}px`;
    paw.style.top = `${cy - 11}px`;
    document.body.append(paw);
    // Spread evenly around a circle, alternating near and far.
    const angle = (i / count) * Math.PI * 2;
    const dist = 90 + (i % 3) * 45;
    const a = run(
      paw,
      {
        translateX: [0, Math.cos(angle) * dist],
        translateY: [0, Math.sin(angle) * dist + 30],
        rotate: [0, (i % 2 ? 1 : -1) * (40 + i * 7)],
        scale: [0.3, 1.15, 0.8],
        opacity: [1, 1, 0],
        duration: 1300,
        delay: i * 18,
        ease: 'outExpo',
        onComplete: () => paw.remove(),
      },
      false,
    );
    if (!a) paw.remove();
    else setTimeout(() => paw.remove(), 2000); // safety net
  }
}

/** Toast slides up into view (it is already visible without animation). */
export function toastIn(el) {
  run(el, { opacity: [0, 1], translateY: [16, 0], scale: [0.9, 1], duration: 500, ease: 'outBack(1.6)' }, false);
}

/** Toast slides away; resolves when gone (immediately without animation). */
export function toastOut(el) {
  return new Promise((resolve) => {
    const a = run(el, { opacity: [1, 0], translateY: [0, 10], duration: 300, ease: 'inQuad', onComplete: resolve }, false);
    if (!a) resolve();
    else setTimeout(resolve, 600);
  });
}
