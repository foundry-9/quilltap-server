/**
 * Text BLOB codec (lib/database/text-compression.ts).
 *
 * The load-bearing property is round-trip fidelity for arbitrary text, and
 * tolerance of every legacy shape a column may still hold.
 */
import { randomBytes } from 'crypto';
import {
  textToBlob,
  blobToText,
  isCompressedTextBlob,
  TEXT_COMPRESSION_MIN_BYTES,
  TEXT_BLOB_MAGIC,
  TEXT_BLOB_VERSION,
  TEXT_CODEC_BROTLI,
} from '@/lib/database/text-compression';

const long = (s: string) => s.repeat(Math.ceil((TEXT_COMPRESSION_MIN_BYTES * 4) / s.length));

describe('textToBlob / blobToText round trip', () => {
  it.each([
    ['ascii prose', long('The djinn of Istanbul waited by the bosphorus. ')],
    ['unicode + emoji', long('café — naïve — 日本語 — 🜁🜂🜃🜄 — Ω≈ç√∫ ')],
    ['json', long('{"role":"assistant","content":"well, quite."} ')],
    ['markdown with newlines', long('## Interchange 4\n\n*He bowed.*\n\n')],
    ['repeated whitespace', long('   \t  \n   ')],
  ])('round-trips %s byte-exactly', (_label, text) => {
    const stored = textToBlob(text);
    expect(Buffer.isBuffer(stored)).toBe(true);
    expect(blobToText(stored)).toBe(text);
  });

  it('shrinks compressible text substantially', () => {
    const text = long('the same clause over and over again, endlessly. ');
    const stored = textToBlob(text) as Buffer;
    expect(stored.length).toBeLessThan(Buffer.byteLength(text) / 2);
  });
});

describe('the size floor', () => {
  it('leaves short values as plain strings', () => {
    const text = 'x'.repeat(TEXT_COMPRESSION_MIN_BYTES - 1);
    const stored = textToBlob(text);
    expect(typeof stored).toBe('string');
    expect(stored).toBe(text);
    expect(blobToText(stored)).toBe(text);
  });

  it('compresses at exactly the floor', () => {
    const text = 'x'.repeat(TEXT_COMPRESSION_MIN_BYTES);
    expect(Buffer.isBuffer(textToBlob(text))).toBe(true);
  });

  it('measures the floor in BYTES, not characters', () => {
    // 200 four-byte emoji = 800 bytes, over the floor despite being 400 UTF-16
    // units and 200 code points.
    const text = '🜁'.repeat(200);
    expect(text.length).toBeLessThan(TEXT_COMPRESSION_MIN_BYTES);
    expect(Buffer.byteLength(text)).toBeGreaterThan(TEXT_COMPRESSION_MIN_BYTES);
    expect(Buffer.isBuffer(textToBlob(text))).toBe(true);
    expect(blobToText(textToBlob(text))).toBe(text);
  });

  it('never stores more bytes than the plain string would', () => {
    // High-entropy inputs are where a naive codec loses. Whatever it decides,
    // the stored form must never be larger than the text it replaces — and it
    // must still round-trip.
    const samples = [
      randomBytes(4096).toString('base64'),
      randomBytes(2048).toString('hex'),
      Array.from({ length: 2000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 95))).join(''),
    ];
    for (const text of samples) {
      const stored = textToBlob(text);
      const storedBytes = Buffer.isBuffer(stored) ? stored.length : Buffer.byteLength(stored);
      expect(storedBytes).toBeLessThanOrEqual(Buffer.byteLength(text));
      expect(blobToText(stored)).toBe(text);
    }
  });
});

describe('blobToText tolerates every legacy shape', () => {
  it('passes through a plain string', () => {
    expect(blobToText('already text')).toBe('already text');
  });

  it('reads an uncompressed Buffer as UTF-8', () => {
    expect(blobToText(Buffer.from('legacy plaintext row', 'utf-8'))).toBe('legacy plaintext row');
  });

  it('returns null for null and undefined', () => {
    expect(blobToText(null)).toBeNull();
    expect(blobToText(undefined)).toBeNull();
  });

  it('does not throw on a truncated compressed payload', () => {
    const stored = textToBlob(long('some compressible text ')) as Buffer;
    expect(() => blobToText(stored.subarray(0, 8))).not.toThrow();
  });

  it('treats an unknown version or codec byte as not-mine', () => {
    const stored = textToBlob(long('abc ')) as Buffer;
    const futureVersion = Buffer.from(stored);
    futureVersion[1] = TEXT_BLOB_VERSION + 1;
    expect(isCompressedTextBlob(futureVersion)).toBe(false);

    const futureCodec = Buffer.from(stored);
    futureCodec[2] = TEXT_CODEC_BROTLI + 1;
    expect(isCompressedTextBlob(futureCodec)).toBe(false);
  });

  it('does not mistake an embedding blob for compressed text', () => {
    const embedding = Buffer.from([0xeb, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    expect(isCompressedTextBlob(embedding)).toBe(false);
  });

  it('rejects a buffer too short to carry a header', () => {
    expect(isCompressedTextBlob(Buffer.from([TEXT_BLOB_MAGIC, TEXT_BLOB_VERSION]))).toBe(false);
    expect(isCompressedTextBlob(Buffer.alloc(0))).toBe(false);
  });
});
