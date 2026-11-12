// Animated background: a faint dot grid. Every few seconds a ripple spreads
// from a random point, lighting dots up in the theme's accent colours, and
// dots near the pointer glow a little. One <canvas>, and it only redraws
// while something is moving. Paused when the tab is hidden; a still grid
// for reduced motion.

const SPACING = 34; // px between dots
const RIPPLE_SPEED = 300; // px per second
const RIPPLE_BAND = 70; // px: width of the lit ring
const RIPPLE_EVERY = [5000, 7500]; // ms between ripples (min, max)
const POINTER_REACH = 130; // px
const POINTER_LINGER = 900; // ms of glow after the pointer stops

/* ------------------------------------------------------------ pure maths */

/** Dot positions covering w×h, centred so the margins are even. */
export function gridPoints(width, height, spacing = SPACING) {
  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const cols = Math.floor(w / spacing) + 1;
  const rows = Math.floor(h / spacing) + 1;
  const ox = (w - (cols - 1) * spacing) / 2;
  const oy = (h - (rows - 1) * spacing) / 2;
  const points = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) points.push({ x: ox + c * spacing, y: oy + r * spacing });
  return points;
}

/** 0..1: how lit a dot at `dist` is by a ring of radius `radius`. */
export function rippleBoost(dist, radius, band = RIPPLE_BAND) {
  const d = Math.abs(dist - radius);
  if (d >= band) return 0;
  const t = 1 - d / band;
  return t * t;
}

/** 0..1: glow near the pointer. */
export function pointerBoost(dist, reach = POINTER_REACH) {
  if (dist >= reach) return 0;
  const t = 1 - dist / reach;
  return t * t;
}

/** "#rrggbb" (or "#rgb") -> [r, g, b]; falls back to grey. */
export function hexToRgb(value) {
  const v = String(value ?? '').trim().replace('#', '');
  const full = v.length === 3 ? [...v].map((c) => c + c).join('') : v;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [128, 128, 128];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** How long a ripple lives: until its ring has left the screen. */
export const rippleLife = (width, height) => (Math.hypot(width, height) + RIPPLE_BAND) / RIPPLE_SPEED * 1000;

/* ------------------------------------------------------------ drawing */

export function startBackdrop(canvas) {
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const html = document.documentElement;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  let width = 0;
  let height = 0;
  let points = [];
  let colors = null;
  let ripples = [];
  let pointer = null; // { x, y, at }
  let frame = 0;
  let rippleTimer = 0;
  let accentTurn = 0;

  const still = () => reduced?.matches ?? false;

  function readColors() {
    const css = getComputedStyle(html);
    const get = (name) => hexToRgb(css.getPropertyValue(name));
    colors = {
      dot: get('--muted'),
      accents: ['--steam', '--music', '--media', '--news'].map(get),
      baseAlpha: html.dataset.mode === 'light' ? 0.22 : 0.15,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The canvas's own size (excludes the scrollbar), so dots aren't
    // squashed and the pointer glow lines up.
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    points = gridPoints(width, height);
  }

  function draw(now) {
    ctx.clearRect(0, 0, width, height);
    const [dr, dg, db] = colors.dot;
    ripples = ripples.filter((r) => now - r.start < r.life);
    const pointerFade = pointer ? Math.max(0, 1 - (now - pointer.at) / POINTER_LINGER) : 0;

    // Plain dots in one batch; lit dots individually.
    ctx.fillStyle = `rgba(${dr},${dg},${db},${colors.baseAlpha})`;
    ctx.beginPath();
    const lit = [];
    for (const p of points) {
      let boost = 0;
      let color = null;
      for (const r of ripples) {
        const age = (now - r.start) / r.life;
        const b = rippleBoost(Math.hypot(p.x - r.x, p.y - r.y), (now - r.start) / 1000 * RIPPLE_SPEED) * (1 - age);
        if (b > boost) {
          boost = b;
          color = r.color;
        }
      }
      if (pointerFade > 0) {
        const b = pointerBoost(Math.hypot(p.x - pointer.x, p.y - pointer.y)) * pointerFade * 0.8;
        if (b > boost) {
          boost = b;
          color = colors.accents[0];
        }
      }
      if (boost > 0.02) lit.push([p, boost, color]);
      else {
        ctx.moveTo(p.x + 1.3, p.y);
        ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    for (const [p, boost, [r, g, b]] of lit) {
      ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, colors.baseAlpha + boost * 0.6)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.3 + boost * 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
    return ripples.length > 0 || pointerFade > 0;
  }

  // Animation loop that stops itself when nothing is moving.
  function loop(now) {
    frame = 0;
    if (draw(now) && !document.hidden) frame = requestAnimationFrame(loop);
  }
  const wake = () => {
    if (!frame && !document.hidden) frame = requestAnimationFrame(loop);
  };

  function addRipple() {
    if (document.hidden || still()) return;
    ripples.push({
      x: width * (0.15 + Math.random() * 0.7),
      y: height * (0.15 + Math.random() * 0.7),
      start: performance.now(),
      life: rippleLife(width, height),
      color: colors.accents[accentTurn++ % colors.accents.length],
    });
    wake();
  }
  function scheduleRipples(firstDelay) {
    clearTimeout(rippleTimer);
    if (still()) return;
    const next = (delay) => {
      rippleTimer = setTimeout(() => {
        addRipple();
        next(RIPPLE_EVERY[0] + Math.random() * (RIPPLE_EVERY[1] - RIPPLE_EVERY[0]));
      }, delay);
    };
    next(firstDelay);
  }

  function redrawStill() {
    if (!frame) draw(performance.now());
  }

  readColors();
  resize();
  redrawStill();
  scheduleRipples(1200);

  // Watch the canvas itself: a scrollbar appearing (page content loading)
  // changes its width without a window resize event.
  const onResize = () => {
    resize();
    redrawStill();
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(canvas);
  else window.addEventListener('resize', onResize);
  window.addEventListener(
    'pointermove',
    (e) => {
      if (still()) return;
      pointer = { x: e.clientX, y: e.clientY, at: performance.now() };
      wake();
    },
    { passive: true },
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(rippleTimer);
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      redrawStill();
      scheduleRipples(800);
    }
  });
  // Theme, day/night or puppy mode changed: pick up the new colours.
  new MutationObserver(() => {
    readColors();
    redrawStill();
  }).observe(html, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-puppy'] });
  reduced?.addEventListener?.('change', () => {
    ripples = [];
    redrawStill();
    scheduleRipples(1200);
  });
}
