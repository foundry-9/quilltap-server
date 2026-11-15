/**
 * `quilltap themes` against the bundled theme engine.
 *
 * The CLI validates, installs and exports through the same engine the app
 * uses (theme-engine.generated.js): version 2 bundles only, one extraction
 * routine that refuses symbolic links and escaping paths, and theme ids that
 * cannot name a directory outside the themes folder.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const engine = require('../theme-engine.generated');
const { themesCommand } = require('../theme-commands');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BUNDLED_THEMES = path.join(REPO_ROOT, 'themes/bundled');
const V1_FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v1-sample');

const MANIFEST = {
  format: 'qtap-theme',
  formatVersion: 2,
  id: 'cli-test-theme',
  name: 'CLI Test Theme',
  author: 'Test Author',
  version: '1.0.0',
  supportsDarkMode: true,
  tokensPath: 'tokens.json',
};
const TOKENS = { primitives: {}, tokens: { '--theme-primary': { value: '#3b82f6', dark: '#60a5fa' } }, choices: {} };

let tempDir;
let dataDir;

function zip(dir, out, args = ['-r', '-q']) {
  execFileSync('zip', [...args, out, '.'], { cwd: dir, stdio: 'pipe' });
}

async function writeBundleDir(dir, manifest = MANIFEST) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'theme.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(dir, 'tokens.json'), JSON.stringify(TOKENS, null, 2));
  return dir;
}

async function makeBundle(name = 'theme', manifest = MANIFEST) {
  const dir = await writeBundleDir(path.join(tempDir, `${name}-src`), manifest);
  const out = path.join(tempDir, `${name}.qtap-theme`);
  zip(dir, out);
  return out;
}

/** Run a themes subcommand; returns its exit code and printed output. */
async function run(args) {
  const lines = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a) => lines.push(a.join(' ')));
  const err = jest.spyOn(console, 'error').mockImplementation((...a) => lines.push(a.join(' ')));
  const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw Object.assign(new Error('exit'), { exitCode: code });
  });
  let code = 0;
  try {
    await themesCommand([...args, '--data-dir', dataDir]);
  } catch (e) {
    if (e.exitCode === undefined) throw e;
    code = e.exitCode;
  } finally {
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  // Strip colour codes so assertions read the words.
  return { code, output: lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '') };
}

function themesDir() {
  return path.join(dataDir, 'themes');
}

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qtap-cli-themes-'));
  dataDir = path.join(tempDir, 'instance');
  await fsp.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true });
});

