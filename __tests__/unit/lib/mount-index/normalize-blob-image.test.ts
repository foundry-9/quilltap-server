/**
 * The write-side image chokepoint (lib/mount-index/normalize-blob-image.ts).
 *
 * The point of these tests is that a caller CANNOT opt out by accident: the
 * default normalizes, and the row's mime/path/name are dragged along with the
 * bytes so they can never disagree.
 */
import sharp from 'sharp';
import { randomBytes } from 'crypto';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import {
  normalizeLinkBlobImage,
  type NormalizableBlobInput,
} from '@/lib/mount-index/normalize-blob-image';

function noisy(width: number, height: number) {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  });
}

function inputFor(data: Buffer, mime: string, path: string): NormalizableBlobInput {
  return {
    relativePath: path,
    fileName: path.split('/').pop()!,
    originalMimeType: mime,
    storedMimeType: mime,
    sha256: sha256OfBuffer(data),
    data,
  };
}

describe('normalizeLinkBlobImage', () => {
  it('transcodes a PNG and drags mime, path, name and hash along with it', async () => {
    const png = await noisy(256, 256).png().toBuffer();
    const out = await normalizeLinkBlobImage(inputFor(png, 'image/png', 'photos/avatar.png'));

    expect(out.storedMimeType).toBe('image/webp');
    expect(out.relativePath).toBe('photos/avatar.webp');
    expect(out.fileName).toBe('avatar.webp');
    expect(out.data.length).toBeLessThan(png.length);
    expect(out.sha256).toBe(sha256OfBuffer(out.data));
  }, 30000);

  it('re-encodes a large lossless WebP without renaming it', async () => {
    const webp = await noisy(1536, 1024).webp({ lossless: true }).toBuffer();
    const out = await normalizeLinkBlobImage(
      inputFor(webp, 'image/webp', 'story-backgrounds/bg.webp'),
    );

    expect(out.storedMimeType).toBe('image/webp');
    expect(out.relativePath).toBe('story-backgrounds/bg.webp');
    expect(out.fileName).toBe('bg.webp');
    expect(out.data.length).toBeLessThan(webp.length);
    expect(out.sha256).toBe(sha256OfBuffer(out.data));
  }, 30000);

  it('leaves a lossy WebP completely untouched', async () => {
    const webp = await noisy(512, 512).webp({ quality: 85 }).toBuffer();
    const input = inputFor(webp, 'image/webp', 'photos/x.webp');
    const out = await normalizeLinkBlobImage(input);
    expect(out).toBe(input);
  }, 30000);

  it('leaves non-image bytes untouched', async () => {
    const pdf = Buffer.from('%PDF-1.7\nnot really a pdf');
    const input = inputFor(pdf, 'application/pdf', 'docs/report.pdf');
    const out = await normalizeLinkBlobImage(input);
    expect(out).toBe(input);
    expect(out.storedMimeType).toBe('application/pdf');
  });

  it('honours normalizeImages: false for byte-fidelity restores', async () => {
    const png = await noisy(256, 256).png().toBuffer();
    const input = { ...inputFor(png, 'image/png', 'photos/a.png'), normalizeImages: false };
    const out = await normalizeLinkBlobImage(input);
    expect(out).toBe(input);
    expect(out.data.equals(png)).toBe(true);
    expect(out.storedMimeType).toBe('image/png');
  }, 30000);

  it('normalizes by DEFAULT — an omitted flag must not mean "skip"', async () => {
    const png = await noisy(128, 128).png().toBuffer();
    const input = inputFor(png, 'image/png', 'a.png');
    expect(input.normalizeImages).toBeUndefined();
    const out = await normalizeLinkBlobImage(input);
    expect(out.storedMimeType).toBe('image/webp');
  }, 30000);
});
