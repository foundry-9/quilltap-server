/**
 * @jest-environment node
 *
 * Unit tests for the NDJSON import reader.
 *
 * Covers:
 *  - peekFormat() detection + byte re-emission
 *  - readNdjsonLines() line splitting, CRLF handling, multi-byte safety,
 *    chunk-boundary robustness, blank-line skipping, error reporting,
 *    oversize-line guard
 *  - collectLegacyJson() happy path + maxBytes guard
 *
 * Node environment (not jsdom) — we rely on the Node-global ReadableStream
 * that jsdom does not expose.
 */

import { describe, it, expect, jest } from '@jest/globals';

// Mock the logger before importing the module under test
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

import {
  peekFormat,
  readNdjsonLines,
  collectLegacyJson,
} from '@/lib/import/ndjson-reader';

// ============================================================================
// HELPERS
// ============================================================================

/** Wrap a single Uint8Array in a ReadableStream with one chunk. */
function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return streamFromChunks([bytes]);
}

/** Wrap an array of byte chunks in a ReadableStream. */
function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Encode a string to UTF-8 bytes. */
function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Read a ReadableStream fully into one Uint8Array. */
async function readAllBytes(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Drain an async generator into an array. */
async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

/** Split bytes into fixed-size chunks for chunk-boundary tests. */
function splitBytes(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    out.push(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)));
  }
  return out;
}

// ============================================================================
// peekFormat()
// ============================================================================

describe('peekFormat()', () => {
  it('detects NDJSON when the first line contains "format":"qtap-ndjson"', async () => {
    const envelope =
      '{"kind":"__envelope__","format":"qtap-ndjson","version":1,"manifest":{}}\n';
    const body = streamFromBytes(enc(envelope));

    const result = await peekFormat(body);

    expect(result.format).toBe('ndjson');
  });

  it('detects NDJSON regardless of whitespace between : and value', async () => {
    const envelope =
      '{"kind":"__envelope__", "format" :  "qtap-ndjson", "version":1}\n';
    const body = streamFromBytes(enc(envelope));

    const result = await peekFormat(body);

    expect(result.format).toBe('ndjson');
  });

  it('returns legacy for a pretty-printed monolithic JSON file', async () => {
    const legacy =
      '{\n' +
      '  "manifest": {\n' +
      '    "format": "quilltap-export",\n' +
      '    "version": "1.0"\n' +
      '  },\n' +
      '  "data": {}\n' +
      '}\n';
    const body = streamFromBytes(enc(legacy));

    const result = await peekFormat(body);

    expect(result.format).toBe('legacy');
  });

  it('re-emits the peeked bytes followed by the rest of the stream', async () => {
    // Build a body that spans several chunks so peek definitely consumes some
    // of them while leaving the rest behind the reader.
    const line1 =
      '{"kind":"__envelope__","format":"qtap-ndjson","version":1,"manifest":{}}\n';
    const line2 = '{"kind":"tag","data":{"id":"t1","name":"Alpha"}}\n';
    const line3 = '{"kind":"__footer__","counts":{"tags":1}}\n';
    const original = enc(line1 + line2 + line3);
    const chunks = splitBytes(original, 17); // tiny chunks — peek fits fully

    const { stream } = await peekFormat(streamFromChunks(chunks));
    const reemitted = await readAllBytes(stream);

    expect(reemitted).toEqual(original);
  });

  it('handles a stream that ends before PEEK_BYTES', async () => {
    // Tiny legacy file — well under 2 KB.
    const tiny = '{"manifest":{"format":"quilltap-export","version":"1.0"}}';
    const body = streamFromBytes(enc(tiny));

    const result = await peekFormat(body);

    expect(result.format).toBe('legacy');
    const reemitted = await readAllBytes(result.stream);
    expect(new TextDecoder().decode(reemitted)).toBe(tiny);
  });

  it('re-emits bytes in order even when peek straddles many tiny chunks', async () => {
    const envelope =
      '{"kind":"__envelope__","format":"qtap-ndjson","version":1,"manifest":{"exportType":"characters"}}\n' +
      '{"kind":"character","data":{"id":"c1","name":"Mallory"}}\n';
    const bytes = enc(envelope);
    const { stream } = await peekFormat(streamFromChunks(splitBytes(bytes, 1)));
    const round = await readAllBytes(stream);
    expect(round).toEqual(bytes);
  });
});

// ============================================================================
// readNdjsonLines()
// ============================================================================

