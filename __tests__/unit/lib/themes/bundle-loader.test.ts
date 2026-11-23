/**
 * @jest-environment node
 *
 * Theme Bundle Loader Tests
 *
 * .qtap-theme validation, installation, uninstall and loading for version 2
 * bundles; the refusal of a version 1 bundle at install and at load; symbolic
 * links in an archive; and a malformed themes-index.json.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-themes-${process.pid}-${Date.now()}`);

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
}));

jest.mock('@/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

import {
  validateThemeBundle,
  installThemeBundle,
  uninstallThemeBundle,
  loadInstalledBundles,
  readIndex,
} from '@/lib/themes/bundle-loader';
import { safeValidateQtapThemeManifest } from '@/lib/themes/types';
import { earlierThemeMessage } from '@/lib/themes/refused';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const V1_FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v1-sample');

const VALID_MANIFEST = {
  format: 'qtap-theme' as const,
  formatVersion: 2 as const,
  id: 'test-theme',
  name: 'Test Theme',
  description: 'A test theme',
  version: '1.0.0',
  author: 'Test Author',
  supportsDarkMode: true,
  tags: ['test'],
  tokensPath: 'tokens.json',
};

const VALID_TOKENS = {
  primitives: {},
  tokens: { '--theme-primary': { value: '#3b82f6', dark: '#60a5fa' } },
  choices: {},
};

function zip(dir: string, out: string, args: string[] = ['-r', '-q']) {
  execFileSync('zip', [...args, out, '.'], { cwd: dir, stdio: 'pipe' });
}

async function writeBundleDir(
  dir: string,
  manifest: Record<string, unknown> = VALID_MANIFEST,
  extraFiles: Record<string, string> = {}
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'theme.json'), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(dir, 'tokens.json'), JSON.stringify(VALID_TOKENS, null, 2));
  for (const [name, content] of Object.entries(extraFiles)) {
    const filePath = path.join(dir, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return dir;
}

async function createTestBundle(
  tempDir: string,
  manifest: Record<string, unknown> = VALID_MANIFEST,
  extraFiles?: Record<string, string>
): Promise<string> {
  const bundleDir = await writeBundleDir(path.join(tempDir, 'bundle-source'), manifest, extraFiles);
  const zipPath = path.join(tempDir, 'test.qtap-theme');
  zip(bundleDir, zipPath);
  return zipPath;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

describe('Theme Bundle Loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-bundle-test-'));
    await fs.rm(mockThemesDir, { recursive: true, force: true });
    await fs.mkdir(mockThemesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(mockThemesDir, { recursive: true, force: true });
  });

  describe('validateThemeBundle', () => {
    test('validates a valid bundle', async () => {
      const result = await validateThemeBundle(await createTestBundle(tempDir));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.manifest?.id).toBe('test-theme');
      expect(result.refused).toBeUndefined();
    });

    test('rejects bundle without theme.json', async () => {
      const bundleDir = path.join(tempDir, 'no-manifest');
      await fs.mkdir(bundleDir, { recursive: true });
      await fs.writeFile(path.join(bundleDir, 'styles.css'), 'body {}');
      const zipPath = path.join(tempDir, 'bad.qtap-theme');
      zip(bundleDir, zipPath);

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('theme.json'))).toBe(true);
    });

    test('rejects bundle with blocked file types', async () => {
      const zipPath = await createTestBundle(tempDir, VALID_MANIFEST, { 'malicious.js': 'alert("xss")' });
      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('.js'))).toBe(true);
    });

    test('rejects invalid manifest', async () => {
      const result = await validateThemeBundle(await createTestBundle(tempDir, { ...VALID_MANIFEST, format: 'wrong' }));
      expect(result.valid).toBe(false);
    });

    test('rejects non-zip file', async () => {
      const fakePath = path.join(tempDir, 'not-a-zip.qtap-theme');
      await fs.writeFile(fakePath, 'this is not a zip file');
      const result = await validateThemeBundle(fakePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid zip'))).toBe(true);
    });

    test('refuses a symbolic link inside the archive', async () => {
      const bundleDir = await writeBundleDir(path.join(tempDir, 'linked'));
      await fs.symlink('/etc/hosts', path.join(bundleDir, 'hosts.txt'));
      const zipPath = path.join(tempDir, 'linked.qtap-theme');
      // --symlinks stores the link itself rather than the file it points at.
      zip(bundleDir, zipPath, ['-r', '-q', '--symlinks']);

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Symbolic links are not allowed in theme bundles: hosts.txt');

      const install = await installThemeBundle(zipPath);
      expect(install.success).toBe(false);
      expect(await exists(path.join(mockThemesDir, 'test-theme'))).toBe(false);
    });
  });

  describe('a version 1 bundle', () => {
    test('is refused at validation with the earlier-theme message', async () => {
      const zipPath = path.join(tempDir, 'v1-sample.qtap-theme');
      zip(V1_FIXTURE, zipPath);
      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.refused).toMatchObject({
        id: 'v1-sample',
        name: 'Version 1 Sample',
        reason: 'earlier-format',
        source: 'bundle',
      });
      expect(result.errors).toEqual([earlierThemeMessage('Version 1 Sample')]);
    });

    test('is refused at install before anything is written', async () => {
      const zipPath = path.join(tempDir, 'v1-sample.qtap-theme');
      zip(V1_FIXTURE, zipPath);
      const result = await installThemeBundle(zipPath);
      expect(result.success).toBe(false);
      expect(result.refused?.id).toBe('v1-sample');
      expect(result.error).toBe(earlierThemeMessage('Version 1 Sample'));
      expect(await exists(path.join(mockThemesDir, 'v1-sample'))).toBe(false);
      expect(await exists(path.join(mockThemesDir, 'themes-index.json'))).toBe(false);
    });

    test('found among the installed themes is recorded as refused, never loaded, and left on disk', async () => {
      await fs.cp(V1_FIXTURE, path.join(mockThemesDir, 'v1-sample'), { recursive: true });
      await installThemeBundle(await createTestBundle(tempDir));

      const set = await loadInstalledBundles();
      expect(set.loaded.map(b => b.manifest.id)).toEqual(['test-theme']);
      expect(set.refused).toEqual([
        expect.objectContaining({ id: 'v1-sample', reason: 'earlier-format', source: 'bundle' }),
      ]);
      expect(await exists(path.join(mockThemesDir, 'v1-sample', 'theme.json'))).toBe(true);
    });

    test('is refused by the manifest schema', () => {
      const result = safeValidateQtapThemeManifest({ ...VALID_MANIFEST, formatVersion: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe('installThemeBundle', () => {
    test('installs a valid bundle', async () => {
      const result = await installThemeBundle(await createTestBundle(tempDir));
      expect(result).toMatchObject({ success: true, themeId: 'test-theme', version: '1.0.0' });

      const themeJson = await fs.readFile(path.join(mockThemesDir, 'test-theme', 'theme.json'), 'utf-8');
      expect(JSON.parse(themeJson).id).toBe('test-theme');

      const index = JSON.parse(await fs.readFile(path.join(mockThemesDir, 'themes-index.json'), 'utf-8'));
      expect(index.themes).toHaveLength(1);
      expect(index.themes[0].id).toBe('test-theme');
    });
  });

  describe('uninstallThemeBundle', () => {
    test('uninstalls an installed bundle', async () => {
      await installThemeBundle(await createTestBundle(tempDir));
      const result = await uninstallThemeBundle('test-theme');
      expect(result).toEqual({ success: true, themeId: "test-theme" });
      expect(result.success).toBe(true);
      expect(await exists(path.join(mockThemesDir, 'test-theme'))).toBe(false);

      const index = JSON.parse(await fs.readFile(path.join(mockThemesDir, 'themes-index.json'), 'utf-8'));
      expect(index.themes).toHaveLength(0);
    });

    test('uninstalls a refused version 1 bundle', async () => {
      await fs.cp(V1_FIXTURE, path.join(mockThemesDir, 'v1-sample'), { recursive: true });
      const result = await uninstallThemeBundle('v1-sample');
      expect(result.success).toBe(true);
      expect(await exists(path.join(mockThemesDir, 'v1-sample'))).toBe(false);
    });

    test('returns error for non-existent theme', async () => {
      const result = await uninstallThemeBundle('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('loadInstalledBundles', () => {
    test('loads and compiles installed bundles', async () => {
      await installThemeBundle(await createTestBundle(tempDir));
      const { loaded, refused } = await loadInstalledBundles();
      expect(refused).toEqual([]);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].manifest.id).toBe('test-theme');
      expect(loaded[0].compiled.css.tokens).toContain('--theme-primary: #3b82f6');
    });

    test('returns nothing when no themes are installed', async () => {
      expect(await loadInstalledBundles()).toEqual({ loaded: [], refused: [] });
    });
  });

  describe('themes-index.json', () => {
    test.each([
      ['not JSON', '{ this is not json'],
      ['not an index', JSON.stringify({ version: 1, themes: [{ id: 42 }] })],
    ])('is rebuilt from the installed bundles when it is %s', async (_label, content) => {
      await installThemeBundle(await createTestBundle(tempDir));
      await fs.writeFile(path.join(mockThemesDir, 'themes-index.json'), content);

      const index = await readIndex();
      expect(index.themes.map(t => t.id)).toEqual(['test-theme']);
      const written = JSON.parse(await fs.readFile(path.join(mockThemesDir, 'themes-index.json'), 'utf-8'));
      expect(written.themes.map((t: { id: string }) => t.id)).toEqual(['test-theme']);
    });
  });

  describe('Zod schema validation', () => {
    test('validates QtapThemeManifest schema', () => {
      expect(safeValidateQtapThemeManifest(VALID_MANIFEST).success).toBe(true);
    });

    test('rejects invalid theme ID format', () => {
      expect(safeValidateQtapThemeManifest({ ...VALID_MANIFEST, id: 'Invalid ID!' }).success).toBe(false);
    });
  });
});
