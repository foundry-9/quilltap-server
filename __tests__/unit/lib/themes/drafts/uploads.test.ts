/**
 * @jest-environment node
 *
 * What an upload into a theme draft may be, and where it goes (Calliope
 * Live, Spec F decisions 8 and 9).
 */

import {
  DRAFT_LIMITS,
  DraftUploadRefusedError,
  checkUploadContent,
  checkUploadLimits,
  looksLikeSvg,
  safeStem,
  sniffRasterFormat,
  storedUploadPath,
} from '@/lib/themes/drafts/uploads';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<!-- drawn -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(16)]);
const TTF = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(16)]);

const refused = (run: () => unknown, pattern: RegExp, reason: 'content' | 'limit' = 'content') => {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(DraftUploadRefusedError);
    expect((e as Error).message).toMatch(pattern);
    expect((e as DraftUploadRefusedError).reason).toBe(reason);
    return;
  }
  throw new Error('expected a refusal');
};

describe('content', () => {
  it('sniffs raster images and SVG documents', () => {
    expect(sniffRasterFormat(PNG)).toBe('png');
    expect(sniffRasterFormat(JPEG)).toBe('jpeg');
    expect(sniffRasterFormat(WEBP)).toBe('webp');
    expect(sniffRasterFormat(SVG)).toBeNull();
    expect(looksLikeSvg(SVG)).toBe(true);
    expect(looksLikeSvg(Buffer.from('<html><svg></svg></html>'))).toBe(false);
  });

  it('accepts a file whose extension and bytes agree, and normalises .jpeg', () => {
    expect(checkUploadContent('font', 'Lora.woff2', WOFF2)).toBe('.woff2');
    expect(checkUploadContent('font', 'Lora.OTF', TTF)).toBe('.otf');
    expect(checkUploadContent('image', 'photo.jpeg', JPEG)).toBe('.jpg');
    expect(checkUploadContent('icon', 'sun.svg', SVG)).toBe('.svg');
    expect(checkUploadContent('licence', 'OFL.txt', Buffer.from('SIL Open Font License'))).toBe('.txt');
  });

  it('refuses an extension that does not match the bytes', () => {
    refused(() => checkUploadContent('font', 'Lora.woff', WOFF2), /WOFF2 font, not \.woff/);
    refused(() => checkUploadContent('font', 'Lora.ttf', PNG), /does not begin like a font/);
    refused(() => checkUploadContent('image', 'paper.png', WEBP), /WEBP image, not \.png/);
    refused(() => checkUploadContent('image', 'paper.svg', PNG), /not an SVG document/);
    refused(() => checkUploadContent('licence', 'OFL.txt', Buffer.from([0x41, 0, 0x42])), /plain text/);
  });

  it('refuses an extension the kind does not take', () => {
    refused(() => checkUploadContent('icon', 'sun.png', PNG), /\.svg, \.webp/);
    refused(() => checkUploadContent('font', 'evil.js', Buffer.from('alert(1)')), /\.woff2/);
    refused(() => checkUploadContent('image', 'noext', PNG), /must be/);
    refused(() => checkUploadContent('image', 'empty.png', Buffer.alloc(0)), /empty/);
  });
});

describe('stored names', () => {
  it('makes a name safe for a bundle path', () => {
    expect(safeStem('Café Noir (Bold).ttf')).toBe('Cafe-Noir-Bold');
    expect(safeStem('../../etc/passwd')).toBe('passwd');
    expect(safeStem('C:\\Fonts\\.hidden.woff2')).toBe('hidden');
    expect(safeStem('???.png')).toBe('file');
    expect(safeStem(`${'a'.repeat(200)}.png`)).toHaveLength(80);
  });

  it('stores in the kind\'s folder, with a suffix on a collision compared without case', () => {
    expect(storedUploadPath('font', 'Lora Bold.ttf', '.ttf', [])).toBe('fonts/Lora-Bold.ttf');
    expect(storedUploadPath('licence', 'OFL.txt', '.txt', [])).toBe('fonts/OFL.txt');
    expect(storedUploadPath('image', 'paper.png', '.png', ['images/paper.png'])).toBe('images/paper-2.png');
    expect(storedUploadPath('image', 'Paper.png', '.png', ['images/paper.png', 'images/PAPER-2.png'])).toBe('images/Paper-3.png');
    expect(storedUploadPath('icon', 'sun.svg', '.svg', [])).toBe('icons/sun.svg');
  });
});

describe('limits', () => {
  it('refuses a file over the per-file limit', () => {
    refused(() => checkUploadLimits('big.png', DRAFT_LIMITS.fileBytes + 1, []), /larger than/, 'limit');
  });

  it('refuses a file that would take the draft past the file count or the total', () => {
    const many = Array.from({ length: DRAFT_LIMITS.files }, (_, i) => ({ path: `f${i}`, size: 1 }));
    refused(() => checkUploadLimits('one.png', 1, many), /already holds/, 'limit');
    const heavy = Array.from({ length: 5 }, (_, i) => ({ path: `h${i}`, size: DRAFT_LIMITS.fileBytes }));
    refused(() => checkUploadLimits('more.png', DRAFT_LIMITS.fileBytes, heavy), /would come to/, 'limit');
  });

  it('does not count the file being replaced', () => {
    const many = Array.from({ length: DRAFT_LIMITS.files }, (_, i) => ({ path: `f${i}`, size: 1 }));
    expect(() => checkUploadLimits('f3', 1, many, 'f3')).not.toThrow();
  });
});
