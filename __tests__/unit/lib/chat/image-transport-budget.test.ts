/**
 * One image transport budget on the way to a provider.
 *
 * `applyImageTransportBudget` runs over the final message array for whichever
 * profile is about to be called — the primary, and each failover substitute —
 * and answers three questions once: can this profile read it (capability), is
 * there a slot for it (the per-request count cap), and is there room for it
 * (the total base64 budget). Receivable images are ranked by provenance and
 * age, never array position; overflow is described or omitted with a note,
 * never silently.
 *
 * The load-bearing contracts carried over from the adapter it replaced:
 *   1. a profile that CAN take everything gets the array back by reference —
 *      no copy, no describer spent, which is the overwhelmingly common case;
 *   2. a profile that cannot read an attachment gets the description in the
 *      bytes' place, exactly as if it had been the primary all along (bug 106);
 *   3. a describer that fails still yields a sendable array — a degraded turn
 *      beats the 400 that skipping this step guarantees.
 */

import {
  applyImageTransportBudget,
  collectAttachmentMimeTypes,
  planImageTransport,
  stripTransportTag,
  tagForTransport,
  IMAGE_OMITTED_NOTE,
  type ImageTransportOrigin,
  type ImageTransportPolicy,
} from '@/lib/chat/image-transport-budget'
import {
  formatFallbackAsMessagePrefix,
  generateImageDescription,
  processFileAttachmentFallback,
} from '@/lib/chat/file-attachment-fallback'
import { profileCanReceiveAttachment } from '@/lib/llm/image-transport'
import { LLM_TRANSPORT_TARGET_BASE64, LLM_TRANSPORT_TOTAL_BASE64 } from '@/lib/files/llm-image-budget'
import type { ConnectionProfile } from '@/lib/schemas/types'

jest.mock('@/lib/chat/file-attachment-fallback', () => ({
  processFileAttachmentFallback: jest.fn(),
  formatFallbackAsMessagePrefix: jest.fn(),
  generateImageDescription: jest.fn(),
}))

jest.mock('@/lib/llm/image-transport', () => ({
  profileCanReceiveAttachment: jest.fn(),
}))

jest.mock('@/lib/files/llm-image-budget', () => ({
  LLM_TRANSPORT_TARGET_BASE64: 500 * 1024,
  LLM_TRANSPORT_TOTAL_BASE64: 4 * 1024 * 1024,
}))

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

const mockProcessFallback = jest.mocked(processFileAttachmentFallback)
const mockFormatPrefix = jest.mocked(formatFallbackAsMessagePrefix)
const mockDescribe = jest.mocked(generateImageDescription)
const mockCanReceive = jest.mocked(profileCanReceiveAttachment)

const PROFILE = {
  id: 'profile-1',
  name: 'Text-only stand-in',
  provider: 'OPENAI',
  modelName: 'gpt-4o-mini',
} as unknown as ConnectionProfile

function image(id: string, mimeType = 'image/png') {
  return { id, filename: `${id}.png`, mimeType, size: 1024, data: 'AAAA' }
}

/** The pass for a profile, messages only. */
async function adapt<T extends { role: string; content: string; attachments?: unknown[] }>(
  messages: T[],
  profile: ConnectionProfile,
): Promise<T[]> {
  return (await applyImageTransportBudget(messages, profile, { repos: {}, userId: 'user-1' })).messages
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFormatPrefix.mockImplementation(
    result => `[described ${(result as { id?: string }).id ?? '?'}]\n\n`
  )
  mockProcessFallback.mockImplementation(async file => ({ id: file.id, type: 'image_description' }) as never)
  mockDescribe.mockImplementation(async file => ({ id: file.id, type: 'image_description' }) as never)
  mockCanReceive.mockReturnValue(false)
})

