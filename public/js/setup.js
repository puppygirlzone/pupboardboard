// Settings page (/setup.html). Builds the form with DOM calls (textContent,
// never innerHTML), so nothing typed or saved can turn into markup.
//
// Access needs the code from the link pupboard prints when it starts
// (".../setup.html#code=..."). The code is kept in sessionStorage for reloads
// and removed from the address bar straight away.

import { groupSections, withFieldSections, startTab, tabForKey, tabsWithErrors, tabOfKey, TABS } from './setup-tabs.js';

const CODE_KEY = 'pupboard:setup-code';
const TAB_KEY = 'pupboard:setup-tab';
const $ = (sel) => document.querySelector(sel);
const statusBox = $('#setup-status');
const form = $('#setup-form');

// Each section's box; setup-tabs.js says which tab it goes on.
const SECTIONS = [
  {
    id: 'steam',
    title: 'Gaming (Steam)',
    help: [
      'Paste your Steam profile link (open your profile in Steam, right-click the page and copy its address). Steam also needs a free Web API key from ',
      ['steamcommunity.com/dev/apikey', 'https://steamcommunity.com/dev/apikey'],
      ' (for “Domain name” anything works, e.g. localhost). In Steam, set your profile’s “Game details” privacy to Public. Some apps Steam calls games just run in the background (like Soundpad or Bongo Cat); list them under “Don’t count these apps” to keep them out of your hours. Type “none” to count everything.',
    ],
  },
  {
    id: 'music',
    title: 'Music card',
    help: [
      'Which service the Music card shows. “Automatic” uses Navidrome if it is set up, then Spotify direct, then ListenBrainz. ',
      'Turn on “what’s playing on this computer” to also see the song from a music player here (Spotify, VLC, Strawberry, a browser…), with its album art. It works on Linux and Windows when pupboard runs on the same computer as the music, not in Docker.',
    ],
  },
  {
    id: 'listenbrainz',
    title: 'Spotify, the easy way (ListenBrainz)',
    help: [
      'No keys needed. Make a free account at ',
      ['listenbrainz.org', 'https://listenbrainz.org'],
      ', go to Settings → Music services and connect Spotify. Then type your ListenBrainz username here. New plays show up within a few minutes.',
    ],
  },
  {
    id: 'spotify',
    title: 'Spotify, direct (optional)',
    help: [
      'Live “now playing” straight from Spotify. Spotify only allows this with Spotify Premium and your own free developer app: ',
      ['open the Spotify developer dashboard', 'https://developer.spotify.com/dashboard'],
      ', press Create app, give it any name, paste the Redirect URI below, tick “Web API”, and save. Copy the app’s Client ID here, press Save, then Connect Spotify.',
    ],
  },
  {
    id: 'navidrome',
    title: 'Navidrome (your own music server)',
    help: ['For your own music server: the address you open Navidrome at (for example http://192.168.1.10:4533) and your normal Navidrome login.'],
  },
  { id: 'media', title: 'Media card', help: ['Which service the Media card shows. “Automatic” uses Jellyfin if it is set up, then Letterboxd, then game deals.'] },
  { id: 'deals', title: 'Game deals', help: ['Free-to-keep PC games and the best Steam and GOG sales, in your currency, on the Media card. Nothing else to set up.'] },
  { id: 'letterboxd', title: 'Letterboxd films', help: ['Films you log on ', ['letterboxd.com', 'https://letterboxd.com'], '. Just your username (or paste your profile link), no keys.'] },
  {
    id: 'jellyfin',
    title: 'Jellyfin (your own media server)',
    help: ['The address you open Jellyfin at (for example http://192.168.1.10:8096). Make an API key in Jellyfin: Dashboard → API Keys → +.'],
  },
  { id: 'news', title: 'News feeds', help: ['One feed per line, as “Name | https://address-of-the-feed”. Lines starting with # are ignored. Empty = no news card.'] },
  { id: 'clock', title: 'Clock', help: ['Leave the time zone empty to use your browser’s. Set it if the clock shows the wrong time.'] },
  { id: 'network', title: 'Network', help: ['Allow phones and other computers at home to open the dashboard. Takes effect after you restart pupboard.'] },
];

