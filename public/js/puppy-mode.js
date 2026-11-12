// Easter eggs: wiring (DOM). theme-boot.js applies a saved mode before first
// paint; this handles the triggers (typing a word anywhere, or tapping the
// greeting 5 times and typing it into the box), the floaters, the burst and
// the toast, and the Japanese wording in Aiko mode.

import { PUPPY_KEY, createTapCounter } from './puppy.js';
import { EGGS, EGG_KEY, ICONS, validEgg, eggForWord, eggToast, createWordDetector, floaterIcons } from './eggs.js';
import { translate } from './i18n-ja.js';
import { pawBurst, toastIn, toastOut } from './motion.js';

const root = document.documentElement;
export const activeEgg = () => validEgg(root.dataset.egg ?? (root.dataset.puppy === 'on' ? 'puppy' : null));
export const isPuppy = () => activeEgg() === 'puppy';

function save(name) {
  try {
    if (name) localStorage.setItem(EGG_KEY, name);
    else localStorage.removeItem(EGG_KEY);
    if (name === 'puppy') localStorage.setItem(PUPPY_KEY, 'on');
    else localStorage.removeItem(PUPPY_KEY);
  } catch {
    /* storage blocked: just won't be remembered */
  }
}

/* ------------------------------------------------------------ floaters */

const SPOTS = [
  [6, 18, -20], [18, 72, 15], [31, 34, -8], [44, 86, 25], [57, 12, 10], [69, 58, -25],
  [82, 26, 20], [91, 80, -12], [12, 48, 30], [38, 62, -30], [63, 92, 5], [76, 44, -15],
];

/** Scatter the mode's icons across the background (fixed spots). */
function fillFloaters(name) {
  const box = document.querySelector('.paws');
  if (!box) return;
  box.replaceChildren();
  floaterIcons(name).forEach((icon, i) => {
    const holder = document.createElement('div');
    holder.innerHTML = ICONS[icon]; // fixed, trusted SVG strings
    const svg = holder.firstElementChild;
    const [x, y, r] = SPOTS[i];
    svg.classList.add('floater', `floater-${icon}`);
    // Position via CSSOM (the CSP blocks inline style attributes).
    svg.style.left = `${x}%`;
    svg.style.top = `${y}%`;
    svg.style.rotate = `${r}deg`;
    svg.style.animationDelay = `${-i * 2.3}s`;
    box.append(svg);
  });
}

/* ------------------------------------------------------------ Japanese (Aiko) */

const originals = new WeakMap(); // text node -> its English text
const shown = new WeakMap(); // text node -> the Japanese we put there
const ATTRS = ['aria-label', 'title', 'placeholder'];
const attrOriginals = new WeakMap(); // element -> { attr: English }
let observer = null;

const skip = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || Boolean(el.closest('script, style, code, select, .egg-prompt'));
};

function translateText(node) {
  if (skip(node)) return;
  const value = node.nodeValue;
  if (shown.get(node) === value) return; // ours
  const ja = translate(value);
  originals.set(node, value);
  if (ja !== value) {
    shown.set(node, ja);
    node.nodeValue = ja;
  }
}

function translateAttrs(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null) continue;
    const saved = attrOriginals.get(el) ?? {};
    if (saved[`ja:${a}`] === v) continue;
    const ja = translate(v);
    if (ja === v) continue;
    saved[a] = v;
    saved[`ja:${a}`] = ja;
    attrOriginals.set(el, saved);
    el.setAttribute(a, ja);
  }
}

function translateTree(node) {
  if (node.nodeType === 3) return translateText(node);
  if (node.nodeType !== 1) return;
  translateAttrs(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) translateText(n);
    else translateAttrs(n);
  }
}

function startJapanese() {
  if (observer) return;
  translateTree(document.body);
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateText(r.target);
      else if (r.type === 'attributes') translateAttrs(r.target);
      else r.addedNodes.forEach(translateTree);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

function stopJapanese() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3 && originals.has(n) && shown.get(n) === n.nodeValue) n.nodeValue = originals.get(n);
    if (n.nodeType === 1 && attrOriginals.has(n)) for (const a of ATTRS) if (attrOriginals.get(n)[a] != null) n.setAttribute(a, attrOriginals.get(n)[a]);
  }
}

/* ------------------------------------------------------------ toast */

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

/* ------------------------------------------------------------ the secret-word box */

function openPrompt(onWord) {
  const hello = document.querySelector('.hello');
  if (!hello) return;
  const existing = hello.querySelector('.egg-prompt');
  if (existing) return existing.querySelector('input')?.focus();
  const form = document.createElement('form');
  form.className = 'egg-prompt';
  form.autocomplete = 'off';
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', placeholder: 'Secret word…', spellcheck: false, autocapitalize: 'none', enterKeyHint: 'go' });
  input.setAttribute('aria-label', 'Secret word');
  input.setAttribute('autocorrect', 'off');
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.textContent = 'OK';
  form.append(input, ok);
  const close = () => form.remove();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const word = input.value;
    close();
    onWord(word);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  form.addEventListener('focusout', (e) => {
    if (!form.contains(e.relatedTarget)) setTimeout(close, 150);
  });
  hello.append(form);
  input.focus();
}

/* ------------------------------------------------------------ setup */

/** onChange(name|null) lets the app refresh the greeting and other wording. */
export function initEggs({ onChange = () => {} } = {}) {
  const greeting = document.querySelector('.greeting');

  function apply(name, { announce = false } = {}) {
    const previous = activeEgg();
    if (name) root.dataset.egg = name;
    else delete root.dataset.egg;
    if (name === 'puppy') root.dataset.puppy = 'on';
    else delete root.dataset.puppy;
    root.lang = EGGS[name]?.lang ?? 'en';
    fillFloaters(name);
    if (EGGS[name]?.lang === 'ja') startJapanese();
    else stopJapanese();
    if (!announce) return;
    save(name);
    onChange(name);
    if (name) {
      pawBurst(greeting ?? document.body, ICONS[EGGS[name].icon]);
      toast(eggToast(name, true));
    } else if (previous) {
      toast(eggToast(previous, false));
    }
  }

  // Whatever theme-boot.js restored.
  apply(activeEgg());

  const toggle = (name) => apply(activeEgg() === name ? null : name, { announce: true });

  const typed = createWordDetector();
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    const hit = typed(e.key);
    if (hit) toggle(hit);
  });

  // Phones have no keyboard to type on: 5 quick taps on the greeting open a box.
  const tapped = createTapCounter(5, 2000);
  greeting?.addEventListener('click', () => {
    if (!tapped()) return;
    openPrompt((word) => {
      const name = eggForWord(word);
      if (name) toggle(name);
      else if (word.trim()) toast(activeEgg() === 'aiko' ? '何も起きなかった…' : 'Nothing happened… try another word');
    });
  });
}

// Older name, still used by app.js.
export const initPuppyMode = initEggs;
