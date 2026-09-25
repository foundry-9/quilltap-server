/**
 * Regression: the bikini case (Concierge overhaul, phase 1).
 *
 * A Moderated chat with the Concierge on duty; the classifier does not flag the prompt;
 * the ordinary image provider refuses it (a Gemini IMAGE_SAFETY rejection);
 * one image profile is merely ticked "Uncensored-compatible" with no explicit
 * Concierge pick. Before the overhaul the post-hoc reroute required the
 * explicit pick, the tool returned an error, and nothing in the Salon said the
 * Concierge had looked. Now the understudy draws it, the tool result names the
 * model that actually answered, the result carries a two-entry trail for the
 * TOOL message, and the Concierge posts one `refusal-rerouted` bubble.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/llm/plugin-factory', () => ({ createImageProvider: jest.fn() }))
jest.mock('@/lib/plugins/provider-registry', () => ({ getImageProviderConstraints: jest.fn(() => null) }))
jest.mock('@/lib/background-jobs/activity-registry', () => ({
  trackActivity: (_kind: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/llm/cheap-llm-user-selection', () => ({
  resolveCheapLLMSelectionForUser: jest.fn(async () => ({
    selection: { provider: 'OPENAI', modelName: 'cheap', connectionProfileId: 'cheap-1', isLocal: false },
  })),
  selectCheapLLMFromProfiles: jest.fn(() => null),
}))
jest.mock('@/lib/services/dangerous-content/gatekeeper.service', () => ({
  classifyContent: jest.fn(async () => ({ isDangerous: false, score: 0.1, categories: [] })),
}))
jest.mock('@/lib/image-gen/params-builder', () => ({
  buildImageGenParams: jest.fn(({ prompt }: { prompt: string }) => ({ params: { prompt, n: 1 } })),
  resolveProfileLoras: jest.fn(() => ({ triggerPhrase: null })),
}))
jest.mock('@/lib/image-gen/appearance-resolution', () => ({
  equippedWardrobeItemsForAppearance: jest.fn(async () => undefined),
  resolveCharacterAppearances: jest.fn(async () => ({ appearances: [], llmResolved: false })),
  sanitizeAppearancesIfNeeded: jest.fn(async (a: unknown) => a),
}))
jest.mock('@/lib/image-gen/aesthetic', () => ({
  resolveAesthetic: jest.fn(async () => null),
  resolveDepictionGuidelines: jest.fn(async () => []),
  getProjectOfficialMountPointId: jest.fn(async () => null),
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveProjectMountPointIdsForChat: jest.fn(async () => []),
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({ craftImagePrompt: jest.fn() }))
jest.mock('@/lib/file-storage/lantern-store-bridge', () => ({
  getLanternBackgroundsStore: jest.fn(async () => ({ mountPointId: 'lantern' })),
  writeLanternBackgroundToMountStore: jest.fn(async () => ({
    storageKey: 'mount-blob:lantern:b1', storedMimeType: 'image/webp', sizeBytes: 4,
  })),
}))
jest.mock('@/lib/files/webp-conversion', () => ({
  convertToWebP: jest.fn(async () => ({
    buffer: Buffer.from('webp'), mimeType: 'image/webp', filename: 'generated.webp', width: 512, height: 512,
  })),
}))
jest.mock('@/lib/files/tag-inheritance', () => ({ getInheritedTags: jest.fn(async () => []) }))
jest.mock('@/lib/services/llm-logging.service', () => ({ logLLMCall: jest.fn(async () => undefined) }))
jest.mock('@/lib/services/lantern-notifications/writer', () => ({
  postLanternImageNotification: jest.fn(async () => undefined),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn(async () => null),
}))

import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer'

const USER = 'user-1'
const CHAT = 'chat-1'
const HOUSE = {
  id: '11111111-1111-4111-8111-111111111111', userId: USER, name: 'House Painter',
  provider: 'GOOGLE', modelName: 'gemini-2.5-flash-image', apiKeyId: 'key-house',
  isDangerousCompatible: false, parameters: {},
}
const KESTREL = {
  id: '22222222-2222-4222-8222-222222222222', userId: USER, name: 'Kestrel Studio',
  provider: 'GROK', modelName: 'grok-2-image', apiKeyId: 'key-kestrel',
  isDangerousCompatible: true, parameters: {},
}

function wire(
  duty: 'on-duty' | 'off-duty' = 'on-duty',
  conciergeMode: 'moderated' | 'unmoderated' | null = null,
) {
  const files = { create: jest.fn(async (entry: Record<string, unknown>, opts: { id: string }) => ({ ...entry, id: opts.id })) }
  ;(getRepositories as jest.Mock).mockReturnValue({
    imageProfiles: {
      findById: jest.fn(async (id: string) => [HOUSE, KESTREL].find(p => p.id === id) ?? null),
      findAll: jest.fn(async () => [HOUSE, KESTREL]),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn(async (id: string) => ({ id, key_value: `sk-${id}` })),
      findByUserId: jest.fn(async () => []),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => ({
        conciergeSettings: {
          enabled: duty === 'on-duty',
          uncensoredImageProfileId: null, // "Auto-detect": no explicit pick
          autoSwitchAfterRefusals: 2,
          newChatsStartAs: 'moderated',
          display: { mode: 'SHOW', showWarningBadges: true },
          preScreen: {
            enabled: true, threshold: 0.7, scanTextChat: true, scanImagePrompts: true,
            scanImageGeneration: false, summaryClassification: false,
          },
        },
      })),
    },
    chats: {
      // Moderated unless told otherwise, not flagged.
      findById: jest.fn(async () => ({ id: CHAT, participants: [], conciergeMode, isDangerousChat: false })),
      getMessages: jest.fn(async () => []),
    },
    characters: { findById: jest.fn(async () => null) },
    files,
  })

  const house = {
    generateImage: jest.fn(async () => {
      throw Object.assign(new Error('Gemini declined the image: finishReason IMAGE_SAFETY'), {
        code: 'MODERATION_REJECTED',
        providerReason: 'IMAGE_SAFETY',
      })
    }),
  }
  const kestrel = {
    generateImage: jest.fn(async () => ({
      images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
    })),
  }
  ;(createImageProvider as jest.Mock).mockImplementation((provider: string) =>
    provider === 'GROK' ? kestrel : house)
  return { house, kestrel, files }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('generate_image — the bikini case', () => {
  it('reroutes a refused portrait to a merely-compatible profile and says so', async () => {
    const { house, kestrel, files } = wire()

    const result = await executeImageGenerationTool(
      { prompt: 'head-and-shoulders portrait of a woman in a bikini' },
      { userId: USER, profileId: HOUSE.id, chatId: CHAT },
    )

    expect(result.success).toBe(true)
    expect(house.generateImage).toHaveBeenCalledTimes(1)
    expect(kestrel.generateImage).toHaveBeenCalledTimes(1)

    // The tool result names the model that actually answered.
    expect(result.provider).toBe('GROK')
    expect(result.model).toBe('grok-2-image')
    expect(result.message).toContain('grok-2-image')
    expect((files.create.mock.calls[0][0] as { generationModel: string }).generationModel).toBe('grok-2-image')

    // A two-entry trail for the TOOL message.
    expect(result.routeTrail?.map(a => [a.profileName, a.via, a.outcome, a.evidence, a.profileKind])).toEqual([
      ['House Painter', 'primary', 'refused', 'typed-error', 'image'],
      ['Kestrel Studio', 'concierge', 'answered', undefined, 'image'],
    ])

    // Exactly one Concierge bubble, and it is the reroute.
    expect(postConciergeRefusalAnnouncement).toHaveBeenCalledTimes(1)
    expect(postConciergeRefusalAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
      chatId: CHAT,
      kind: 'refusal-rerouted',
      details: expect.objectContaining({ answeringProfileName: 'Kestrel Studio', purpose: 'tool' }),
    }))
    // The Lantern's bubble for the picture carries the call sheet as well.
    expect((postLanternImageNotification as jest.Mock).mock.calls[0][0].routeTrail).toHaveLength(2)
  })

  it('with the Concierge off duty, fails with the trail and announces nothing', async () => {
    const { kestrel } = wire('off-duty')

    const result = await executeImageGenerationTool(
      { prompt: 'head-and-shoulders portrait of a woman in a bikini' },
      { userId: USER, profileId: HOUSE.id, chatId: CHAT },
    )

    expect(result.success).toBe(false)
    expect(kestrel.generateImage).not.toHaveBeenCalled()
    expect(result.routeTrail).toEqual([
      expect.objectContaining({ profileName: 'House Painter', outcome: 'refused' }),
    ])
    expect(postConciergeRefusalAnnouncement).not.toHaveBeenCalled()
  })

  it('routes an Unmoderated chat straight to the uncensored desk, with no refusal to announce', async () => {
    const { house, kestrel } = wire('on-duty', 'unmoderated')

    const result = await executeImageGenerationTool(
      { prompt: 'head-and-shoulders portrait of a woman in a bikini' },
      { userId: USER, profileId: HOUSE.id, chatId: CHAT },
    )

    expect(result.success).toBe(true)
    expect(house.generateImage).not.toHaveBeenCalled()
    expect(kestrel.generateImage).toHaveBeenCalledTimes(1)
    expect(result.model).toBe('grok-2-image')
    expect(postConciergeRefusalAnnouncement).not.toHaveBeenCalled()
  })
})