const CHOICE_LABELS = {
  auto: 'Automatic',
  navidrome: 'Navidrome',
  spotify: 'Spotify (direct)',
  listenbrainz: 'Spotify via ListenBrainz',
  jellyfin: 'Jellyfin',
  letterboxd: 'Letterboxd films',
  deals: 'Game deals and free games',
  USD: 'US dollars ($)',
  AUD: 'Australian dollars (A$)',
  GBP: 'British pounds (£)',
  launch: 'Launches the game in Steam',
  store: 'Opens its Steam store page',
  on: 'On',
  off: 'Off',
  '24h': '24-hour (14:30)',
  '12h': '12-hour (2:30 PM)',
  '127.0.0.1': 'Only this computer',
  '0.0.0.0': 'Any device on my home network',
};

const REFUSALS = {
  code: 'This page needs the settings link from the pupboard window (the one that opened when you started pupboard). It looks like http://localhost:8742/setup.html#code=… and changes every time pupboard starts. You can also paste it here:',
  'not-local': 'For safety, settings can only be changed in a browser on the computer that runs pupboard (at http://localhost:…). If pupboard runs in Docker or on a server, edit its .env file instead.',
  disabled: 'The settings page is turned off here (it is off inside Docker, or SETUP_PAGE=0 is set). Edit the .env file instead.',
  demo: 'pupboard is running in demo mode with made-up data, so there is nothing to set up.',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

const helpText = (parts) =>
  el(
    'p',
    { class: 'muted small' },
    parts.map((p) => (Array.isArray(p) ? el('a', { href: p[1], target: '_blank', rel: 'noopener noreferrer', text: p[0] }) : document.createTextNode(p))),
  );

/* ------------------------------------------------------------ the code */

function takeCode() {
  const m = location.hash.match(/code=([0-9a-f]{16,64})/i);
  if (m) {
    try {
      sessionStorage.setItem(CODE_KEY, m[1]);
    } catch {
      /* storage blocked: the code only lasts this page view */
    }
    history.replaceState(null, '', location.pathname);
    return m[1];
  }
  try {
    return sessionStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}
let code = takeCode();

// Back from Spotify's sign-in page (?spotify=connected|denied|error).
const spotifyResult = new URLSearchParams(location.search).get('spotify');
if (spotifyResult) history.replaceState(null, '', location.pathname);
const SPOTIFY_MESSAGES = {
  connected: 'Spotify is connected. The Music card will show it within a minute.',
  denied: 'Spotify sign-in was cancelled.',
  error: 'Spotify sign-in didn’t work. Check the Client ID and Redirect URI in your Spotify app, then try again. If you’re not the app’s owner, add your Spotify email under “User Management” in the app.',
};

const api = (init = {}) => fetch('/api/setup', { cache: 'no-store', ...init, headers: { 'x-setup-code': code, ...(init.headers ?? {}) } });

/* ------------------------------------------------------------ messages */

function showStatus(kind, nodes) {
  statusBox.className = `panel setup-status setup-${kind}`;
  statusBox.replaceChildren(...[].concat(nodes));
}

function codePrompt() {
  const input = el('input', { type: 'text', class: 'setup-input', placeholder: 'http://localhost:8742/setup.html#code=…', 'aria-label': 'Settings link' });
  const button = el('button', { type: 'button', class: 'setup-button', text: 'Open settings' });
  button.addEventListener('click', () => {
    const m = input.value.match(/([0-9a-f]{32})/i);
    if (!m) return input.focus();
    code = m[1];
    try {
      sessionStorage.setItem(CODE_KEY, code);
    } catch {
      /* fine */
    }
    load();
  });
  return el('div', { class: 'setup-row' }, [input, button]);
}

/* ------------------------------------------------------------ the form */

let state = null;

function spotifyBlock(data) {
  const sp = data.spotify ?? {};
  const field = data.fields.find((f) => f.key === 'SPOTIFY_CLIENT_ID');
  const uri = el('input', { type: 'text', class: 'setup-input', readonly: true, value: sp.redirectUri ?? '', 'aria-label': 'Redirect URI for your Spotify app' });
  const copy = el('button', { type: 'button', class: 'setup-link', text: 'Copy' });
  copy.addEventListener('click', async () => {
    uri.select();
    try {
      await navigator.clipboard.writeText(uri.value);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy it';
    }
  });
  const parts = [el('label', { text: 'Redirect URI (paste this into your Spotify app)' }), el('div', { class: 'setup-row' }, [uri, copy])];
  const status = el('p', { class: 'small setup-spotify-status', text: sp.connected ? '' : field?.isSet ? 'Not connected yet.' : 'Save your Client ID first, then connect.' });
  status.hidden = !status.textContent;
  const connect = el('button', { type: 'button', class: 'setup-button', text: sp.connected ? 'Reconnect Spotify' : 'Connect Spotify', disabled: !field?.isSet });
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    const res = await fetch('/api/spotify/login', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-setup-code': code }, body: '{}' }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && typeof out.url === 'string' && out.url.startsWith('https://accounts.spotify.com/')) {
      location.href = out.url;
      return;
    }
    connect.disabled = false;
    status.textContent = out.error ?? 'Couldn’t start the Spotify sign-in.';
    status.hidden = false;
  });
  const buttons = [connect];
  if (sp.connected) {
    const off = el('button', { type: 'button', class: 'setup-pill-danger', text: 'Disconnect' });
    off.addEventListener('click', async () => {
      await fetch('/api/spotify/disconnect', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-setup-code': code }, body: '{}' }).catch(() => null);
      load({ quiet: true });
    });
    buttons.push(off);
  }
  return el('div', { class: 'setup-field' }, [...parts, status, el('div', { class: 'setup-connect' }, buttons)]);
}

function fieldControl(f, currentHost) {
  const id = `f-${f.key}`;
  let control;
  if (f.choices) {
    control = el('select', { id, name: f.key, class: 'setup-input', disabled: f.locked, 'aria-describedby': `err-${f.key}` });
    const selected = f.value || (f.key === 'HOST' ? currentHost : f.choices[0]);
    for (const c of f.choices) control.append(el('option', { value: c, text: CHOICE_LABELS[c] ?? c, selected: c === selected }));
  } else {
    control = el('input', {
      id,
      name: f.key,
      class: 'setup-input',
      type: f.secret ? 'password' : 'text',
      autocomplete: f.secret ? 'new-password' : 'off',
      spellcheck: 'false',
      value: f.secret ? '' : f.value,
      'aria-describedby': `err-${f.key}`,
      placeholder: f.secret && f.isSet ? 'Saved (leave empty to keep it)' : f.placeholder ?? '',
      disabled: f.locked,
    });
  }
  const parts = [el('label', { for: id, text: f.label }), control];
  if (f.key === 'TIME_ZONE' && !f.locked) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) {
      const use = el('button', { type: 'button', class: 'setup-link', text: `Use this computer’s (${zone})` });
      use.addEventListener('click', () => {
        control.value = zone;
      });
      parts.push(use);
    }
  }
  if (f.secret && f.isSet && !f.locked) {
    parts.push(el('label', { class: 'setup-check' }, [el('input', { type: 'checkbox', name: `clear:${f.key}` }), document.createTextNode(' Remove the saved one')]));
  }
  if (f.locked) parts.push(el('p', { class: 'muted small', text: 'Set in the .env file (or environment), so it can only be changed there.' }));
  parts.push(el('p', { class: 'setup-error small', id: `err-${f.key}`, hidden: true }));
  return el('div', { class: 'setup-field' }, parts);
}

