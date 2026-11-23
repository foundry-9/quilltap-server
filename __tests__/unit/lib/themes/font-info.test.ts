/**
 * @jest-environment node
 *
 * Reading a font (Calliope Live, Spec F decision 1) and encoding one as WOFF2
 * (decision 2). The fonts are the repository's own: Lora Bold Italic (static)
 * from Madman's Box and Rethink Sans (variable, `wght`) from the version 2
 * fixture, each also decoded to TrueType here.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { decompress } from 'wawoff2';
import { fontExtensionMatches, guessFontFromFileName, readFontInfo, sniffFontFormat } from '@/lib/themes/font-info';
import { encodeWoff2 } from '@/lib/themes/convert-fonts';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const STATIC = path.join(REPO_ROOT, 'themes/bundled/madmans-box/fonts/Lora-BoldItalic.woff2');
const VARIABLE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample/fonts/RethinkSans-latin-ext.woff2');

describe('sniffing', () => {
  it('names the format from the leading bytes', () => {
    expect(sniffFontFormat(Buffer.from('wOF2rest'))).toBe('woff2');
    expect(sniffFontFormat(Buffer.from('wOFFrest'))).toBe('woff');
    expect(sniffFontFormat(Buffer.from('OTTOrest'))).toBe('otf');
    expect(sniffFontFormat(Buffer.from([0, 1, 0, 0, 9]))).toBe('ttf');
    expect(sniffFontFormat(Buffer.from('<svg'))).toBeNull();
    expect(sniffFontFormat(Buffer.from('ab'))).toBeNull();
  });

  it('lets .ttf and .otf carry either SFNT signature, and holds WOFF to its own', () => {
    expect(fontExtensionMatches('.otf', 'ttf')).toBe(true);
    expect(fontExtensionMatches('.TTF', 'otf')).toBe(true);
    expect(fontExtensionMatches('.woff', 'woff2')).toBe(false);
    expect(fontExtensionMatches('.woff2', 'woff2')).toBe(true);
    expect(fontExtensionMatches('.ttf', 'woff')).toBe(false);
  });
});

describe('readFontInfo', () => {
  it('reads a static font', async () => {
    const read = readFontInfo(await fs.readFile(STATIC));
    expect(read).toMatchObject({ ok: true, info: { format: 'woff2', family: 'Lora', weight: '700', style: 'italic', variable: false, axes: [] } });
  });

  it('reads a variable font as its wght range', async () => {
    const read = readFontInfo(await fs.readFile(VARIABLE));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.info).toMatchObject({ family: 'Rethink Sans', style: 'normal', variable: true });
    expect(read.info.axes).toContain('wght');
    expect(read.info.weight).toMatch(/^[1-9]00 [1-9]00$/);
  });

  it('reads the TrueType a WOFF2 decodes to the same way', async () => {
    const ttf = Buffer.from(await decompress(await fs.readFile(STATIC)));
    expect(readFontInfo(ttf)).toMatchObject({ ok: true, info: { format: 'ttf', family: 'Lora', weight: '700', style: 'italic' } });
  });

  it('fails, without throwing, on a file that is not a font', () => {
    expect(readFontInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ok: false, format: null, reason: expect.any(String) });
    // A font's leading bytes over nonsense: the format is known, the parse fails.
    expect(readFontInfo(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 7)]))).toMatchObject({ ok: false, format: 'woff2' });
  });
});

describe('guessFontFromFileName', () => {
  it.each([
    ['Lora-Bold.ttf', { family: 'Lora', weight: '700', style: 'normal', variable: false }],
    ['Lora-BoldItalic.woff2', { family: 'Lora', weight: '700', style: 'italic', variable: false }],
    ['PlayfairDisplay-ExtraBold.otf', { family: 'Playfair Display', weight: '800', style: 'normal' }],
    ['Inter-SemiBold.woff', { family: 'Inter', weight: '600' }],
    ['Inter_Thin.ttf', { family: 'Inter', weight: '100' }],
    ['Inter-ExtraLight.ttf', { family: 'Inter', weight: '200' }],
    ['Inter-Light.ttf', { family: 'Inter', weight: '300' }],
    ['Inter-Regular.ttf', { family: 'Inter', weight: '400' }],
    ['Inter-Medium.ttf', { family: 'Inter', weight: '500' }],
    ['Inter-Black.ttf', { family: 'Inter', weight: '900' }],
    ['Courier-Oblique.ttf', { family: 'Courier', style: 'oblique' }],
    ['Inter[wght].ttf', { family: 'Inter', weight: '100 900', variable: true }],
    ['Inter[wght=200..800].ttf', { family: 'Inter', weight: '200 800', variable: true }],
    ['Inter-Italic[wght,slnt].ttf', { family: 'Inter', style: 'italic', variable: true }],
    ['RobotoFlex-Variable.woff2', { family: 'Roboto Flex', weight: '100 900', variable: true }],
    ['Lora Bold.ttf', { family: 'Lora', weight: '700' }],
    ['Garamond.ttf', { family: 'Garamond', weight: '400', style: 'normal', variable: false }],
  ])('%s', (name, expected) => {
    expect(guessFontFromFileName(name)).toMatchObject(expected);
  });
});

describe('encodeWoff2', () => {
  it('turns a TrueType font into a WOFF2 that reads back as the same font, axes and all', async () => {
    for (const file of [STATIC, VARIABLE]) {
      const original = await fs.readFile(file);
      const ttf = Buffer.from(await decompress(original));
      const woff2 = await encodeWoff2(ttf);
      expect(sniffFontFormat(woff2)).toBe('woff2');
      const before = readFontInfo(ttf);
      const after = readFontInfo(woff2);
      expect(before.ok && after.ok).toBe(true);
      if (before.ok && after.ok) {
        expect(after.info).toMatchObject({ family: before.info.family, weight: before.info.weight, axes: before.info.axes });
      }
    }
  });

  it('refuses something that is not an uncompressed font', async () => {
    await expect(encodeWoff2(Buffer.from('not a font at all'))).rejects.toThrow();
  });
});
