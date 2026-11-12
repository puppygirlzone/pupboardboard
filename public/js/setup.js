// Settings page (/setup.html). Builds the form with DOM calls (textContent,
// never innerHTML), so nothing typed or saved can turn into markup.
//
// Access needs the code from the link pupboard prints when it starts
// (".../setup.html#code=..."). The code is kept in sessionStorage for reloads
// and removed from the address bar straight away.

const CODE_KEY = 'pupboard:setup-code';
const $ = (sel) => document.querySelector(sel);
const statusBox = $('#setup-status');
const form = $('#setup-form');

const SECTIONS = [
  {
    id: 'steam',
    title: 'Gaming (Steam)',
    help: [
      'Paste your Steam profile link (open your profile in Steam, right-click the page and copy its address). Steam also needs a free Web API key from ',
      ['steamcommunity.com/dev/apikey', 'https://steamcommunity.com/dev/apikey'],
      ' (for “Domain name” anything works, e.g. localhost). In Steam, set your profile’s “Game details” privacy to Public.',
    ],
  },
  { id: 'music', title: 'Music card', help: ['Which service the Music card shows. “Automatic” uses the first one below that is set up.'] },
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
    title: 'Music (Navidrome)',
    help: ['For your own music server: the address you open Navidrome at (for example http://192.168.1.10:4533) and your normal Navidrome login.'],
  },
  { id: 'media', title: 'Media card', help: ['Which service the Media card shows. “Automatic” uses Jellyfin if it is set up, then Letterboxd, then game deals.'] },
  { id: 'deals', title: 'Game deals', help: ['Free-to-keep PC games and the best Steam sales. Nothing to set up.'] },
  { id: 'letterboxd', title: 'Films (Letterboxd)', help: ['Films you log on ', ['letterboxd.com', 'https://letterboxd.com'], '. Just your username (or paste your profile link), no keys.'] },
  {
    id: 'jellyfin',
    title: 'Media server (Jellyfin)',
    help: ['The address you open Jellyfin at (for example http://192.168.1.10:8096). Make an API key in Jellyfin: Dashboard → API Keys → +.'],
  },
  { id: 'news', title: 'News (RSS)', help: ['One feed per line, as “Name | https://address-of-the-feed”. Lines starting with # are ignored. Empty = no news card.'] },
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
  const status = el('p', { class: 'small', text: sp.connected ? `Connected${sp.connectedAt ? ` since ${new Date(sp.connectedAt).toLocaleDateString()}` : ''}.` : field?.isSet ? 'Not connected yet.' : 'Save your Client ID first, then connect.' });
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
  });
  const buttons = [connect];
  if (sp.connected) {
    const off = el('button', { type: 'button', class: 'setup-link', text: 'Disconnect' });
    off.addEventListener('click', async () => {
      await fetch('/api/spotify/disconnect', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-setup-code': code }, body: '{}' }).catch(() => null);
      load({ quiet: true });
    });
    buttons.push(off);
  }
  return el('div', { class: 'setup-field' }, [...parts, el('div', { class: 'setup-row setup-connect' }, buttons), status]);
}

function fieldControl(f, currentHost) {
  const id = `f-${f.key}`;
  let control;
  if (f.choices) {
    control = el('select', { id, name: f.key, class: 'setup-input', disabled: f.locked });
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
      placeholder: f.secret && f.isSet ? 'Saved (leave empty to keep it)' : '',
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

function render(data) {
  state = data;
  form.replaceChildren();
  for (const section of SECTIONS) {
    const box = el('section', { class: `panel setup-section setup-${section.id}` }, [el('h2', { text: section.title }), helpText(section.help)]);
    if (section.id === 'news') {
      const area = el('textarea', { id: 'f-feeds', name: 'feeds', class: 'setup-input setup-feeds', rows: 7, spellcheck: 'false' });
      area.value = data.feeds.text;
      box.append(el('label', { for: 'f-feeds', class: 'visually-hidden', text: 'News feeds' }), area, el('p', { class: 'setup-error small', id: 'err-feeds', hidden: true }));
    }
    for (const f of data.fields.filter((x) => x.section === section.id)) box.append(fieldControl(f, data.host));
    if (section.id === 'spotify') box.append(spotifyBlock(data));
    if ((section.id === 'music' || section.id === 'media') && data.slots) {
      box.append(el('p', { class: 'muted small', text: `Showing now: ${CHOICE_LABELS[data.slots[section.id]] ?? data.slots[section.id]}.` }));
    }
    form.append(box);
  }
  const save = el('button', { type: 'submit', class: 'setup-button setup-save', text: 'Save' });
  form.append(el('div', { class: 'setup-actions' }, [save]));
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

function showErrors(errors) {
  form.querySelectorAll('.setup-error').forEach((p) => {
    p.hidden = true;
    p.textContent = '';
  });
  for (const err of errors) {
    const slot = err.key && document.getElementById(`err-${err.key}`);
    if (slot) {
      slot.textContent = err.message;
      slot.hidden = false;
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('.setup-save');
  button.disabled = true;
  try {
    const res = await api({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(collect()) });
    const out = await res.json().catch(() => ({}));
    if (res.status === 403) return refuse(out.error);
    if (!res.ok) {
      const errors = out.errors ?? [{ key: null, message: 'Saving failed.' }];
      showErrors(errors);
      showStatus('error', [el('strong', { text: 'Not saved. ' }), document.createTextNode(errors.map((e) => e.message).join(' · '))]);
      return;
    }
    showErrors([]);
    const done = [el('strong', { text: 'Saved. ' }), document.createTextNode('The dashboard is fetching your data now. ')];
    if (out.restartNeeded) done.push(document.createTextNode('Restart pupboard for the network setting to take effect. '));
    done.push(el('a', { href: '/', class: 'setup-link', text: 'Open the dashboard →' }));
    showStatus('ok', done);
    await load({ quiet: true });
  } catch {
    showStatus('error', 'Couldn’t reach pupboard. Is it still running?');
  } finally {
    button.disabled = false;
    statusBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    else if (!quiet) showStatus('info', 'Fill in what you use, then press Save at the bottom.');
  } catch {
    showStatus('error', 'Couldn’t reach pupboard. Is it still running?');
  }
}

load();