/* ------------------------------------------------------------ tabs */

// One tab per dashboard card plus General (see setup-tabs.js). All panels stay
// inside the one form, only hidden, so Save always sends every tab.

let activeTab = null;
let tabIds = [];

function rememberTab(id) {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* storage blocked: start on the first tab next time */
  }
}

function savedTab() {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function selectTab(id, { focus = false } = {}) {
  if (!tabIds.includes(id)) id = tabIds[0];
  activeTab = id;
  for (const tab of form.querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  for (const panel of form.querySelectorAll('[role="tabpanel"]')) panel.hidden = panel.dataset.tab !== id;
}

// A control differs from what was loaded (uses the browser's own defaults).
function changed(control) {
  if (control.type === 'checkbox') return control.checked !== control.defaultChecked;
  if (control.tagName === 'SELECT') return [...control.options].some((o) => o.selected !== o.defaultSelected);
  if (control.readOnly || control.type === 'button') return false;
  return control.value !== control.defaultValue;
}

// Short words after a tab's name, also read out by screen readers.
function setTabMarks(tab, { dirty, error }) {
  tab.classList.toggle('is-dirty', dirty);
  tab.classList.toggle('has-error', error);
  const note = tab.querySelector('.setup-tab-note');
  note.textContent = error ? ' (needs fixing)' : dirty ? ' (not saved yet)' : '';
}

function updateDirty(panel) {
  const tab = document.getElementById(`tab-${panel.dataset.tab}`);
  const dirty = [...panel.querySelectorAll('input, select, textarea')].some(changed);
  setTabMarks(tab, { dirty, error: tab.classList.contains('has-error') });
}

function tabRow(groups) {
  const row = el('div', { class: 'setup-tabs', role: 'tablist', 'aria-label': 'Settings categories' });
  for (const g of groups) {
    const tab = el('button', { type: 'button', role: 'tab', id: `tab-${g.id}`, class: `setup-tab setup-tab-${g.accent}`, 'aria-controls': `panel-${g.id}`, 'data-tab': g.id }, [
      document.createTextNode(g.title),
      el('span', { class: 'setup-tab-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden setup-tab-note' }),
    ]);
    tab.addEventListener('click', () => {
      selectTab(g.id);
      rememberTab(g.id);
    });
    row.append(tab);
  }
  row.addEventListener('keydown', (event) => {
    const next = tabForKey(event.key, activeTab, tabIds);
    if (!next) return;
    event.preventDefault();
    selectTab(next, { focus: true });
    rememberTab(next);
  });
  return row;
}

function sectionBox(section, data) {
  const box = el('section', { class: `panel setup-section setup-${section.id}`, 'aria-labelledby': `h-${section.id}` }, [el('h2', { id: `h-${section.id}`, text: section.title })]);
  if (section.help?.length) box.append(helpText(section.help));
  if (section.id === 'news') {
    const area = el('textarea', { id: 'f-feeds', name: 'feeds', class: 'setup-input setup-feeds', rows: 7, spellcheck: 'false', 'aria-describedby': 'err-feeds' });
    area.defaultValue = data.feeds.text;
    box.append(el('label', { for: 'f-feeds', class: 'visually-hidden', text: 'News feeds' }), area, el('p', { class: 'setup-error small', id: 'err-feeds', hidden: true }));
  }
  for (const f of data.fields.filter((x) => x.section === section.id)) box.append(fieldControl(f, data.host));
  if (section.id === 'spotify') box.append(spotifyBlock(data));
  if ((section.id === 'music' || section.id === 'media') && data.slots) {
    box.append(el('p', { class: 'muted small setup-current', text: `Showing now: ${CHOICE_LABELS[data.slots[section.id]] ?? data.slots[section.id]}.` }));
  }
  return box;
}

function render(data) {
  state = data;
  const groups = groupSections(withFieldSections(SECTIONS, data.fields));
  tabIds = groups.map((g) => g.id);
  form.replaceChildren(tabRow(groups));
  for (const g of groups) {
    const panel = el('div', { role: 'tabpanel', id: `panel-${g.id}`, class: 'setup-panel', 'aria-labelledby': `tab-${g.id}`, 'data-tab': g.id }, [
      el('p', { class: 'muted setup-about', text: g.about }),
      ...g.sections.map((s) => sectionBox(s, data)),
    ]);
    panel.addEventListener('input', () => updateDirty(panel));
    panel.addEventListener('change', () => updateDirty(panel));
    form.append(panel);
  }
  const save = el('button', { type: 'submit', class: 'setup-button setup-save', text: 'Save all' });
  form.append(el('div', { class: 'setup-actions' }, [el('p', { class: 'muted small setup-save-note', text: 'Saves the changes in every tab.' }), save]));
  selectTab(activeTab ?? startTab({ saved: savedTab(), spotifyResult, tabIds }));
  form.hidden = false;
}

function collect() {
  const values = {};
  const clear = [];
  for (const f of state.fields) {
    if (f.locked) continue;
    const input = form.elements.namedItem(f.key);
    if (input) values[f.key] = input.value;
    if (form.elements.namedItem(`clear:${f.key}`)?.checked) clear.push(f.key);
  }
  const body = { values, clear };
  const feeds = form.elements.namedItem('feeds').value;
  // Only write the feeds file when the list was actually edited.
  if (feeds !== state.feeds.text) body.feeds = feeds;
  return body;
}

// Shows each error under its field, marks the tabs that have one, and opens
// the first of them with the cursor in the first field to fix.
function showErrors(errors) {
  form.querySelectorAll('.setup-error').forEach((p) => {
    p.hidden = true;
    p.textContent = '';
  });
  form.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
  const bad = tabsWithErrors(errors, state.fields);
  for (const tab of form.querySelectorAll('[role="tab"]')) {
    setTabMarks(tab, { dirty: tab.classList.contains('is-dirty'), error: bad.includes(tab.dataset.tab) });
  }
  let first = null;
  for (const err of errors) {
    const slot = err.key && document.getElementById(`err-${err.key}`);
    if (!slot) continue;
    slot.textContent = err.message;
    slot.hidden = false;
    const control = document.getElementById(`f-${err.key}`);
    control?.setAttribute('aria-invalid', 'true');
    if (!first && tabOfKey(err.key, state.fields) === bad[0]) first = control;
  }
  if (!bad.length) return false;
  selectTab(bad[0]);
  if (!first) return false;
  first.focus();
  return true;
}

// "Music: Spotify Client ID should be…", so the message says where to look.
function errorSummary(errors) {
  const titles = Object.fromEntries(TABS.map((t) => [t.id, t.title]));
  return errors
    .map((e) => {
      const tab = e.key && tabOfKey(e.key, state.fields);
      return tab ? `${titles[tab]}: ${e.message}` : e.message;
    })
    .join(' · ');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('.setup-save');
  button.disabled = true;
  let fieldFocused = false;
  try {
    const res = await api({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collect()) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 403) return refuse(out.error);
    if (!res.ok) {
      const errors = out.errors ?? [{ key: null, message: 'Saving failed.' }];
      fieldFocused = showErrors(errors);
      showStatus('error', [el('strong', { text: 'Not saved. ' }), document.createTextNode(errorSummary(errors))]);
      return;
    }
    showErrors([]);
    const done = [el('strong', { text: 'Saved. ' }), document.createTextNode('The dashboard is fetching your data now. ')];
    if (out.restartNeeded) done.push(document.createTextNode('Restart pupboard for the network setting to take effect. '));
    done.push(el('a', { href: '/', class: 'setup-link', text: 'Open the dashboard →' }));
    showStatus('ok', done);
    await load({ quiet: true });
    form.querySelector('.setup-save')?.focus({ preventScroll: true });
  } catch {
    showStatus('error', 'Couldn’t reach pupboard. Is it still running?');
  } finally {
    button.disabled = false;
    // The field to fix is already in view; otherwise show the message.
    if (!fieldFocused) statusBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

/* ------------------------------------------------------------ start */

function refuse(reason) {
  form.hidden = true;
  const nodes = [el('p', { text: REFUSALS[reason] ?? 'Settings aren’t available right now.' })];
  if (reason === 'code') nodes.push(codePrompt());
  showStatus('error', nodes);
}

async function load({ quiet = false } = {}) {
  if (!code) return refuse('code');
  if (!quiet) showStatus('info', 'Loading…');
  try {
    const res = await api();
    if (res.status === 403) return refuse((await res.json().catch(() => ({}))).error);
    if (!res.ok) throw new Error(String(res.status));
    render(await res.json());
    if (!quiet && spotifyResult && SPOTIFY_MESSAGES[spotifyResult]) showStatus(spotifyResult === 'connected' ? 'ok' : 'error', SPOTIFY_MESSAGES[spotifyResult]);
    else if (!quiet) showStatus('info', 'Fill in what you use in any tab, then press Save all. You don’t need every tab.');
  } catch {
    showStatus('error', 'Couldn’t reach pupboard. Is it still running?');
  }
}

load();
