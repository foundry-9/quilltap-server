/**
 * NDJSON import reader (qtap-ndjson v1).
 *
 * Two responsibilities:
 *  1. Detect whether a `.qtap` file is streaming NDJSON (v1) or the legacy
 *     monolithic JSON format, without consuming the whole stream.
 *  2. Parse NDJSON line-by-line from a Web `ReadableStream<Uint8Array>`
 *     without ever holding more than one record plus a partial-line buffer
 *     in memory.
 *
 * The format-detection contract is intentionally forgiving: we look at a
 * small byte prefix and check for the `"format":"qtap-ndjson"` marker that
 * the writer guarantees to emit on line 1. Legacy files carry
 * `"format":"quilltap-export"` instead, so the prefixes never collide.
 */

import { logger as baseLogger } from '@/lib/logger';

const logger = baseLogger.child({ module: 'import:ndjson-reader' });

/**
 * Bytes read for format detection. The envelope line is well under 2 KB in
 * every realistic case (the manifest has at most ~20 short fields). We read
 * up to this many bytes before deciding.
 */
const PEEK_BYTES = 2048;

/**
 * Per-line safety cap. A malformed file with no newlines shouldn't be able
 * to balloon the accumulator past this size — if a single line grows larger,
 * we abort rather than ask V8 for a huge string. Also defends the reader
 * from a pathological blob chunk whose encoder went wrong.
 */
const MAX_LINE_BYTES = 128 * 1024 * 1024;

export type QtapFormatKind = 'ndjson' | 'legacy';

export interface DetectedFormat {
  format: QtapFormatKind;
  /**
   * A fresh stream that yields the original bytes (peeked bytes + everything
   * still buffered behind the reader). Hand this to {@link readNdjsonLines}
   * or to a legacy byte-accumulator — the caller doesn't need to know which
   * bytes came from the peek and which from the underlying reader.
   */
  stream: ReadableStream<Uint8Array>;
}

/**
 * Peek enough bytes from `body` to decide whether it's NDJSON or legacy.
 * Returns a new ReadableStream that re-emits the peeked bytes followed by
 * the rest of the original stream.
 */
export async function peekFormat(
  body: ReadableStream<Uint8Array>
): Promise<DetectedFormat> {
  const reader = body.getReader();
  const peeked: Uint8Array[] = [];
  let peekedTotal = 0;

  while (peekedTotal < PEEK_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    peeked.push(value);
    peekedTotal += value.byteLength;
  }

  const prefix = concatBytes(peeked).subarray(
    0,
    Math.min(peekedTotal, PEEK_BYTES)
  );
  const prefixText = new TextDecoder('utf-8', { fatal: false }).decode(prefix);

  const format: QtapFormatKind = /"format"\s*:\s*"qtap-ndjson"/.test(prefixText)
    ? 'ndjson'
    : 'legacy';

  // Rebuild a stream that starts with the peeked chunks, then drains the
  // original reader. The reader is still live — we just took some bytes off
  // the front and now re-prepend them.
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (peeked.length > 0) {
        controller.enqueue(peeked.shift()!);
        return;
      }
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value) controller.enqueue(value);
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        // best-effort
      }
    },
  });

  return { format, stream };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Read an NDJSON stream and yield one parsed JSON value per line.
 *
 * Works at the byte level so we never split multi-byte UTF-8 sequences
 * across the decoder boundary: we find the `\n` byte in the accumulated
 * buffer and only decode the slice up to it.
 *
 * Empty lines (including a trailing newline at EOF) are skipped silently.
 * Lines that fail to parse throw `Error` with a short excerpt so the caller
 * can report line-accurate failures.
 */
export async function* readNdjsonLines(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  let lineNumber = 0;

  const decode = (slice: Uint8Array): string =>
    new TextDecoder('utf-8').decode(slice);

  while (true) {
    const { value, done } = await reader.read();

    if (value && value.byteLength > 0) {
      // Append without copying more than necessary.
      buf = concatBytes([buf, value]);
    }

    // Drain complete lines from the buffer.
    while (true) {
      const nl = indexOfByte(buf, 0x0a);
      if (nl < 0) break;

      const lineSlice = buf.subarray(0, nl);
      buf = buf.subarray(nl + 1);
      lineNumber++;

      // Strip optional trailing \r (CRLF files).
      const trimmed =
        lineSlice.byteLength > 0 &&
        lineSlice[lineSlice.byteLength - 1] === 0x0d
          ? lineSlice.subarray(0, lineSlice.byteLength - 1)
          : lineSlice;

      if (trimmed.byteLength === 0) continue; // blank line

      const text = decode(trimmed);
      try {
        yield JSON.parse(text);
      } catch (err) {
        const excerpt = text.length > 120 ? `${text.slice(0, 117)}...` : text;
        throw new Error(
          `Invalid NDJSON on line ${lineNumber}: ${(err as Error).message} (near: ${excerpt})`
        );
      }
    }

    if (buf.byteLength > MAX_LINE_BYTES) {
      throw new Error(
        `NDJSON line exceeded ${MAX_LINE_BYTES} bytes without a newline — file is malformed`
      );
    }

    if (done) break;
  }

  // Flush any trailing content with no terminating newline.
  if (buf.byteLength > 0) {
    lineNumber++;
    const trimmed =
      buf[buf.byteLength - 1] === 0x0d
        ? buf.subarray(0, buf.byteLength - 1)
        : buf;
    if (trimmed.byteLength > 0) {
      const text = decode(trimmed);
      try {
        yield JSON.parse(text);
      } catch (err) {
        const excerpt = text.length > 120 ? `${text.slice(0, 117)}...` : text;
        throw new Error(
          `Invalid NDJSON on final line ${lineNumber}: ${(err as Error).message} (near: ${excerpt})`
        );
      }
    }
  }
}

function indexOfByte(buf: Uint8Array, byte: number): number {
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] === byte) return i;
  }
  return -1;
}

/**
 * Accumulate a legacy-format `.qtap` file into a single string. Only used
 * for the backward-compat path — for huge legacy files this still hits the
 * V8 string ceiling, which we surface as an explicit error.
 */
export async function collectLegacyJson(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(
        `Legacy .qtap file exceeds ${maxBytes} bytes — re-export from a newer Quilltap version to get the streaming format`
      );
    }
    chunks.push(value);
  }

  const merged = concatBytes(chunks);
  return new TextDecoder('utf-8').decode(merged);
}
