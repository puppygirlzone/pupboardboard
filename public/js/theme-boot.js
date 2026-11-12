// Runs before the page is drawn so the saved theme shows with no flash.
// Plain script (not a module) so it blocks rendering. Keys match js/themes.js.
(function () {
  var theme = 'default';
  var mode = null;
  var puppy = null;
  var egg = null;
  try {
    theme = localStorage.getItem('pupboard:theme') || theme;
    mode = localStorage.getItem('pupboard:mode');
    puppy = localStorage.getItem('pupboard:puppy');
    egg = localStorage.getItem('pupboard:egg');
  } catch (e) {
    /* storage blocked: use defaults */
  }
  if (mode !== 'dark' && mode !== 'light') {
    mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-mode', mode);
  if (!egg && puppy === 'on') egg = 'puppy';
  if (egg === 'puppy') document.documentElement.setAttribute('data-puppy', 'on');
  // Other easter eggs (see js/eggs.js); unknown values are ignored.
  if (/^(puppy|aiko|cheese|luna|bird)$/.test(egg || '')) {
    document.documentElement.setAttribute('data-egg', egg);
    if (egg === 'aiko') document.documentElement.setAttribute('lang', 'ja');
  }
})();
