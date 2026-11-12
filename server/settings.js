// Settings saved from the /setup page, for people who'd rather not edit a
// .env file. Stored as JSON in DATA_DIR/settings.json (owner-only file).
//
// Precedence: a value set in the environment (.env, Docker, the shell) always
// wins. The setup page shows those fields as locked instead of editing them.
//
// Secrets are write-only: the page learns whether a secret is set, never its
// value.

import { readFileSync } from 'node:fs';
import { writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { validTimeZone, MUSIC_SOURCES, MEDIA_SOURCES } from './config.js';
import { parseSteamProfile, DEFAULT_STEAM_HIDE } from './sources/steam.js';
import { validListenBrainzUser } from './sources/listenbrainz.js';
import { validLetterboxdUser } from './sources/letterboxd.js';
import { validSpotifyClientId } from './sources/spotify.js';

// People paste profile links; keep just the username.
const fromLink = (pattern) => (v) => v.match(pattern)?.[1] ?? v;

export const SETTINGS_FIELDS = [
  { key: 'STEAM_ID', section: 'steam', label: 'Steam profile link (or SteamID64)' },
  { key: 'STEAM_API_KEY', section: 'steam', label: 'Steam Web API key', secret: true },
  { key: 'STEAM_HIDE', section: 'steam', label: 'Don’t count these apps (names or app IDs, separated by commas)', placeholder: `${DEFAULT_STEAM_HIDE.join(', ')} (the default)` },
  { key: 'MUSIC_SOURCE', section: 'music', label: 'Show on the Music card', choices: ['auto', ...MUSIC_SOURCES] },
  {
    key: 'LISTENBRAINZ_USER',
    section: 'listenbrainz',
    label: 'ListenBrainz username',
    normalize: fromLink(/^(?:https?:\/\/)?(?:www\.)?listenbrainz\.org\/user\/([^/?#]+)/i),
    check: (v) => (validListenBrainzUser(v) ? null : 'is not a valid ListenBrainz username'),
  },
  { key: 'SPOTIFY_CLIENT_ID', section: 'spotify', label: 'Spotify Client ID', check: (v) => (validSpotifyClientId(v) ? null : 'should be the 32-character Client ID from your Spotify app') },
  { key: 'NAVIDROME_URL', section: 'navidrome', label: 'Navidrome address', url: true },
  { key: 'NAVIDROME_USER', section: 'navidrome', label: 'Navidrome username' },
  { key: 'NAVIDROME_PASSWORD', section: 'navidrome', label: 'Navidrome password', secret: true },
  { key: 'JELLYFIN_URL', section: 'jellyfin', label: 'Jellyfin address', url: true },
  { key: 'JELLYFIN_API_KEY', section: 'jellyfin', label: 'Jellyfin API key', secret: true },
  { key: 'MEDIA_SOURCE', section: 'media', label: 'Show on the Media card', choices: ['auto', ...MEDIA_SOURCES] },
  {
    key: 'LETTERBOXD_USER',
    section: 'letterboxd',
    label: 'Letterboxd username',
    normalize: fromLink(/^(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([A-Za-z0-9_]+)/i),
    check: (v) => (validLetterboxdUser(v) ? null : 'is not a valid Letterboxd username (letters, numbers and _ only)'),
  },
  { key: 'DEALS', section: 'deals', label: 'Game deals and free games', choices: ['on', 'off'] },
  { key: 'DEALS_CURRENCY', section: 'deals', label: 'Currency for prices', choices: ['USD', 'AUD', 'GBP'] },
  { key: 'TIME_ZONE', section: 'clock', label: 'Time zone' },
  { key: 'CLOCK_FORMAT', section: 'clock', label: 'Clock format', choices: ['24h', '12h'] },
  { key: 'HOST', section: 'network', label: 'Who can open the dashboard', choices: ['127.0.0.1', '0.0.0.0'], restart: true },
];
const BY_KEY = new Map(SETTINGS_FIELDS.map((f) => [f.key, f]));
const MAX_VALUE = 500;
export const MAX_FEEDS_TEXT = 20_000;

export const settingsPath = (dataDir) => path.join(dataDir || './data', 'settings.json');

/** Saved settings, keeping only known keys with string values. Never throws. */
export function readSettings(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[settings] ignoring unreadable ${file}`);
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(parsed && typeof parsed === 'object' ? parsed : {})) {
    if (BY_KEY.has(k) && typeof v === 'string' && v.length <= MAX_VALUE) out[k] = v;
  }
  return out;
}

/** Atomic write, readable only by the user running pupboard. */
export async function writeSettings(file, values) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  await chmod(file, 0o600).catch(() => {}); // no-op on Windows
}

const envSet = (env, key) => typeof env[key] === 'string' && env[key].trim() !== '';

/** Environment with saved settings filling in whatever the environment leaves blank. */
export function mergeSettings(env, saved) {
  const merged = { ...env };
  for (const [k, v] of Object.entries(saved)) if (!envSet(env, k)) merged[k] = v;
  return merged;
}

/** What the setup page may see: secrets only as "set or not". */
export function describeSettings(env, saved) {
  return SETTINGS_FIELDS.map((f) => {
    const locked = envSet(env, f.key);
    const value = locked ? env[f.key] : saved[f.key] ?? '';
    return {
      key: f.key,
      section: f.section,
      label: f.label,
      secret: Boolean(f.secret),
      choices: f.choices ?? null,
      placeholder: f.placeholder ?? '',
      restart: Boolean(f.restart),
      locked,
      isSet: String(value).trim() !== '',
      value: f.secret ? '' : String(value),
    };
  });
}

const isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
};

function checkValue(field, value) {
  if (value === '') return null;
  if (value.length > MAX_VALUE) return 'is too long';
  if (/[\r\n\0]/.test(value)) return 'must be a single line';
  if (field.url && !isHttpUrl(value)) return 'must start with http:// or https:// (for example http://192.168.1.10:4533)';
  if (field.choices && !field.choices.includes(value)) return 'is not one of the options';
  if (field.key === 'STEAM_ID' && !parseSteamProfile(value)) return 'should be your profile link, like https://steamcommunity.com/id/yourname';
  if (field.check) return field.check(value);
  if (field.key === 'TIME_ZONE' && !validTimeZone(value)) return 'is not a known time zone (try a name like Europe/London)';
  return null;
}

/**
 * Applies a change request from the setup page to the saved settings.
 *   request.values: { KEY: string }  (a blank secret means "keep the current one")
 *   request.clear:  [KEY]            (remove a saved value, secrets included)
 * Fields locked by the environment are ignored. Returns { settings, errors }.
 */
export function applyChanges(saved, request, env = {}) {
  const errors = [];
  const next = { ...saved };
  const values = request && typeof request.values === 'object' && request.values ? request.values : {};
  const clear = Array.isArray(request?.clear) ? request.clear : [];

  for (const key of clear) {
    if (BY_KEY.has(key) && !envSet(env, key)) delete next[key];
  }
  for (const [key, raw] of Object.entries(values)) {
    const field = BY_KEY.get(key);
    if (!field || envSet(env, key)) continue;
    if (typeof raw !== 'string') {
      errors.push({ key, message: `${field.label} must be text` });
      continue;
    }
    let value = field.url ? raw.trim().replace(/\/+$/, '') : raw.trim();
    if (field.normalize && value) value = field.normalize(value);
    if (field.secret && value === '') continue; // keep the current secret
    const problem = checkValue(field, value);
    if (problem) errors.push({ key, message: `${field.label} ${problem}` });
    else if (value === '') delete next[key];
    else next[key] = value;
  }
  return { settings: next, errors };
}