describe('collectAttachmentMimeTypes', () => {
  it('is empty when nothing is attached', () => {
    expect(
      collectAttachmentMimeTypes([{ role: 'user', content: 'hello' }])
    ).toEqual([])
  })

  it('de-duplicates across messages', () => {
    const types = collectAttachmentMimeTypes([
      { role: 'user', content: 'a', attachments: [image('a'), image('b')] },
      { role: 'user', content: 'b', attachments: [image('c', 'image/webp')] },
    ])
    expect(types.sort()).toEqual(['image/png', 'image/webp'])
  })

  it('ignores entries that are not loaded attachments', () => {
    expect(
      collectAttachmentMimeTypes([
        { role: 'user', content: 'a', attachments: [{ some: 'other shape' }, image('a')] },
      ])
    ).toEqual(['image/png'])
  })
})

describe('applyImageTransportBudget — nothing to do', () => {
  it('returns the same array reference when there are no attachments', async () => {
    mockCanReceive.mockReturnValue(true)
    const messages = [{ role: 'user', content: 'hello' }]

    await expect(adapt(messages, PROFILE)).resolves.toBe(messages)
    expect(mockProcessFallback).not.toHaveBeenCalled()
  })

  it('returns the same array reference when the substitute reads the bytes too', async () => {
    mockCanReceive.mockReturnValue(true)
    const messages = [{ role: 'user', content: 'look', attachments: [image('a')] }]

    await expect(adapt(messages, PROFILE)).resolves.toBe(messages)
    expect(mockProcessFallback).not.toHaveBeenCalled()
  })
})

describe('applyImageTransportBudget — bug 106: the bytes a substitute cannot read', () => {
  it('replaces the bytes with a description and drops the attachments key', async () => {
    mockCanReceive.mockReturnValue(false)
    const messages = [{ role: 'user', content: 'What is this?', attachments: [image('a')] }]

    const [adapted] = await adapt(messages, PROFILE)

    expect(adapted.content).toBe('[described a]\n\nWhat is this?')
    expect(adapted).not.toHaveProperty('attachments')
    expect(mockProcessFallback).toHaveBeenCalledTimes(1)
  })

  it('leaves the caller\'s array untouched — the adaptation is a copy', async () => {
    mockCanReceive.mockReturnValue(false)
    const original = { role: 'user', content: 'What is this?', attachments: [image('a')] }

    const adapted = await adapt([original], PROFILE)

    expect(adapted[0]).not.toBe(original)
    expect(original.content).toBe('What is this?')
    expect(original.attachments).toHaveLength(1)
  })

  it('keeps the attachments the substitute CAN read alongside the described ones', async () => {
    mockCanReceive.mockImplementation((_profile, mimeType) => mimeType !== 'image/png')
    const messages = [
      {
        role: 'user',
        content: 'two files',
        attachments: [image('png-one'), image('doc-one', 'text/plain')],
      },
    ]

    const [adapted] = await adapt(messages, PROFILE)

    expect(adapted.content).toBe('[described png-one]\n\ntwo files')
    expect(adapted.attachments).toEqual([image('doc-one', 'text/plain')])
  })

  it('passes through an entry that is not a loaded attachment', async () => {
    mockCanReceive.mockReturnValue(false)
    const foreign = { some: 'other shape' }
    const messages = [
      { role: 'user', content: 'x', attachments: [foreign, image('a')] },
    ]

    const [adapted] = await adapt(messages, PROFILE)

    expect(adapted.attachments).toEqual([foreign])
  })

  it('carries every other field of a message through untouched', async () => {
    mockCanReceive.mockReturnValue(false)
    const messages = [
      { role: 'user', content: 'x', name: 'Aurelia', toolCalls: [], attachments: [image('a')] },
    ]

    const [adapted] = await adapt(messages, PROFILE)

    expect(adapted.name).toBe('Aurelia')
    expect(adapted.toolCalls).toEqual([])
  })

  it('leaves attachment-free messages in the array alone', async () => {
    mockCanReceive.mockReturnValue(false)
    const plain = { role: 'assistant', content: 'earlier reply' }
    const messages = [plain, { role: 'user', content: 'x', attachments: [image('a')] }]

    const adapted = await adapt(messages, PROFILE)

    expect(adapted[0]).toBe(plain)
  })
})

