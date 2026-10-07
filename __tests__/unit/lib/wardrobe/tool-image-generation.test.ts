/**
 * Pictures commissioned by the wardrobe tools (lib/wardrobe/tool-image-generation.ts).
 *
 * The operator's `generateFromTools` switch is both gate and default: off,
 * nothing is queued even when the model asks; on, the tool's default applies
 * unless the model says otherwise. The helper never throws.
 */


jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

const mockEnqueue = jest.fn<(...args: unknown[]) => Promise<{ jobId: string; isNew: boolean }>>()
jest.mock('@/lib/background-jobs/queue-service', () => ({
  enqueueWardrobeItemImageGeneration: (...args: unknown[]) => mockEnqueue(...args),
}))

const mockResolveProfile = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@/lib/image-gen/profile-resolution', () => ({
  resolveWardrobeImageProfile: (...args: unknown[]) => mockResolveProfile(...args),
}))

import {
  formatWardrobeImageHandle,
  formatWardrobeToolImageLine,
  maybeQueueWardrobeToolImage,
  wardrobeToolImagesEnabled,
} from '@/lib/wardrobe/tool-image-generation'

const findByUserId = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const repos = { chatSettings: { findByUserId }, imageProfiles: {} } as never

const ARGS = {
  userId: 'user-1',
  chatId: 'chat-1',
  characterId: 'char-1',
  itemId: 'item-1',
  callerContext: 'test',
}

function settings(generateFromTools: boolean | undefined) {
  return { wardrobeImageSettings: { imageProfileId: null, generateFromTools } }
}

describe('wardrobeToolImagesEnabled', () => {
  it('reads only an explicit true as on', () => {
    expect(wardrobeToolImagesEnabled(settings(true) as never)).toBe(true)
    expect(wardrobeToolImagesEnabled(settings(false) as never)).toBe(false)
    expect(wardrobeToolImagesEnabled(settings(undefined) as never)).toBe(false)
    expect(wardrobeToolImagesEnabled(null)).toBe(false)
  })
})

describe('maybeQueueWardrobeToolImage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProfile.mockResolvedValue({ id: 'profile-1' })
    mockEnqueue.mockResolvedValue({ jobId: 'job-1', isNew: true })
  })

  it('reports nothing and queues nothing when the switch is off and the model said nothing', async () => {
    findByUserId.mockResolvedValue(settings(false))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: undefined, defaultWhenEnabled: true })
    expect(result).toBeUndefined()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('refuses a model that asks while the switch is off', async () => {
    findByUserId.mockResolvedValue(settings(false))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: true, defaultWhenEnabled: true })
    expect(result?.status).toBe('not-enabled')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('queues by default when the switch is on and the tool defaults on', async () => {
    findByUserId.mockResolvedValue(settings(true))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: undefined, defaultWhenEnabled: true })
    expect(result?.status).toBe('queued')
    expect(mockEnqueue).toHaveBeenCalledWith('user-1', { chatId: 'chat-1', characterId: 'char-1', itemId: 'item-1' })
  })

  it('does not queue when the tool defaults off and the model said nothing', async () => {
    findByUserId.mockResolvedValue(settings(true))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: undefined, defaultWhenEnabled: false })
    expect(result).toBeUndefined()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('lets the model opt out while the switch is on', async () => {
    findByUserId.mockResolvedValue(settings(true))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: false, defaultWhenEnabled: true })
    expect(result).toBeUndefined()
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('lets the model ask for a picture the tool would not default to', async () => {
    findByUserId.mockResolvedValue(settings(true))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: true, defaultWhenEnabled: false })
    expect(result?.status).toBe('queued')
  })

  it('reports a missing image profile without queueing', async () => {
    findByUserId.mockResolvedValue(settings(true))
    mockResolveProfile.mockResolvedValue(null)
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: undefined, defaultWhenEnabled: true })
    expect(result?.status).toBe('no-image-profile')
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('never throws: a failed enqueue is reported', async () => {
    findByUserId.mockResolvedValue(settings(true))
    mockEnqueue.mockRejectedValue(new Error('queue down'))
    const result = await maybeQueueWardrobeToolImage(repos, { ...ARGS, requested: undefined, defaultWhenEnabled: true })
    expect(result?.status).toBe('failed')
  })
})

describe('formatters', () => {
  it('formats the picture line only when there is a result', () => {
    expect(formatWardrobeToolImageLine(undefined)).toBeNull()
    expect(formatWardrobeToolImageLine({ status: 'queued', message: 'Drawing.' })).toBe('- Picture: Drawing.')
  })

  it('names describe_image beside the file id', () => {
    const handle = formatWardrobeImageHandle('file-1')
    expect(handle).toContain('file-1')
    expect(handle).toContain('describe_image')
  })
})
