// Entry point: `npm start` (real APIs), `npm run demo` (fake flaky APIs), or
// the double-click launchers in the release downloads.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig, isConfigured } from './config.js';
import { createApp } from './app.js';
import { createFakeFetch } from './demo/fake-upstreams.js';
import { readSettings, mergeSettings, settingsPath } from './settings.js';

const env = process.env;
const settingsFile = settingsPath(env.DATA_DIR);
const config = loadConfig(mergeSettings(env, readSettings(settingsFile)));
const fetchImpl = config.demo ? createFakeFetch({ failureRate: 0.25 }) : globalThis.fetch;
// In a container the browser is never "this computer", so the page can't be
// used there: settings come from .env instead.
const inContainer = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
if (inContainer) config.setupEnabled = false;
// A fresh code every start: the setup page only works with it.
const setup = { code: randomBytes(16).toString('hex'), env, file: settingsFile };
const { server, warm } = createApp({ config, fetchImpl, setup });

process.on('unhandledRejection', (err) => console.error('[process] unhandled rejection', err));

const local = `http://localhost:${config.port}`;
const setupUrl = `${local}/setup.html#code=${setup.code}`;
const wantsBrowser = /^(1|true|yes)$/i.test(env.OPEN_BROWSER ?? '');

/** Opens a URL in the default browser (launchers set OPEN_BROWSER=1). Best effort. */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log(`Open ${url} in your browser.`));
    child.unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${config.port} is already in use. pupboard may already be running: try ${local}`);
    console.error('To use another port, set PORT in .env (for example PORT=8743).\n');
    if (wantsBrowser) openBrowser(local);
  } else {
    console.error(`\nCouldn't start the server: ${err.code ?? err.message}\n`);
  }
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  const setupOn = config.setupEnabled && !config.demo;
  const accounts = ['steam', 'navidrome', 'jellyfin'].filter((k) => isConfigured[k](config));
  const status = Object.keys(isConfigured)
    .map((k) => `${k}: ${isConfigured[k](config) ? 'configured' : 'not configured'}`)
    .join(', ');
  console.log(`\npupboard is running: ${local}${config.demo ? ' (DEMO MODE: fake, flaky data)' : ''}`);
  if (config.host === '0.0.0.0' || config.host === '::') console.log(`Other devices on your network can open it at this computer's IP address, port ${config.port}.`);
  console.log(`Sources: ${status}`);
  if (setupOn) console.log(`\nSettings page (works only on this computer; the link changes every start):\n  ${setupUrl}`);
  if (!inContainer) console.log('\nKeep this window open while you use the dashboard. Close it (or press Ctrl+C) to stop.\n');
  if (wantsBrowser) openBrowser(accounts.length === 0 && setupOn ? setupUrl : local);
  warm().catch(() => {});
  setInterval(() => warm().catch(() => {}), config.refreshMinutes * 60_000).unref();
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
