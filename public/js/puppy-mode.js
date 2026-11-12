// Puppy mode easter egg: wiring (DOM). theme-boot.js applies a saved
// "on" before first paint; this handles the secret triggers and effects.

import { PUPPY_KEY, PAW_SVG, createSequenceDetector, createTapCounter } from './puppy.js';
import { pawBurst, toastIn, toastOut } from './motion.js';

const root = document.documentElement;
export const isPuppy = () => root.dataset.puppy === 'on';

function save(on) {
  try {
    if (on) localStorage.setItem(PUPPY_KEY, 'on');
    else localStorage.removeItem(PUPPY_KEY);
  } catch {
    /* storage blocked: just won't be remembered */
  }
}

/** Scatter paw prints across the background (fixed layout, no randomness). */
function fillPaws() {
  const paws = document.querySelector('.paws');
  if (!paws || paws.childElementCount) return;
  const spots = [
    [6, 18, -20], [18, 72, 15], [31, 34, -8], [44, 86, 25], [57, 12, 10], [69, 58, -25],
    [82, 26, 20], [91, 80, -12], [12, 48, 30], [38, 62, -30], [63, 92, 5], [76, 44, -15],
  ];
  paws.innerHTML = spots
    .map(([x, y, r], i) => PAW_SVG.replace('<svg ', `<svg data-spot="${x},${y},${r},${i}" `))
    .join('');
  // Position via CSSOM (the CSP blocks inline style attributes).
  [...paws.children].forEach((svg) => {
    const [x, y, r, i] = svg.dataset.spot.split(',').map(Number);
    svg.style.left = `${x}%`;
    svg.style.top = `${y}%`;
    svg.style.rotate = `${r}deg`;
    svg.style.animationDelay = `${-i * 2.3}s`;
  });
}

let toastTimer;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  toastIn(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastOut(el).then(() => el.remove()), 2600);
}

/** onChange(isOn) lets the app refresh the greeting and other wording. */
export function initPuppyMode({ onChange = () => {} } = {}) {
  fillPaws();
  const greeting = document.querySelector('.greeting');

  const set = (on) => {
    if (on) root.dataset.puppy = 'on';
    else delete root.dataset.puppy;
    save(on);
    onChange(on);
    if (on) {
      pawBurst(greeting ?? document.body, PAW_SVG);
      toast('Puppy mode on! Type woof again to turn it off');
    } else {
      toast('Puppy mode off');
    }
  };
  const toggle = () => set(!isPuppy());

  const typed = createSequenceDetector();
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (typed(e.key)) toggle();
  });

  const tapped = createTapCounter(5, 2000);
  greeting?.addEventListener('click', () => {
    if (tapped()) toggle();
  });
}
