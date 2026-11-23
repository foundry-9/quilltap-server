/**
 * @jest-environment node
 *
 * Version 2 themes end to end (Calliope Live, Spec A 3.4–3.5):
 * - the snapshot harness over the fixture theme: overridden tokens take their
 *   new values, density switches its tokens, and every name the theme does
 *   not reach keeps its default;
 * - the loader round trip: validate → install → register → export;
 * - a version 1 bundle refused at install and at load, and never registered.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-v2-themes-${process.pid}-${Date.now()}`);

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
}));

import { exportThemeAsBundle, installThemeBundle, loadInstalledBundles, validateThemeBundle } from '@/lib/themes/bundle-loader';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { THEME_TOKENS } from '@/lib/themes/registry';
import { tokenModes } from '@/lib/themes/engine';
import { resolveRootVariables } from '@/lib/themes/snapshot/cascade';
import { rootStateFor, themeSheets, SNAPSHOT_MODES } from '@/lib/themes/snapshot/themes';
import { loadThemeFromDir } from '@/lib/themes/theme-bundle';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample');
const work = path.join(os.tmpdir(), `qtap-test-v2-work-${process.pid}-${Date.now()}`);

function zipDir(dir: string, out: string) {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dir });
}

beforeAll(async () => {
  await fs.mkdir(mockThemesDir, { recursive: true });
  await fs.mkdir(work, { recursive: true });
});

afterAll(async () => {
  await fs.rm(mockThemesDir, { recursive: true, force: true });
  await fs.rm(work, { recursive: true, force: true });
});

describe('snapshot harness over the fixture theme', () => {
  let appCss: string;
  let sheets: ReturnType<typeof themeSheets>;
  let themeTokens: Record<string, { value: string; dark?: string }>;

  beforeAll(async () => {
    appCss = execFileSync(process.execPath, [path.join(REPO_ROOT, 'scripts/lib/compile-app-css.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const loaded = await loadThemeFromDir(FIXTURE, JSON.parse(readFileSync(path.join(FIXTURE, 'theme.json'), 'utf8')));
    sheets = themeSheets(loaded.compiled);
    themeTokens = Object.fromEntries(Object.entries(loaded.document.tokens.tokens).map(([k, v]) => [k, tokenModes(v)]));
  }, 60_000);

  it.each(SNAPSHOT_MODES)('overrides what it sets and nothing it does not reach (%s)', (mode) => {
    const root = rootStateFor('v2-sample', mode);
    const base = resolveRootVariables([{ origin: 'app', css: appCss }], root);
    const themedRoot = rootStateFor('v2-sample', mode);
    themedRoot.attributes['data-qt-density'] = 'comfortable';
    const themed = resolveRootVariables([{ origin: 'app', css: appCss }, ...sheets], themedRoot);
    expect(themed.errors).toEqual(base.errors);

    // The theme's own declarations win, and resolve.
    for (const [name, value] of Object.entries(themeTokens)) {
      const written = mode === 'dark' && value.dark !== undefined ? value.dark : value.value;
      if (!/url\(/.test(written)) expect([name, themed.declared[name]]).toEqual([name, written]);
      expect([name, themed.values[name]]).toEqual([name, expect.any(String)]);
    }
    expect(themed.values['--p-gold']).toBe(mode === 'dark' ? '#F4BE34' : '#C19015');
    expect(themed.values['--theme-primary']).toBe(themed.values['--p-gold']);
    expect(themed.values['--sample-glow']).toBe(`0 0 6px ${themed.values['--p-gold']}`);

    // Density: every comfortable value applies (where the theme does not set the token itself).
    const density = THEME_TOKENS.filter((t) => t.byChoice?.density?.comfortable !== undefined && !(t.name in themeTokens));
    for (const t of density) expect([t.name, themed.values[t.name]]).toEqual([t.name, t.byChoice!.density.comfortable]);

    // Everything the theme cannot reach keeps its default: close the overridden
    // set over "reads a var() of" in both cascades, then compare the rest.
    const reached = new Set<string>([...Object.keys(themeTokens), ...density.map((t) => t.name)]);
    for (const name of Object.keys(themed.declared)) if (name.startsWith('--p-') || !(name in base.declared)) reached.add(name);
    let grew = true;
    while (grew) {
      grew = false;
      for (const declared of [base.declared, themed.declared]) {
        for (const [name, raw] of Object.entries(declared)) {
          if (reached.has(name)) continue;
          if ([...raw.matchAll(/var\(\s*(--[\w-]+)/g)].some((m) => reached.has(m[1]))) {
            reached.add(name);
            grew = true;
          }
        }
      }
    }
    const untouched = Object.keys(base.values).filter((n) => !reached.has(n));
    expect(untouched.length).toBeGreaterThan(300);
    for (const name of untouched) expect([name, themed.values[name]]).toEqual([name, base.values[name]]);
  });
});

describe('loader round trip', () => {
  it('validates, installs, registers and exports a version 2 bundle', async () => {
    const zip = path.join(work, 'v2-sample.qtap-theme');
    zipDir(FIXTURE, zip);

    const validation = await validateThemeBundle(zip);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(validation.manifest?.formatVersion).toBe(2);
    expect(validation.refused).toBeUndefined();

    const install = await installThemeBundle(zip);
    expect(install).toMatchObject({ success: true, themeId: 'v2-sample', version: '1.0.0' });

    const bundle = (await loadInstalledBundles()).loaded.find((b) => b.manifest.id === 'v2-sample');
    expect(bundle).toBeDefined();
    themeRegistry.registerBundleTheme(bundle!);

    const theme = themeRegistry.get('v2-sample');
    expect(theme?.source).toBe('bundle');
    expect(theme?.compiled?.choices).toEqual({ density: 'comfortable' });
    expect(themeRegistry.getCSS('v2-sample')).toContain(':scope.dark .qt-card');
    expect(themeRegistry.getFonts('v2-sample').map((f) => f.src)).toEqual(['fonts/RethinkSans-latin-ext.woff2']);
    expect(theme?.subsystems?.salon?.backgroundImage).toBe('/api/themes/assets/bundle:v2-sample/textures/paper.webp');

    const listed = themeRegistry.getThemeList().find((t) => t.id === 'v2-sample');
    expect(listed?.previewColors?.light.primary).toBe('#C19015');
    expect(listed?.headingFont?.family).toBe('Rethink Sans');

    const exported = path.join(work, 'exported.qtap-theme');
    await exportThemeAsBundle('v2-sample', install.installPath!, exported);
    const listing = execFileSync('unzip', ['-Z1', exported], { encoding: 'utf8' }).split('\n').filter(Boolean).sort();
    expect(listing).toEqual(expect.arrayContaining(['theme.json', 'tokens.json', 'styles.css', 'icons/sun.svg', 'textures/paper.webp']));
    const exportedManifest = JSON.parse(execFileSync('unzip', ['-p', exported, 'theme.json'], { encoding: 'utf8' }));
    expect(exportedManifest.formatVersion).toBe(2);
    expect((await validateThemeBundle(exported)).valid).toBe(true);

    themeRegistry.unregisterTheme('v2-sample');
  });

  it('refuses an invalid version 2 bundle and says why', async () => {
    const dir = path.join(work, 'bad-v2');
    await fs.cp(FIXTURE, dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'styles.css'), '.a {\n  background: url(https://example.com/beacon.png);\n}\n');
    const zip = path.join(work, 'bad-v2.qtap-theme');
    zipDir(dir, zip);
    const validation = await validateThemeBundle(zip);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([expect.stringMatching(/^styles\.css: remote or absolute URL https:\/\/example\.com\/beacon\.png .*\(line 2\)$/)]);
    expect((await installThemeBundle(zip)).success).toBe(false);
  });

  it('refuses a version 1 bundle at install, writing nothing', async () => {
    const zip = path.join(work, 'v1-sample.qtap-theme');
    zipDir(path.join(REPO_ROOT, '__tests__/fixtures/themes/v1-sample'), zip);
    const install = await installThemeBundle(zip);
    expect(install.success).toBe(false);
    expect(install.refused).toMatchObject({ id: 'v1-sample', reason: 'earlier-format', source: 'bundle' });
    await expect(fs.access(path.join(mockThemesDir, 'v1-sample'))).rejects.toThrow();
  });

  it('records a version 1 bundle found on disk as refused and never registers it', async () => {
    await fs.cp(path.join(REPO_ROOT, '__tests__/fixtures/themes/v1-sample'), path.join(mockThemesDir, 'v1-sample'), { recursive: true });
    const { loaded, refused } = await loadInstalledBundles();
    expect(loaded.map((b) => b.manifest.id)).not.toContain('v1-sample');
    const refusal = refused.find((r) => r.id === 'v1-sample');
    expect(refusal).toMatchObject({ reason: 'earlier-format', source: 'bundle' });

    themeRegistry.recordRefused(refusal!);
    expect(themeRegistry.get('v1-sample')).toBeNull();
    expect(themeRegistry.getCSS('v1-sample')).toBe('');
    expect(themeRegistry.getThemeList().map((t) => t.id)).not.toContain('v1-sample');
    expect(themeRegistry.getRefusedTheme('v1-sample')?.name).toBe('Version 1 Sample');
    themeRegistry.forgetRefused('v1-sample');
  });
});