describe('applyImageTransportBudget — a describer that fails', () => {
  it('notes the loss in the content and still returns a sendable array', async () => {
    mockCanReceive.mockReturnValue(false)
    mockProcessFallback.mockRejectedValue(new Error('describer unreachable'))
    const messages = [{ role: 'user', content: 'What is this?', attachments: [image('a')] }]

    const [adapted] = await adapt(messages, PROFILE)

    expect(adapted.content).toContain('⚠️ Attachment Processing Failed: a.png')
    expect(adapted.content).toContain('describer unreachable')
    expect(adapted.content).toContain('What is this?')
    expect(adapted).not.toHaveProperty('attachments')
  })

  it('never throws — a degraded turn beats the gateway\'s 400', async () => {
    mockCanReceive.mockReturnValue(false)
    mockProcessFallback.mockRejectedValue(new Error('boom'))

    await expect(
      adapt([{ role: 'user', content: 'x', attachments: [image('a')] }], PROFILE)
    ).resolves.toHaveLength(1)
  })
})

describe('applyImageTransportBudget — the per-request image cap', () => {
  const VISION = {
    ...PROFILE,
    name: 'Vision profile',
    supportsImageUpload: true,
    maxImagesPerRequest: 4,
  } as unknown as ConnectionProfile

  beforeEach(() => {
    mockCanReceive.mockReturnValue(true)
  })

  it('returns the same array reference at or under the cap', async () => {
    const messages = [
      { role: 'user', content: 'look', attachments: [image('a'), image('b'), image('c'), image('d')] },
    ]
    expect(await adapt(messages, VISION)).toBe(messages)
    expect(mockDescribe).not.toHaveBeenCalled()
  })

  it('sends the first four of six untagged images and describes the other two', async () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => image(id))
    const [out] = await adapt([{ role: 'user', content: 'look', attachments: six }], VISION)
    expect((out.attachments ?? []).map(a => (a as { id: string }).id)).toEqual(['a', 'b', 'c', 'd'])
    expect(out.content).toBe('[described e]\n\n[described f]\n\nlook')
    expect(mockDescribe).toHaveBeenCalledTimes(2)
    expect(mockProcessFallback).not.toHaveBeenCalled()
  })

  it('falls back to the default of four for a profile with no stored cap', async () => {
    const legacy = { ...VISION, maxImagesPerRequest: undefined } as unknown as ConnectionProfile
    const [out] = await adapt(
      [{ role: 'user', content: 'x', attachments: ['a', 'b', 'c', 'd', 'e'].map(id => image(id)) }],
      legacy,
    )
    expect(out.attachments).toHaveLength(4)
  })

  it('does not count images the profile cannot receive — those take the ordinary fallback', async () => {
    mockCanReceive.mockReturnValue(false)
    const [out] = await adapt(
      [{ role: 'user', content: 'x', attachments: ['a', 'b', 'c', 'd', 'e'].map(id => image(id)) }],
      VISION,
    )
    expect(mockProcessFallback).toHaveBeenCalledTimes(5)
    expect(mockDescribe).not.toHaveBeenCalled()
    expect(out).not.toHaveProperty('attachments')
  })
})