describe('the bundled theme engine', () => {
  const bundled = fs.readdirSync(BUNDLED_THEMES).filter(d => fs.existsSync(path.join(BUNDLED_THEMES, d, 'theme.json')));

  it.each(bundled)('validates the bundled theme %s with no warnings', async (dir) => {
    const result = await engine.validateThemeDirectory(path.join(BUNDLED_THEMES, dir));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('refuses a symbolic link inside an archive', async () => {
    const dir = await writeBundleDir(path.join(tempDir, 'linked'));
    await fsp.symlink('/etc/hosts', path.join(dir, 'hosts.txt'));
    const out = path.join(tempDir, 'linked.qtap-theme');
    zip(dir, out, ['-r', '-q', '--symlinks']);

    const result = await engine.validateThemeBundle(out);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Symbolic links are not allowed in theme bundles: hosts.txt');

    const installed = await run(['install', out]);
    expect(installed.code).toBe(1);
    expect(fs.existsSync(path.join(themesDir(), 'cli-test-theme'))).toBe(false);
  });

  it('refuses an archive entry that climbs out of the bundle', async () => {
    // A stored entry named "../escape.txt": built by hand, since zip will not.
    const dir = await writeBundleDir(path.join(tempDir, 'escaping', 'inner'));
    await fsp.writeFile(path.join(tempDir, 'escaping', 'escape.txt'), 'out');
    const out = path.join(tempDir, 'escaping.qtap-theme');
    execFileSync('zip', ['-q', out, 'theme.json', 'tokens.json', '../escape.txt'], { cwd: dir, stdio: 'pipe' });

    const result = await engine.validateThemeBundle(out);
    expect(result.valid).toBe(false);
    expect(fs.existsSync(path.join(os.tmpdir(), 'escape.txt'))).toBe(false);
  });
});

describe('quilltap themes validate', () => {
  it('accepts a valid .qtap-theme file', async () => {
    const { code, output } = await run(['validate', await makeBundle()]);
    expect(code).toBe(0);
    expect(output).toContain('Valid version 2 theme bundle');
    expect(output).toContain('cli-test-theme');
  });

  it('accepts a bundle directory', async () => {
    const dir = await writeBundleDir(path.join(tempDir, 'as-dir'));
    const { code, output } = await run(['validate', dir]);
    expect(code).toBe(0);
    expect(output).toContain('Valid version 2 theme bundle');
  });

  it('refuses a version 1 bundle with the earlier-theme message', async () => {
    const { code, output } = await run(['validate', V1_FIXTURE]);
    expect(code).toBe(1);
    expect(output).toContain(engine.earlierThemeMessage('Version 1 Sample'));
    expect(output).toContain('Only version 2 theme bundles are accepted.');
  });

  it('reports a missing path', async () => {
    const { code, output } = await run(['validate', path.join(tempDir, 'nope.qtap-theme')]);
    expect(code).toBe(1);
    expect(output).toContain('Bundle file not found or not readable');
  });
});

describe('quilltap themes install / uninstall / export', () => {
  it('installs a valid bundle and records it in the index', async () => {
    const { code } = await run(['install', await makeBundle()]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(themesDir(), 'cli-test-theme', 'theme.json'))).toBe(true);
    const index = JSON.parse(await fsp.readFile(path.join(themesDir(), 'themes-index.json'), 'utf-8'));
    expect(index.themes.map(t => t.id)).toEqual(['cli-test-theme']);
  });

  it('refuses a version 1 bundle at install before anything is written', async () => {
    const out = path.join(tempDir, 'v1.qtap-theme');
    zip(V1_FIXTURE, out);
    const { code, output } = await run(['install', out]);
    expect(code).toBe(1);
    expect(output).toContain(engine.earlierThemeMessage('Version 1 Sample'));
    expect(fs.existsSync(path.join(themesDir(), 'v1-sample'))).toBe(false);
    expect(fs.existsSync(path.join(themesDir(), 'themes-index.json'))).toBe(false);
  });

  it('exports an installed theme to a bundle that validates', async () => {
    await run(['install', await makeBundle()]);
    const out = path.join(tempDir, 'exported.qtap-theme');
    const { code } = await run(['export', 'cli-test-theme', '--output', out]);
    expect(code).toBe(0);
    const result = await engine.validateThemeBundle(out);
    expect(result.valid).toBe(true);
    expect(result.manifest.id).toBe('cli-test-theme');
  });

  it('refuses to export a version 1 theme found among the installed themes', async () => {
    await fsp.cp(V1_FIXTURE, path.join(themesDir(), 'v1-sample'), { recursive: true });
    const out = path.join(tempDir, 'v1-out.qtap-theme');
    const { code, output } = await run(['export', 'v1-sample', '--output', out]);
    expect(code).toBe(1);
    expect(output).toContain(engine.earlierThemeMessage('Version 1 Sample'));
    expect(fs.existsSync(out)).toBe(false);
  });

  it('will not uninstall or export a theme id that names a path', async () => {
    const outside = path.join(dataDir, 'precious');
    await fsp.mkdir(outside, { recursive: true });
    await fsp.writeFile(path.join(outside, 'theme.json'), JSON.stringify(MANIFEST));

    const uninstalled = await run(['uninstall', '../precious']);
    expect(uninstalled.code).toBe(1);
    expect(fs.existsSync(outside)).toBe(true);

    const exported = await run(['export', '../precious', '--output', path.join(tempDir, 'x.qtap-theme')]);
    expect(exported.code).toBe(1);
  });
});

describe('icon overrides', () => {
  async function iconBundle(icons) {
    const dir = await writeBundleDir(path.join(tempDir, 'icons'), { ...MANIFEST, icons });
    await fsp.mkdir(path.join(dir, 'icons'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'icons/chat.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fsp.writeFile(path.join(dir, 'icons/chat.png'), 'not really');
    return engine.validateThemeDirectory(dir);
  }

  it('accepts an .svg override of an app icon', async () => {
    const result = await iconBundle({ chat: 'icons/chat.svg' });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each([
    ['an asset that is not .svg or .webp', { chat: 'icons/chat.png' }, 'must be .svg or .webp'],
    ['a climbing path', { chat: '../../../etc/passwd.svg' }, 'Must be a path inside the bundle'],
    ['an absolute path', { chat: '/etc/passwd.svg' }, 'Must be a path inside the bundle'],
    ['a name that is no app icon', { 'not-an-icon-zz': 'icons/chat.svg' }, 'not an app icon'],
  ])('refuses %s', async (_label, icons, message) => {
    const result = await iconBundle(icons);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain(message);
  });
});
