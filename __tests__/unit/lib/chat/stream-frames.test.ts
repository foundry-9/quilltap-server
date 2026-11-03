/**
 * @jest-environment node
 *
 * The Salon stream-frame module: schema, encoder, parser, seat tags, and the
 * golden streams recorded from the pre-4.12 encoders.
 */

import {
  StreamFrameSchema,
  doneLeavesNoReply,
  encodeFrame,
  legacyFrameEncoder,
  parseFrame,
  seatedFrameEncoder,
  tagFrame,
  toLegacyBag,
  type StreamFrame,
} from '@/lib/chat/stream-frames'
import { GOLDEN_STREAMS, loadFrameStream, loadLegacyStream } from '../../../helpers/salon-stream-golden'

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))
import { logger } from '@/lib/logger'

const decoder = new TextDecoder()
const payloadOf = (bytes: Uint8Array): string => {
  const text = decoder.decode(bytes)
  expect(text.startsWith('data: ')).toBe(true)
  expect(text.endsWith('\n\n')).toBe(true)
  return text.slice(6, -2)
}

const allFrames: StreamFrame[] = GOLDEN_STREAMS.flatMap((name) => loadFrameStream(name))

describe('golden streams', () => {
  it('covers every frame kind', () => {
    const kinds = new Set(allFrames.map((f) => f.kind))
    const declared = StreamFrameSchema.options.map((o) => o.shape.kind.value)
    expect([...kinds].sort()).toEqual([...declared].sort())
  })

  it.each(GOLDEN_STREAMS)('%s: toLegacyBag reproduces every recorded bag', (name) => {
    const legacy = loadLegacyStream(name)
    expect(loadFrameStream(name).map(toLegacyBag)).toEqual(legacy)
  })

  it.each(GOLDEN_STREAMS)('%s: a legacy encoder writes the recorded bytes', (name) => {
    const encoder = legacyFrameEncoder()
    const legacy = loadLegacyStream(name)
    expect(loadFrameStream(name).map((f) => JSON.parse(payloadOf(encodeFrame(encoder, f))))).toEqual(legacy)
  })
})

describe('schema round-trip', () => {
  it.each(allFrames.map((f, i) => [i, f.kind, f] as const))('#%i %s', (_i, _kind, frame) => {
    expect(parseFrame(payloadOf(encodeFrame(new TextEncoder(), frame)))).toEqual(frame)
  })
})

describe('parseFrame', () => {
  it('skips keep-alive payloads and chunking artefacts', () => {
    expect(parseFrame('')).toBeNull()
    expect(parseFrame('[DONE]')).toBeNull()
    expect(parseFrame('{}')).toBeNull()
    expect(parseFrame('{not json')).toBeNull()
  })

  it('ignores an unknown kind, logging it once', () => {
    ;(logger.warn as jest.Mock).mockClear()
    expect(parseFrame('{"kind":"fromTheFuture","x":1}')).toBeNull()
    expect(parseFrame('{"kind":"fromTheFuture","x":2}')).toBeNull()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('rejects a known kind with a missing field', () => {
    expect(parseFrame('{"kind":"handAnswered","participantId":"p","characterName":"Bo"}')).toBeNull()
  })
})

describe('encodeFrame', () => {
  it('logs a malformed frame in development and test', () => {
    ;(logger.error as jest.Mock).mockClear()
    encodeFrame(new TextEncoder(), { kind: 'content' } as unknown as StreamFrame)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('a seated encoder tags every frame with its seat', () => {
    const encoder = seatedFrameEncoder('p-bo')
    const frame: StreamFrame = { kind: 'content', text: 'Rather' }
    const tagged = tagFrame(frame, 'p-bo')
    expect(tagged.seat).toEqual({ participantId: 'p-bo', concurrent: true })
    expect(parseFrame(payloadOf(encodeFrame(encoder, frame)))).toEqual(tagged)
    expect(JSON.parse(payloadOf(encodeFrame(legacyFrameEncoder(), tagged)))).toEqual(toLegacyBag(tagged))
  })

  it('the legacy shape keeps a frame’s own participantId over its seat', () => {
    const frame: StreamFrame = {
      kind: 'turnStart', participantId: 'own', characterName: 'Ada', chainDepth: 0,
      seat: { participantId: 'seat', concurrent: true },
    }
    expect(toLegacyBag(frame)).toMatchObject({ turnStart: true, participantId: 'own', concurrent: true })
  })
})

describe('doneLeavesNoReply', () => {
  it.each([
    ['finished', false], ['empty', false], ['skipped', true], ['yielded', true], ['stopped', true],
  ] as const)('%s → %s', (outcome, expected) => {
    expect(doneLeavesNoReply(outcome)).toBe(expected)
  })
})
