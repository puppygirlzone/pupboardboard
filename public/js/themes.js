// Theme list and helpers (pure, no DOM). Colours live in css/themes.css.
// theme-boot.js uses the same storage keys; keep them in sync.

export const STORAGE_KEYS = { theme: 'pupboard:theme', mode: 'pupboard:mode' };

export const THEMES = [
  { id: 'default', name: 'Default' },
  { id: 'whale', name: 'Whale' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'camellia', name: 'Camellia' },
  { id: 'rose-pine', name: 'Rosé Pine' },
];

export const MODES = ['dark', 'light'];

export const normalizeTheme = (id) => (THEMES.some((t) => t.id === id) ? id : 'default');
export const normalizeMode = (mode) => (MODES.includes(mode) ? mode : 'dark');
export const otherMode = (mode) => (normalizeMode(mode) === 'dark' ? 'light' : 'dark');
