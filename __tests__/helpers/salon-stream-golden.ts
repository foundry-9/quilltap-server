/**
 * The golden Salon streams (refactor 4.12, stream frames).
 *
 * `__tests__/fixtures/salon-stream/*.legacy.json` were recorded from the
 * pre-4.12 encoders — the untagged-bag wire shape — before the stream became a
 * tagged union. `fromLegacyBag` is the one-time translator from that shape to
 * a `StreamFrame`; the golden tests replay the translated streams through the
 * client and assert `toLegacyBag` reproduces every recorded bag exactly.
 */

import * as fs from 'fs'
import * as path from 'path'
import { StreamFrameSchema, type DoneFrame, type DoneOutcome, type StreamFrame } from '@/lib/chat/stream-frames'

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'salon-stream')

export const GOLDEN_STREAMS = [
  'plain-reply',
  'tool-reply',
  'storyteller-concurrent-hand',
  'courier-external',
  'failures',
  'swipe',
  'opening',
] as const
export type GoldenStream = (typeof GOLDEN_STREAMS)[number]

export function loadLegacyStream(name: GoldenStream): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.legacy.json`), 'utf8'))
}

/** The golden stream as frames. */
export function loadFrameStream(name: GoldenStream): StreamFrame[] {
  return loadLegacyStream(name).map(fromLegacyBag)
}

/** `data: …` SSE text for a list of wire payloads. */
export function sseText(payloads: unknown[]): string {
  return payloads.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('')
}

function outcomeOf(bag: Record<string, unknown>): DoneOutcome {
  if (bag.stopped) return 'stopped'
  if (bag.yielded) return 'yielded'
  if (bag.skipped) return 'skipped'
  if (bag.emptyResponse) return 'empty'
  return 'finished'
}

/**
 * Translate one recorded untagged bag into the frame it means. The result is
 * parsed through the schema, which both validates the fixture and drops the
 * `participantId` a concurrent tag put on frames that have none of their own.
 */
export function fromLegacyBag(input: Record<string, unknown>): StreamFrame {
  const { concurrent, ...bag } = input as Record<string, unknown> & { concurrent?: boolean }
  const frame = translate(bag)
  return StreamFrameSchema.parse(
    concurrent ? { ...frame, seat: { participantId: bag.participantId as string, concurrent: true } } : frame
  )
}

function strip<T extends Record<string, unknown>>(bag: T, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...bag }
  for (const k of keys) delete out[k]
  return out
}

function translate(bag: Record<string, unknown>): StreamFrame {
  if (bag.greenRoom) return { kind: 'greenRoom', greenRoom: bag.greenRoom } as StreamFrame
  if (bag.handAsked) return { kind: 'handAsked', ...strip(bag, 'handAsked') } as StreamFrame
  if (bag.handAnswered) return { kind: 'handAnswered', ...strip(bag, 'handAnswered') } as StreamFrame
  if (bag.storytellerRound) return { kind: 'storytellerRound', round: bag.storytellerRound } as StreamFrame
  if (bag.storytellerBid) return { kind: 'storytellerBid', ...(bag.storytellerBid as object) } as StreamFrame
  if (bag.roundOpen) return { kind: 'roundOpen', roundId: bag.roundId } as StreamFrame
  if (bag.status) return { kind: 'status', status: bag.status } as StreamFrame
  if (typeof bag.content === 'string') return { kind: 'content', text: bag.content }
  if (typeof bag.reasoning === 'string') return { kind: 'reasoning', text: bag.reasoning }
  if (typeof bag.error === 'string') {
    return { kind: 'error', message: bag.error, ...strip(bag, 'error') } as StreamFrame
  }
  if (bag.toolsDetected) {
    return { kind: 'toolsDetected', names: bag.toolNames, arguments: bag.toolArguments } as StreamFrame
  }
  if (bag.toolResult) return { kind: 'toolResult', ...(bag.toolResult as object) } as StreamFrame
  if (bag.confirmationResult) return { kind: 'confirmationResult', ...(bag.confirmationResult as object) } as StreamFrame
  if (bag.fileProcessing) return { kind: 'fileProcessing', info: bag.fileProcessing } as StreamFrame
  for (const what of ['carinaAnswer', 'hostAnnouncement', 'pascalResult'] as const) {
    if (bag[what]) return { kind: 'posted', what, message: bag[what] } as StreamFrame
  }
  if (bag.done && bag.message) return { kind: 'swipeDone', message: bag.message } as StreamFrame
  if (bag.done) {
    return {
      kind: 'done',
      outcome: outcomeOf(bag),
      ...strip(bag, 'done', 'skipped', 'yielded', 'stopped', 'emptyResponse'),
    } as StreamFrame
  }
  if (bag.pendingExternalTurn) return { kind: 'pendingExternalTurn', ...strip(bag, 'pendingExternalTurn') } as StreamFrame
  if (bag.turnStart) return { kind: 'turnStart', ...strip(bag, 'turnStart') } as StreamFrame
  if (bag.turnComplete) return { kind: 'turnComplete', ...strip(bag, 'turnComplete') } as StreamFrame
  if (bag.chainComplete) return { kind: 'chainComplete', ...strip(bag, 'chainComplete') } as StreamFrame
  throw new Error(`Untranslatable legacy bag: ${JSON.stringify(bag)}`)
}

/** A complete `done` frame: an ordinary finish unless `fields` says otherwise. */
export function doneFrame(fields: Partial<Omit<DoneFrame, 'kind'>> = {}): DoneFrame {
  return {
    kind: 'done',
    outcome: 'finished',
    messageId: null,
    usage: null,
    cacheUsage: null,
    attachmentResults: null,
    toolsExecuted: false,
    ...fields,
  }
}
