/**
 * Stream controllers for Storyteller turns.
 *
 * When a round runs "all at once", several turns share one SSE stream. Each
 * concurrent turn writes through `seatedFrameEncoder(participantId)` (in
 * `lib/chat/stream-frames.ts`), which tags every frame with its seat before it
 * is encoded — the Salon keeps one streaming bubble per seat. The turn's
 * controller is wrapped by `sharedStreamController` so that one turn finishing
 * cannot close the stream the others are still writing to.
 */

/** A controller that forwards to `inner`. Closing it is a no-op: the round owns the stream. */
export function sharedStreamController(
  inner: ReadableStreamDefaultController<Uint8Array>
): ReadableStreamDefaultController<Uint8Array> {
  return {
    get desiredSize() {
      return inner.desiredSize;
    },
    enqueue(chunk?: Uint8Array) {
      if (chunk) inner.enqueue(chunk);
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
