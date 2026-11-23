/**
 * @jest-environment node
 *
 * The theme registry turns away what it cannot wear: a theme a plugin
 * declares and a version 1 bundle are recorded as refused, never registered,
 * so neither reaches the injector. A plugin's refusal survives a bundle of
 * the same id loading.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mockRoot = path.join(os.tmpdir(), `qtap-test-refusals-${process.pid}-${Date.now()}`);
const mockBundledDir = path.join(mockRoot, 'bundled');
const mockThemesDir = path.join(mockRoot, 'installed');

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
  getBundledThemesDir: () => mockBundledDir,
}));

jest.mock('@/lib/plugins', () => ({
  getEnabledPluginsByCapability: (capability: string) =>
    capability === 'THEME'
      ? [{ manifest: { name: 'qtap-plugin-theme-v2-sample', title: 'Sample (plugin)', version: '3.0.0' } }]
      : [],
}));

import { themeRegistry } from '@/lib/themes/theme-registry';
import { earlierThemeMessage } from '@/lib/themes/refused';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES = path.join(REPO_ROOT, '__tests__/fixtures/themes');

beforeAll(async () => {
  await fs.mkdir(mockBundledDir, { recursive: true });
  await fs.mkdir(mockThemesDir, { recursive: true });
  await fs.cp(path.join(FIXTURES, 'v2-sample'), path.join(mockBundledDir, 'v2-sample'), { recursive: true });
  await fs.cp(path.join(FIXTURES, 'v1-sample'), path.join(mockThemesDir, 'v1-sample'), { recursive: true });
  await themeRegistry.initialize();
});

afterAll(async () => {
  themeRegistry.unregisterTheme('v2-sample');
  await fs.rm(mockRoot, { recursive: true, force: true });
});

describe('theme refusals', () => {
  it("records a plugin's theme as refused, even when a bundle of that id loads", () => {
    expect(themeRegistry.getRefused()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'v2-sample',
          reason: 'plugin-theme',
          source: 'plugin',
          pluginName: 'qtap-plugin-theme-v2-sample',
          message: earlierThemeMessage('Sample (plugin)'),
        }),
      ])
    );
    // The bundle itself is worn.
    expect(themeRegistry.get('v2-sample')?.source).toBe('bundle');
  });

  it('records an installed version 1 bundle as refused and never registers it', () => {
    expect(themeRegistry.getRefusedTheme('v1-sample')).toMatchObject({ reason: 'earlier-format', source: 'bundle' });
    expect(themeRegistry.get('v1-sample')).toBeNull();
    expect(themeRegistry.getThemeList().map((t) => t.id)).not.toContain('v1-sample');
  });

  it('gives the injector nothing for a refused theme', () => {
    expect(themeRegistry.getCSS('v1-sample')).toBe('');
    expect(themeRegistry.getServedAssets('v1-sample').size).toBe(0);
    expect(themeRegistry.getCSS('v2-sample')).not.toBe('');
  });

  it('forgets an uninstalled refused bundle without touching a plugin refusal', () => {
    themeRegistry.recordRefused({ ...themeRegistry.getRefusedTheme('v1-sample')!, id: 'v2-sample' });
    expect(themeRegistry.forgetRefused('v2-sample')).toBe(true);
    expect(themeRegistry.getRefusedTheme('v2-sample')?.source).toBe('plugin');
  });
});
