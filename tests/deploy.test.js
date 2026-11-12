// Guards for the ways people run pupboard: Docker Compose (including Dockge
// on older Compose versions) and the double-click release downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const compose = await read('compose.yaml');

test('compose uses the published image, with a local build as fallback', () => {
  assert.match(compose, /^\s+image: ghcr\.io\/[a-z0-9-]+\/pupboardboard:latest$/m);
  assert.match(compose, /^\s+build: \.$/m);
  // "missing" pulls when there's no image and lets `compose pull` (Dockge's
  // Update) fetch new ones. "always" breaks offline starts; "build" never updates.
  assert.match(compose, /^\s+pull_policy: missing$/m);
});

test('.env uses the plain env_file form that older Compose accepts', () => {
  assert.match(compose, /env_file:\n\s+- \.env\n/);
  assert.ok(!/env_file:\s*\n\s+- path:/.test(compose), 'no path:/required: form (needs Compose 2.24+)');
});

test('only pupboard runs; feeds folder is mounted read-only; port 8742', () => {
  const services = compose.split(/^services:\n/m)[1].split(/^\S/m)[0]; // up to the next top-level key
  assert.equal((services.match(/^ {2}[a-z][\w-]*:$/gm) ?? []).length, 1, 'exactly one service');
  assert.match(compose, /- \.\/config:\/app\/config:ro/);
  assert.match(compose, /"8742:8742"/);
});

test('default port 8742 is the same everywhere', async () => {
  assert.match(await read('Dockerfile'), /PORT=8742/);
  assert.match(await read('server/config.js'), /positive\(env\.PORT, 8742\)/);
  assert.match(await read('.env.example'), /^PORT=8742$/m);
  assert.match(await read('.claude/launch.json'), /"PORT": "8742"/);
});

test('image workflow publishes to ghcr.io for amd64 and arm64', async () => {
  const wf = await read('.github/workflows/docker.yml');
  assert.match(wf, /images: ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.match(wf, /platforms: linux\/amd64,linux\/arm64/);
  assert.match(wf, /packages: write/);
  assert.match(wf, /npm test/, 'tests run before publishing');
});

test('release downloads: every launcher opens the browser and stays on this computer by default', async () => {
  for (const file of ['packaging/Start pupboard.bat', 'packaging/Start pupboard.command', 'packaging/start-pupboard.sh']) {
    const text = await read(file);
    assert.match(text, /OPEN_BROWSER=1/, file);
    assert.match(text, /DEFAULT_HOST=127\.0\.0\.1/, file);
    assert.match(text, /server[\\/]index\.js/, file);
  }
  for (const file of ['packaging/Start pupboard.command', 'packaging/start-pupboard.sh', 'scripts/package-release.sh']) {
    assert.ok(((await stat(new URL(`../${file}`, import.meta.url))).mode & 0o111) !== 0, `${file} is executable`);
  }
  const script = await read('scripts/package-release.sh');
  assert.match(script, /sha256sum -c/, 'downloaded Node.js is checksum-verified');
  const release = await read('.github/workflows/release.yml');
  for (const target of ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64']) assert.ok(release.includes(target), target);
});
