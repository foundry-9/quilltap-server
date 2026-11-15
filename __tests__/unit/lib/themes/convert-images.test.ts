/**
 * @jest-environment node
 *
 * Install-time image conversion (`lib/themes/convert-images.ts`, Spec D
 * decision 11): each PNG / JPEG / GIF becomes a WebP and every reference to
 * it is rewritten — in theme.json, in token and primitive values, and in the
 * custom CSS. A collision changes nothing; an animated image is left alone.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { convertThemeImages } from '@/lib/themes/convert-images';
import { loadThemeFromDir } from '@/lib/themes/theme-bundle';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample');
let dir: string;

const solid = (format: 'png' | 'jpeg' | 'gif') =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: '#468' } })[format]().toBuffer();
const readJson = async (rel: string) => JSON.parse(await fs.readFile(path.join(dir, rel), 'utf-8'));
const exists = (rel: string) => fs.access(path.join(dir, rel)).then(() => true, () => false);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-convert-'));
  await fs.cp(FIXTURE, dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'textures/grain.png'), await solid('png'));
  await fs.writeFile(path.join(dir, 'textures/photo.jpg'), await solid('jpeg'));
  await fs.writeFile(path.join(dir, 'preview.png'), await solid('png'));

  const manifest = await readJson('theme.json');
  manifest.previewImage = 'preview.png';
  manifest.subsystems.salon.backgroundImage = 'textures/photo.jpg';
  await fs.writeFile(path.join(dir, 'theme.json'), JSON.stringify(manifest));

  const tokens = await readJson('tokens.json');
  tokens.tokens['--qt-page-background-image'] = { value: 'url("textures/grain.png")', dark: 'url(textures/paper-dark.webp)' };
  tokens.primitives.texture = { type: 'image', value: "url('./textures/photo.jpg')" };
  await fs.writeFile(path.join(dir, 'tokens.json'), JSON.stringify(tokens));

  const css = await fs.readFile(path.join(dir, 'styles.css'), 'utf-8');
  await fs.writeFile(path.join(dir, 'styles.css'), `${css}\n.qt-card { background-image: url(textures/grain.png); }\n`);
});

afterEach(() => fs.rm(dir, { recursive: true, force: true }));

it('converts every raster image and rewrites all three kinds of reference', async () => {
  const result = await convertThemeImages(dir);
  expect(result.errors).toEqual([]);
  expect(result.converted).toEqual({
    'preview.png': 'preview.webp',
    'textures/grain.png': 'textures/grain.webp',
    'textures/photo.jpg': 'textures/photo.webp',
  });
  for (const gone of ['preview.png', 'textures/grain.png', 'textures/photo.jpg']) expect(await exists(gone)).toBe(false);
  expect((await sharp(await fs.readFile(path.join(dir, 'textures/grain.webp'))).metadata()).format).toBe('webp');

  const manifest = await readJson('theme.json');
  expect(manifest.previewImage).toBe('preview.webp');
  expect(manifest.subsystems.salon.backgroundImage).toBe('textures/photo.webp');

  const tokens = await readJson('tokens.json');
  expect(tokens.tokens['--qt-page-background-image']).toEqual({ value: 'url("textures/grain.webp")', dark: 'url(textures/paper-dark.webp)' });
  expect(tokens.primitives.texture.value).toBe('url("textures/photo.webp")');

  const css = await fs.readFile(path.join(dir, 'styles.css'), 'utf-8');
  expect(css).toContain('url("textures/grain.webp")');
  expect(css).not.toContain('grain.png');
  expect(css).toContain('url("textures/paper.webp")');

  // The converted bundle still loads, with the new files in its served set.
  const loaded = await loadThemeFromDir(dir, manifest);
  expect(loaded.compiled.assets).toEqual(expect.arrayContaining(['textures/grain.webp', 'textures/photo.webp']));
});

it('refuses a conversion that would land on an existing file, changing nothing', async () => {
  await fs.writeFile(path.join(dir, 'textures/grain.webp'), await sharp(await solid('png')).webp().toBuffer());
  const before = await fs.readFile(path.join(dir, 'tokens.json'), 'utf-8');
  const result = await convertThemeImages(dir);
  expect(result.errors).toEqual([expect.stringMatching(/grain\.png: would become textures\/grain\.webp/)]);
  expect(result.converted).toEqual({});
  expect(await exists('textures/grain.png')).toBe(true);
  expect(await exists('preview.png')).toBe(true);
  expect(await fs.readFile(path.join(dir, 'tokens.json'), 'utf-8')).toBe(before);
});

it('leaves an animated GIF alone and reports it', async () => {
  // Two 4×4 frames stacked in one raw image make a two-page GIF.
  const raw = Buffer.alloc(4 * 8 * 3, 0).fill(255, 48);
  const animated = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).gif().toBuffer();
  expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
  await fs.writeFile(path.join(dir, 'textures/spin.gif'), animated);

  const result = await convertThemeImages(dir);
  expect(result.skippedAnimated).toEqual(['textures/spin.gif']);
  expect(result.converted['textures/spin.gif']).toBeUndefined();
  expect((await fs.readFile(path.join(dir, 'textures/spin.gif'))).equals(animated)).toBe(true);
});