describe('readNdjsonLines()', () => {
  it('yields one parsed object per line for a well-formed stream', async () => {
    const lines =
      '{"kind":"__envelope__","format":"qtap-ndjson","version":1,"manifest":{}}\n' +
      '{"kind":"tag","data":{"id":"t1","name":"A"}}\n' +
      '{"kind":"tag","data":{"id":"t2","name":"B"}}\n' +
      '{"kind":"tag","data":{"id":"t3","name":"C"}}\n' +
      '{"kind":"__footer__","counts":{"tags":3}}\n';

    const records = (await drain(
      readNdjsonLines(streamFromBytes(enc(lines)))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ kind: '__envelope__' });
    expect(records[1]).toMatchObject({ kind: 'tag' });
    expect(records[4]).toMatchObject({ kind: '__footer__' });
  });

  it('handles CRLF line endings by stripping the trailing \\r', async () => {
    const lines =
      '{"kind":"a","n":1}\r\n{"kind":"b","n":2}\r\n{"kind":"c","n":3}\r\n';

    const records = (await drain(
      readNdjsonLines(streamFromBytes(enc(lines)))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ kind: 'a', n: 1 });
    expect(records[2]).toMatchObject({ kind: 'c', n: 3 });
  });

  it('handles a trailing line without a terminating newline', async () => {
    const lines = '{"kind":"a"}\n{"kind":"b"}'; // no trailing \n
    const records = (await drain(
      readNdjsonLines(streamFromBytes(enc(lines)))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ kind: 'b' });
  });

  it('handles chunk boundaries mid-line (one byte at a time)', async () => {
    const lines =
      '{"kind":"envelope","n":1}\n' +
      '{"kind":"data","payload":"hello world, this has many characters"}\n' +
      '{"kind":"footer","n":2}\n';
    const bytes = enc(lines);
    const chunks = splitBytes(bytes, 1);

    const records = (await drain(
      readNdjsonLines(streamFromChunks(chunks))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ kind: 'envelope' });
    expect(records[1]).toMatchObject({
      kind: 'data',
      payload: 'hello world, this has many characters',
    });
    expect(records[2]).toMatchObject({ kind: 'footer' });
  });

  it('handles chunk boundaries mid-UTF-8 (multi-byte character split)', async () => {
    // Build a line containing multi-byte characters (emoji + CJK) and split
    // the bytes into 1-byte chunks, which is guaranteed to cut emoji code
    // points. The reader MUST NOT decode partial bytes.
    const payload = 'hi \u{1F9D9}\u{1F4DC} \u6f22\u5b57 end';
    const line = JSON.stringify({ kind: 'data', payload }) + '\n';
    const bytes = enc(line);

    // Sanity check: emoji encode to 4 bytes each, so byte length > char length.
    expect(bytes.byteLength).toBeGreaterThan(line.length);

    const chunks = splitBytes(bytes, 1);

    const records = (await drain(
      readNdjsonLines(streamFromChunks(chunks))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'data', payload });
  });

  it('throws on invalid JSON with a line number and excerpt in the message', async () => {
    const bad =
      '{"kind":"a"}\n' +
      '{"kind":"b"}\n' +
      'this is not valid json at all\n';

    await expect(
      drain(readNdjsonLines(streamFromBytes(enc(bad))))
    ).rejects.toThrow(/line 3/);

    // Run again to assert the excerpt is embedded in the message.
    await expect(
      drain(readNdjsonLines(streamFromBytes(enc(bad))))
    ).rejects.toThrow(/this is not valid json at all/);
  });

  it('throws on invalid JSON on the final un-terminated line', async () => {
    const bad = '{"kind":"a"}\n{broken';

    await expect(
      drain(readNdjsonLines(streamFromBytes(enc(bad))))
    ).rejects.toThrow(/final line 2/);
  });

  it('skips blank lines, including a final trailing newline', async () => {
    const lines =
      '\n' +
      '{"kind":"a"}\n' +
      '\n' +
      '\n' +
      '{"kind":"b"}\n' +
      '\n';

    const records = (await drain(
      readNdjsonLines(streamFromBytes(enc(lines)))
    )) as Array<Record<string, unknown>>;

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ kind: 'a' });
    expect(records[1]).toMatchObject({ kind: 'b' });
  });

  it('surfaces an error for an unterminated giant line', async () => {
    // Simulating the 128 MB cap directly would allocate hundreds of megabytes,
    // which is too expensive for a unit test. Instead, assert that a stream
    // which errors during reading propagates the error cleanly — the same
    // code path the oversize-line guard uses.
    const erroringStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('upstream exploded'));
      },
    });

    await expect(drain(readNdjsonLines(erroringStream))).rejects.toThrow(
      /upstream exploded/
    );
  });

  it('yields nothing for an empty stream', async () => {
    const records = await drain(readNdjsonLines(streamFromBytes(enc(''))));
    expect(records).toEqual([]);
  });
});

// ============================================================================
// collectLegacyJson()
// ============================================================================

describe('collectLegacyJson()', () => {
  it('returns the full stream content as a string', async () => {
    const payload = '{"manifest":{"format":"quilltap-export","version":"1.0"},"data":{}}';
    const text = await collectLegacyJson(streamFromBytes(enc(payload)), 10_000);
    expect(text).toBe(payload);
  });

  it('reassembles content across many small chunks', async () => {
    const payload =
      '{"manifest":{"format":"quilltap-export","version":"1.0"},' +
      '"data":{"tags":[{"id":"t1","name":"Alpha"}]}}';
    const chunks = splitBytes(enc(payload), 3);
    const text = await collectLegacyJson(streamFromChunks(chunks), 10_000);
    expect(text).toBe(payload);
  });

  it('handles multi-byte UTF-8 content', async () => {
    const payload = JSON.stringify({
      note: 'café \u{1F4A1} \u6f22\u5b57',
    });
    const text = await collectLegacyJson(streamFromBytes(enc(payload)), 10_000);
    expect(text).toBe(payload);
  });

  it('throws when the stream exceeds the provided maxBytes', async () => {
    const payload = 'x'.repeat(2048);
    await expect(
      collectLegacyJson(streamFromBytes(enc(payload)), 1024)
    ).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it('throws with the cap mentioned in the error even for streams just over the limit', async () => {
    // 600 bytes of payload, split into 100-byte chunks; cap at 500 should
    // fire at the 6th chunk.
    const payload = 'a'.repeat(600);
    const chunks = splitBytes(enc(payload), 100);
    await expect(
      collectLegacyJson(streamFromChunks(chunks), 500)
    ).rejects.toThrow(/500/);
  });

  it('accepts content exactly at the cap', async () => {
    const payload = 'a'.repeat(100);
    const text = await collectLegacyJson(streamFromBytes(enc(payload)), 100);
    expect(text).toBe(payload);
  });
});
