// Runs before the page is drawn so the saved theme shows with no flash.
// Plain script (not a module) so it blocks rendering. Keys match js/themes.js.
(function () {
  var theme = 'default';
  var mode = null;
  var puppy = null;
  try {
    theme = localStorage.getItem('pupboard:theme') || theme;
    mode = localStorage.getItem('pupboard:mode');
    puppy = localStorage.getItem('pupboard:puppy');
  } catch (e) {
    /* storage blocked: use defaults */
  }
  if (mode !== 'dark' && mode !== 'light') {
    mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-mode', mode);
  if (puppy === 'on') document.documentElement.setAttribute('data-puppy', 'on');
})();
