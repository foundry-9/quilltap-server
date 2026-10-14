/**
 * Lossless-WebP re-encode gate (see lib/mount-index/blob-transcode.ts).
 *
 * Fixtures are generated with sharp rather than checked in, so the test
 * exercises the real RIFF chunk layouts sharp emits.
 */
import sharp from 'sharp';
import { createHash, randomBytes } from 'crypto';
import {
  isLosslessWebP,
  transcodeToWebP,
  LOSSLESS_WEBP_REENCODE_MIN_BYTES,
} from '@/lib/mount-index/blob-transcode';

/**
 * Cryptographic noise, so lossless WebP cannot compress the fixture down to a
 * trivial size — a regular pattern packs to ~1 KB and would never reach the
 * re-encode floor.
 */
function noisyImage(width: number, height: number) {
  return sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  });
}

describe('isLosslessWebP', () => {
  it('detects a lossless WebP', async () => {
    const buf = await (noisyImage(64, 64)).webp({ lossless: true }).toBuffer();
    expect(isLosslessWebP(buf)).toBe(true);
  });

  it('rejects a lossy WebP', async () => {
    const buf = await (noisyImage(64, 64)).webp({ quality: 80 }).toBuffer();
    expect(isLosslessWebP(buf)).toBe(false);
  });

  it('rejects a PNG, empty input and a truncated header', async () => {
    const png = await (noisyImage(16, 16)).png().toBuffer();
    expect(isLosslessWebP(png)).toBe(false);
    expect(isLosslessWebP(Buffer.alloc(0))).toBe(false);
    expect(isLosslessWebP(Buffer.from('RIFF....WEBPVP8L', 'ascii'))).toBe(false);
  });

  it('does not run off the end of a malformed chunk length', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WEBP', 'ascii'),
      Buffer.from('ICCP', 'ascii'),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(0xfffffff0); return b; })(),
    ]);
    expect(isLosslessWebP(buf)).toBe(false);
  });
});

describe('transcodeToWebP — already-WebP inputs', () => {
  it('re-encodes a large lossless WebP and shrinks it', async () => {
    const buf = await (noisyImage(1536, 1024)).webp({ lossless: true }).toBuffer();
    expect(buf.length).toBeGreaterThanOrEqual(LOSSLESS_WEBP_REENCODE_MIN_BYTES);

    const out = await transcodeToWebP(buf, 'image/webp');
    expect(out.storedMimeType).toBe('image/webp');
    expect(out.sizeBytes).toBeLessThan(buf.length);
    expect(isLosslessWebP(out.data)).toBe(false);
    expect(out.sha256).not.toBe(createHash('sha256').update(buf).digest('hex'));
  }, 30000);

  it('leaves a lossy WebP byte-identical', async () => {
    const buf = await (noisyImage(1536, 1024)).webp({ quality: 85 }).toBuffer();
    const out = await transcodeToWebP(buf, 'image/webp');
    expect(out.data.equals(buf)).toBe(true);
    expect(out.sizeBytes).toBe(buf.length);
  }, 30000);

  it('leaves a SMALL lossless WebP alone — below the size floor', async () => {
    const buf = await (noisyImage(32, 32)).webp({ lossless: true }).toBuffer();
    expect(buf.length).toBeLessThan(LOSSLESS_WEBP_REENCODE_MIN_BYTES);
    expect(isLosslessWebP(buf)).toBe(true);

    const out = await transcodeToWebP(buf, 'image/webp');
    expect(out.data.equals(buf)).toBe(true);
  });

  it('tolerates a MIME type carrying parameters or stray case', async () => {
    const png = await (noisyImage(64, 64)).png().toBuffer();
    const out = await transcodeToWebP(png, 'Image/PNG; charset=binary');
    expect(out.storedMimeType).toBe('image/webp');
  });
});