describe('planImageTransport — ranking by provenance and age', () => {
  const policy = (over: Partial<ImageTransportPolicy> = {}): ImageTransportPolicy => ({
    maxImages: 4,
    maxTotalBase64: LLM_TRANSPORT_TOTAL_BASE64,
    canReceive: () => true,
    ...over,
  })
  const tagged = (id: string, origin: ImageTransportOrigin, createdAt: number, bytes = 100, describable = true) =>
    tagForTransport({ ...image(id), data: 'A'.repeat(bytes) }, { origin, createdAt, describable })

  function keptIds(messages: Parameters<typeof planImageTransport>[0], p: ImageTransportPolicy) {
    const verdicts = planImageTransport(messages, p)
    return messages
      .flatMap(m => m.attachments ?? [])
      .filter(a => verdicts.get(a)?.kind === 'keep')
      .map(a => (a as { id: string }).id)
  }

  it('keeps uploads, then re-hydrated uploads, then Lantern images, whatever the array order', () => {
    const messages = [{
      role: 'user',
      content: 'x',
      attachments: [
        tagged('lantern-new', 'lantern', 300),
        tagged('rehydrated', 'rehydrated', 100),
        tagged('upload', 'upload', 50),
      ],
    }]
    expect(keptIds(messages, policy({ maxImages: 2 }))).toEqual(['rehydrated', 'upload'])
  })

  it('keeps the newest of a kind first — the Lantern walk no longer spends it oldest first', () => {
    const messages = [{
      role: 'user',
      content: 'x',
      attachments: [tagged('old', 'lantern', 100), tagged('mid', 'lantern', 200), tagged('new', 'lantern', 300)],
    }]
    expect(keptIds(messages, policy({ maxImages: 2 }))).toEqual(['mid', 'new'])
  })

  it('ranks an untagged attachment after every tagged one — a forgotten tag costs priority, not correctness', () => {
    const messages = [{
      role: 'user',
      content: 'x',
      attachments: [image('untagged'), tagged('lantern', 'lantern', 1)],
    }]
    expect(keptIds(messages, policy({ maxImages: 1 }))).toEqual(['lantern'])
  })

  it('spends the count cap before the byte budget, and the byte budget skips to a smaller image that fits', () => {
    const messages = [{
      role: 'user',
      content: 'x',
      attachments: [
        tagged('big-new', 'lantern', 300, 800),
        tagged('small-old', 'lantern', 100, 150),
        tagged('upload', 'upload', 50, 300),
      ],
    }]
    const verdicts = planImageTransport(messages, policy({ maxTotalBase64: 500 }))
    const [bigNew, smallOld, upload] = messages[0].attachments
    expect(verdicts.get(upload)).toEqual({ kind: 'keep' })
    expect(verdicts.get(bigNew)).toEqual({ kind: 'overflow', reason: 'bytes' })
    expect(verdicts.get(smallOld)).toEqual({ kind: 'keep' })

    const counted = planImageTransport(messages, policy({ maxImages: 1, maxTotalBase64: 500 }))
    expect(counted.get(smallOld)).toEqual({ kind: 'overflow', reason: 'count' })
  })
})

