/**
 * @jest-environment node
 *
 * The theme assets route serves a bundle's served set and nothing else: a
 * file in the bundle directory that the theme neither declares nor
 * references is a 404, as are its manifest and tokens.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-asset-route-${process.pid}-${Date.now()}`);

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
}));

jest.mock('@/lib/startup/plugin-initialization', () => ({
  isPluginSystemInitialized: () => true,
  initializePlugins: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/themes/assets/[...path]/route';
import { loadInstalledBundles } from '@/lib/themes/bundle-loader';
import { themeRegistry } from '@/lib/themes/theme-registry';

const FIXTURE = path.resolve(__dirname, '../../../../fixtures/themes/v2-sample');

async function get(...segments: string[]) {
  const req = new NextRequest(`http://localhost:3000/api/themes/assets/${segments.join('/')}`);
  return GET(req, { params: Promise.resolve({ path: segments }) });
}

beforeAll(async () => {
  const dir = path.join(mockThemesDir, 'v2-sample');
  await fs.cp(FIXTURE, dir, { recursive: true });
  // In the bundle directory, but declared and referenced nowhere.
  await fs.copyFile(path.join(dir, 'textures/paper.webp'), path.join(dir, 'textures/unlisted.webp'));
  const bundle = (await loadInstalledBundles()).loaded.find((b) => b.manifest.id === 'v2-sample');
  themeRegistry.registerBundleTheme(bundle!);
});

afterAll(async () => {
  themeRegistry.unregisterTheme('v2-sample');
  await fs.rm(mockThemesDir, { recursive: true, force: true });
});

describe('GET /api/themes/assets', () => {
  it('serves a file in the served set', async () => {
    expect(themeRegistry.getServedAssets('v2-sample').has('textures/paper.webp')).toBe(true);
    const res = await get('bundle:v2-sample', 'textures', 'paper.webp');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
  });

  it.each([
    ['an unreferenced file', ['textures', 'unlisted.webp']],
    ['the manifest', ['theme.json']],
    ['the tokens', ['tokens.json']],
    ['the stylesheet', ['styles.css']],
  ])('refuses %s with a 404', async (_label, rest) => {
    const res = await get('bundle:v2-sample', ...rest);
    expect(res.status).toBe(404);
  });

  it('refuses an unknown theme and a non-bundle prefix', async () => {
    expect((await get('bundle:nope', 'textures', 'paper.webp')).status).toBe(404);
    expect((await get('plugin-x', 'textures', 'paper.webp')).status).toBe(404);
  });
});
