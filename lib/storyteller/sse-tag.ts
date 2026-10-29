/**
 * Tag every SSE frame one concurrent storyteller turn writes.
 *
 * When a round runs "all at once", several turns share one SSE stream. Most
 * frames name their participant already, but content and status chunks do
 * not, so each concurrent turn writes through a wrapper that stamps
 * `participantId` and `concurrent: true` onto every `data:` frame. The Salon
 * keeps one streaming bubble per tagged participant.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Re-encode one chunk of `data: {json}\n\n` frames with the tag merged in. */
export function tagSseChunk(chunk: Uint8Array, participantId: string): Uint8Array {
  const text = decoder.decode(chunk);
  const tagged = text.replace(/^data: (.*)$/gm, (line, json: string) => {
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return line;
      return `data: ${JSON.stringify({ ...parsed, participantId: parsed.participantId ?? participantId, concurrent: true })}`;
    } catch {
      return line;
    }
  });
  return encoder.encode(tagged);
}

/** A controller that tags what it enqueues and forwards to `inner`. Closing it is a no-op. */
export function taggingController(
  inner: ReadableStreamDefaultController<Uint8Array>,
  participantId: string
): ReadableStreamDefaultController<Uint8Array> {
  return {
    get desiredSize() {
      return inner.desiredSize;
    },
    enqueue(chunk?: Uint8Array) {
      if (chunk) inner.enqueue(tagSseChunk(chunk, participantId));
    },
    close() {
      // The round owns the stream; one turn finishing must not end it.
    },
    error(reason?: unknown) {
      inner.error(reason);
    },
  };
}

/** A controller that discards everything — a bid streams nothing. */
export function sinkController(): ReadableStreamDefaultController<Uint8Array> {
  return {
    desiredSize: 1,
    enqueue() {},
    close() {},
    error() {},
  };
}
