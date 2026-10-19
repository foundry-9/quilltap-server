/**
 * The generate_image tool asks the sanitizer about the profile the image will
 * actually be painted on, and a profile that is already uncensored is neither
 * cleaned for nor rerouted away from, whatever the chat's state. Cleaning is
 * for a Moderated chat bound for a moderated painter only.
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
  // Every prompt the pre-screen sees is flagged.
  classifyContent: jest.fn(async () => ({
    isDangerous: true, score: 0.9, categories: [{ category: 'sexual', score: 0.9 }],
  })),
}))
jest.mock('@/lib/image-gen/params-builder', () => ({
  buildImageGenParams: jest.fn(({ prompt }: { prompt: string }) => ({ params: { prompt, n: 1 } })),
  resolveProfileLoras: jest.fn(() => ({ triggerPhrase: null })),
}))
jest.mock('@/lib/image-gen/appearance-resolution', () => ({
  equippedWardrobeItemsForAppearance: jest.fn(async () => undefined),
  resolveCharacterAppearances: jest.fn(async () => ({
    appearances: [{
      characterId: 'char-1', characterName: 'Amy', physicalDescription: 'a young woman',
      physicalDescriptionName: 'Default', clothingDescription: 'nothing at all',
      clothingSource: 'narrative', wasSanitized: false,
    }],
    llmResolved: true,
  })),
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

jest.mock('@/lib/image-gen/prompt-expansion', () => {
  const actual = jest.requireActual('@/lib/image-gen/prompt-expansion')
  return {
    ...actual,
    // One character behind the {{Amy}} placeholder, so appearance resolution runs.
    resolvePlaceholders: jest.fn(async () => [
      { placeholder: '{{Amy}}', name: 'Amy', entityId: 'char-1', descriptions: ['a young woman'] },
    ]),
  }
})

import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { sanitizeAppearancesIfNeeded } from '@/lib/image-gen/appearance-resolution'

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
const MERLIN = {
  id: '33333333-3333-4333-8333-333333333333', userId: USER, name: 'Merlin Atelier',
  provider: 'OPENAI', modelName: 'merlin-image', apiKeyId: 'key-merlin',
  isDangerousCompatible: true, parameters: {},
}

function wire(conciergeMode: 'moderated' | 'unmoderated' | 'locked' = 'moderated') {
  ;(getRepositories as jest.Mock).mockReturnValue({
    imageProfiles: {
      findById: jest.fn(async (id: string) => [HOUSE, KESTREL, MERLIN].find(p => p.id === id) ?? null),
      findAll: jest.fn(async () => [HOUSE, KESTREL, MERLIN]),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn(async (id: string) => ({ id, key_value: `sk-${id}` })),
      findByUserId: jest.fn(async () => []),
    },
    chatSettings: {
      findByUserId: jest.fn(async () => ({
        conciergeSettings: {
          enabled: true,
          uncensoredImageProfileId: MERLIN.id,
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
      findById: jest.fn(async () => ({ id: CHAT, participants: [], conciergeMode, isDangerousChat: false })),
      getMessages: jest.fn(async () => []),
    },
    characters: { findById: jest.fn(async () => null) },
    files: { create: jest.fn(async (entry: Record<string, unknown>, opts: { id: string }) => ({ ...entry, id: opts.id })) },
  })

  const painters: Record<string, { generateImage: jest.Mock }> = {}
  ;(createImageProvider as jest.Mock).mockImplementation((provider: string) => {
    painters[provider] ??= {
      generateImage: jest.fn(async () => ({
        images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png' }],
      })),
    }
    return painters[provider]
  })
  return painters
}

/** The `imageTargetUncensored` argument of the one sanitizer call. */
function sanitizeTargetFlag(): boolean {
  expect(sanitizeAppearancesIfNeeded).toHaveBeenCalledTimes(1)
  return (sanitizeAppearancesIfNeeded as jest.Mock).mock.calls[0][2] as boolean
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('generate_image — the image target decides the cleaning', () => {
  it.each(['moderated', 'unmoderated', 'locked'] as const)(
    'a %s chat drawing on its own uncensored profile stays there and is not cleaned',
    async (mode) => {
      const painters = wire(mode)

      const result = await executeImageGenerationTool(
        { prompt: '{{Amy}} lying in tousled sheets' },
        { userId: USER, profileId: KESTREL.id, chatId: CHAT },
      )

      expect(result.success).toBe(true)
      // Kestrel painted it; the desk (Merlin) was never asked to stand in.
      expect(result.model).toBe('grok-2-image')
      expect(painters.OPENAI).toBeUndefined()
      expect(sanitizeTargetFlag()).toBe(true)
    },
  )

  it('a Moderated chat rerouted to the desk by the pre-screen tells the sanitizer it is bound uncensored', async () => {
    wire('moderated')

    const result = await executeImageGenerationTool(
      { prompt: '{{Amy}} lying in tousled sheets' },
      { userId: USER, profileId: HOUSE.id, chatId: CHAT },
    )

    expect(result.success).toBe(true)
    expect(result.model).toBe('merlin-image')
    expect(sanitizeTargetFlag()).toBe(true)
  })

  it('a Locked chat on a moderated painter stays there, and the sanitizer is told so', async () => {
    wire('locked')

    const result = await executeImageGenerationTool(
      { prompt: '{{Amy}} lying in tousled sheets' },
      { userId: USER, profileId: HOUSE.id, chatId: CHAT },
    )

    expect(result.model).toBe('gemini-2.5-flash-image')
    expect(sanitizeTargetFlag()).toBe(false)
  })
})
