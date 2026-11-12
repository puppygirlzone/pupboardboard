// Hamburger menu in the top bar: the theme picker, day/night toggle (and
// settings, where present) live in a tray that slides out to the left of the
// button. Closes on a second click, Escape, or a click anywhere else.

import { trayOpen, trayClose } from './motion.js';

export function initMenu() {
  const button = document.getElementById('menu-toggle');
  const tray = document.getElementById('menu-tray');
  if (!button || !tray) return;
  let open = false;

  async function setOpen(next) {
    if (next === open) return;
    open = next;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    if (open) {
      tray.hidden = false;
      trayOpen(tray);
    } else {
      await trayClose(tray);
      if (!open) tray.hidden = true; // unless it was reopened meanwhile
    }
  }

  button.addEventListener('click', () => setOpen(!open));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      button.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (open && e.target instanceof Node && !tray.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
}
