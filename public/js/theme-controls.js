// Theme dropdown and day/night toggle. theme-boot.js already applied the saved
// choice before first paint; this wires up the controls and saves changes.

import { THEMES, STORAGE_KEYS, normalizeTheme, normalizeMode, otherMode } from './themes.js';
import { spin } from './motion.js';

const root = document.documentElement;

const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the choice just won't persist */
  }
};

let switchTimer;
function withTransition(change) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    root.classList.add('theme-switching');
    clearTimeout(switchTimer);
    switchTimer = setTimeout(() => root.classList.remove('theme-switching'), 500);
  }
  change();
}

export function initThemeControls() {
  const select = document.getElementById('theme-select');
  const toggle = document.getElementById('mode-toggle');
  if (!select || !toggle) return;

  // Re-check what boot applied (an unknown saved id falls back to default).
  root.dataset.theme = normalizeTheme(root.dataset.theme);
  root.dataset.mode = normalizeMode(root.dataset.mode);

  select.innerHTML = '';
  for (const t of THEMES) select.add(new Option(t.name, t.id));
  select.value = root.dataset.theme;

  const labelToggle = () => {
    const label = root.dataset.mode === 'dark' ? 'Switch to day mode' : 'Switch to night mode';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };
  labelToggle();

  select.addEventListener('change', () => {
    const theme = normalizeTheme(select.value);
    withTransition(() => {
      root.dataset.theme = theme;
    });
    write(STORAGE_KEYS.theme, theme);
  });

  toggle.addEventListener('click', () => {
    spin(toggle);
    const mode = otherMode(root.dataset.mode);
    withTransition(() => {
      root.dataset.mode = mode;
    });
    write(STORAGE_KEYS.mode, mode);
    labelToggle();
  });

  // Until you pick day/night yourself, follow the system setting live.
  window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', (e) => {
    if (read(STORAGE_KEYS.mode)) return;
    withTransition(() => {
      root.dataset.mode = e.matches ? 'light' : 'dark';
    });
    labelToggle();
  });
}