describe('applyImageTransportBudget — over the byte budget: described or omitted, never silent', () => {
  const VISION = { ...PROFILE, supportsImageUpload: true, maxImagesPerRequest: 10 } as unknown as ConnectionProfile
  const tagged = (id: string, origin: ImageTransportOrigin, createdAt: number, bytes: number, describable: boolean) =>
    tagForTransport({ ...image(id), data: 'A'.repeat(bytes) }, { origin, createdAt, describable })

  beforeEach(() => {
    mockCanReceive.mockReturnValue(true)
  })

  it('describes a describable overflow and omits a non-describable one with a note', async () => {
    const policy: ImageTransportPolicy = { maxImages: 10, maxTotalBase64: 1000, canReceive: () => true }
    const messages = [{
      role: 'user',
      content: 'look',
      attachments: [
        tagged('keep', 'upload', 300, 900, true),
        tagged('generated', 'lantern', 200, 400, true),
        tagged('vault-avatar', 'lantern', 100, 400, false),
      ],
    }]

    const { messages: [out], report } = await applyImageTransportBudget(
      messages, VISION, { repos: {}, userId: 'u1' }, policy,
    )

    expect((out.attachments ?? []).map(a => (a as { id: string }).id)).toEqual(['keep'])
    expect(out.content).toBe(`[described generated]\n\n${IMAGE_OMITTED_NOTE}\n\nlook`)
    expect(mockDescribe).toHaveBeenCalledTimes(1)
    expect(report).toMatchObject({ kept: 1, described: 1, dropped: 1, base64Kept: 900 })
    expect(report.entries.find(e => e.attachmentId === 'vault-avatar')).toMatchObject({
      outcome: 'dropped', reason: 'bytes', origin: 'lantern',
    })
  })

  it('omits with a note when the describer cannot describe', async () => {
    mockDescribe.mockResolvedValue({ type: 'unsupported', error: 'no describer' } as never)
    const policy: ImageTransportPolicy = { maxImages: 1, maxTotalBase64: 10_000, canReceive: () => true }
    const [out] = (await applyImageTransportBudget(
      [{ role: 'user', content: 'x', attachments: [image('a'), image('b')] }],
      VISION, { repos: {}, userId: 'u1' }, policy,
    )).messages
    expect(out.content).toBe(`${IMAGE_OMITTED_NOTE}\n\nx`)
  })

  it('hands the describer an attachment without its transport tag', async () => {
    const policy: ImageTransportPolicy = { maxImages: 0, maxTotalBase64: 10_000, canReceive: () => true }
    await applyImageTransportBudget(
      [{ role: 'user', content: 'x', attachments: [tagged('a', 'upload', 1, 10, true)] }],
      VISION, { repos: {}, userId: 'u1' }, policy,
    )
    expect(mockDescribe.mock.calls[0][0]).not.toHaveProperty('transport')
  })

  it('bug 151: four 500 KB uploads and six Lantern images stay under the total, newest kept', async () => {
    const big = LLM_TRANSPORT_TARGET_BASE64
    const uploads = [1, 2, 3, 4].map(n => tagged(`upload-${n}`, 'upload', 1000, big, true))
    const lanterns = [1, 2, 3, 4, 5, 6].map(n => tagged(`lantern-${n}`, 'lantern', n, big, true))
    const policy: ImageTransportPolicy = { maxImages: 50, maxTotalBase64: LLM_TRANSPORT_TOTAL_BASE64, canReceive: () => true }

    const { messages: [out], report } = await applyImageTransportBudget(
      [{ role: 'user', content: 'x', attachments: [...uploads, ...lanterns] }],
      VISION, { repos: {}, userId: 'u1' }, policy,
    )

    const keptIds = (out.attachments ?? []).map(a => (a as { id: string }).id)
    const onTheWire = (out.attachments ?? []).reduce((n, a) => n + ((a as { data: string }).data.length), 0)
    expect(onTheWire).toBeLessThanOrEqual(LLM_TRANSPORT_TOTAL_BASE64)
    expect(report.base64Kept).toBe(onTheWire)
    // Every upload, then the newest Lantern images the rest of the budget holds.
    // 4 MB holds eight images at the 500 KB per-image ceiling.
    expect(keptIds).toEqual([
      'upload-1', 'upload-2', 'upload-3', 'upload-4',
      'lantern-3', 'lantern-4', 'lantern-5', 'lantern-6',
    ])
    expect(report.described).toBe(2)
    expect(report.entries.filter(e => e.outcome === 'described').map(e => e.attachmentId))
      .toEqual(['lantern-1', 'lantern-2'])
  })
})

describe('transport tags', () => {
  it('strip removes the tag and leaves the rest of the attachment', () => {
    const t = tagForTransport(image('a'), { origin: 'upload', createdAt: 1, describable: true })
    expect(t.transport.origin).toBe('upload')
    expect(stripTransportTag(t)).toEqual(image('a'))
  })

  it('strip returns an untagged attachment as is', () => {
    const plain = image('a')
    expect(stripTransportTag(plain)).toBe(plain)
  })
})
