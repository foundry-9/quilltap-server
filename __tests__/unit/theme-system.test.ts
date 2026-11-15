/**
 * @jest-environment node
 *
 * Theme icon overrides: a bundle's `icons` map is registered per icon and
 * served through the theme assets route.
 */

import { themeRegistry } from '@/lib/themes/theme-registry';
import type { LoadedBundleTheme } from '@/lib/themes/bundle-loader';
import type { CompiledTheme } from '@/lib/themes/engine/compile';

describe('Theme icon overrides', () => {
  const THEME_ID = 'test-icon-override-theme';

  const compiled = {
    css: { fontFaces: '', tokens: '', icons: '', custom: '' },
    choices: {},
    features: [],
    assets: [],
  } as unknown as CompiledTheme;

  const makeBundle = (icons?: Record<string, string>): LoadedBundleTheme => ({
    manifest: {
      format: 'qtap-theme',
      formatVersion: 2,
      id: THEME_ID,
      name: 'Test Icon Override',
      version: '1.0.0',
      author: 'tester',
      supportsDarkMode: true,
      tokensPath: 'tokens.json',
      icons,
    },
    compiled,
    installPath: '/tmp/test-icon-override-theme',
    indexEntry: {
      id: THEME_ID,
      version: '1.0.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      source: 'file',
      sourceUrl: null,
      registrySource: null,
      signatureVerified: false,
    },
  } as unknown as LoadedBundleTheme);

  afterEach(() => {
    themeRegistry.unregisterTheme(THEME_ID);
  });

  it('registers per-icon overrides and exposes them via getIcons', () => {
    themeRegistry.registerBundleTheme(makeBundle({
      chat: 'icons/chat.svg',
      prospero: 'icons/prospero.webp',
    }));

    const icons = themeRegistry.getIcons(THEME_ID);
    expect(icons).toHaveLength(2);
    expect(icons.find(i => i.name === 'chat')).toMatchObject({
      name: 'chat',
      pluginName: `bundle:${THEME_ID}`,
      src: 'icons/chat.svg',
    });
  });

  it('resolves icon override URLs through the assets route', () => {
    themeRegistry.registerBundleTheme(makeBundle({ prospero: 'icons/prospero.webp' }));

    const [icon] = themeRegistry.getIcons(THEME_ID);
    // Mirrors the URL the tokens API builds.
    expect(`/api/themes/assets/${icon.pluginName}/${icon.src}`).toBe(`/api/themes/assets/bundle:${THEME_ID}/icons/prospero.webp`);
  });

  it('returns an empty array when a theme declares no icon overrides', () => {
    themeRegistry.registerBundleTheme(makeBundle(undefined));
    expect(themeRegistry.getIcons(THEME_ID)).toEqual([]);
  });
});
