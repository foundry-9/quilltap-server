/**
 * The Green Room narrator that speaks into a Salon stream: every narration is
 * one `greenRoom` frame, written through `encodeFrame` (never hand-spelt) and
 * enqueued with `safeEnqueue`, so a stream the operator has closed swallows
 * the rest of the opening's narration without failing the opening.
 *
 * Server-only.
 *
 * @module chat/opening/narrator-frames
 */

import { encodeFrame, type GreenRoomEvent } from '@/lib/chat/stream-frames'
import { safeClose, safeEnqueue } from '@/lib/services/chat-message/streaming.service'
import type { GreenRoomNarrator } from './narrator'

/** A narrator that writes `greenRoom` frames onto one open stream. */
export function frameNarrator(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): GreenRoomNarrator {
  const say = (greenRoom: GreenRoomEvent) => {
    safeEnqueue(controller, encodeFrame(encoder, { kind: 'greenRoom', greenRoom }))
  }
  return {
    phase: (key, label) => say({ event: 'phase', key, label }),
    status: (message) => say({ event: 'status', message }),
    log: (message, level = 'info') => say({ event: 'log', message, level }),
    wardrobeStart: (characterId, characterName) => say({ event: 'wardrobeStart', characterId, characterName }),
    wardrobeResult: (characterId, characterName, slots) =>
      say({ event: 'wardrobeResult', characterId, characterName, slots }),
    inventory: (characterId, characterName, items) => say({ event: 'inventory', characterId, characterName, items }),
    done: () => say({ event: 'done' }),
  }
}

/**
 * A stream that carries only the Green Room's narration of `body` — a join
 * the operator is watching (`?action=add-participant` with `narrate: true`).
 * Always ends with the `done` event, failure or not.
 */
export function openNarrationStream(
  body: (narrator: GreenRoomNarrator) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const narrator = frameNarrator(controller, encoder)
      try {
        await body(narrator)
      } catch (error) {
        narrator.log(error instanceof Error ? error.message : 'Something went wrong backstage.', 'error')
      }
      narrator.done()
      safeClose(controller)
    },
  })
}
