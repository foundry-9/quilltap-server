/**
 * The story-background handler decides whether the crafted prompt is bound for
 * a moderated image provider or a Concierge uncensored one, and passes that as
 * `uncensoredImageTarget`. Appearance sanitization already steps aside for a
 * dangerous chat with an uncensored image profile configured; before this the
 * prompt crafter did not, so an uncensored provider still received a scene with
 * a sheet draped over it.
 *
 * Also locks the moderation-reroute path (bug 133): the post-hoc reroute is
 * available only to a chat already flagged dangerous. A moderated chat whose
 * background the provider rejects fails the job rather than being escalated to
 * an uncensored provider, and a flagged chat's prompt — candid already — is
 * resent as-is rather than re-crafted.
 *
 * Scaffolding mirrors story-background-sha256.test.ts: subject import first,
 * bare jest.mock() factories, behaviour wired in beforeEach.
 */

import { handleStoryBackgroundGeneration } from '@/lib/background-jobs/handlers/story-background'
import { getRepositories } from '@/lib/repositories/factory'
import { createImageProvider } from '@/lib/llm/plugin-factory'
import { convertToWebP } from '@/lib/files/webp-conversion'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm'
import {
  craftStoryBackgroundPrompt,
  deriveSceneContext,
  extractVisibleConversation,
} from '@/lib/memory/cheap-llm-tasks'
import {
  isImageModerationError,
  resolveUncensoredImageProfileForReroute,
} from '@/lib/services/dangerous-content/provider-routing.service'
import { writeLanternBackgroundToMountStore } from '@/lib/file-storage/lantern-store-bridge'
import {
  resolveCharacterAppearances,
  sanitizeAppearancesIfNeeded,
} from '@/lib/image-gen/appearance-resolution'

jest.mock('@/lib/logger', () => {
  const makeLogger = () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/llm/plugin-factory', () => ({ createImageProvider: jest.fn() }))
jest.mock('@/lib/files/webp-conversion', () => ({ convertToWebP: jest.fn() }))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({
  shouldUseUncensoredRoute: jest.fn(),
  // The real derivation, for tests that wire the real resolver through.
  getConciergeState: jest.requireActual('@/lib/services/dangerous-content/chat-override').getConciergeState,
}))
jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  isImageModerationError: jest.fn(),
  resolveUncensoredImageProfileForReroute: jest.fn(),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(),
  resolveUncensoredCheapLLMSelection: jest.fn(),
  buildCheapLLMConfig: jest.fn(() => ({})),
  DEFAULT_CHEAP_LLM_CONFIG: {},
}))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  craftStoryBackgroundPrompt: jest.fn(),
  deriveSceneContext: jest.fn(),
  extractVisibleConversation: jest.fn(),
}))
jest.mock('@/lib/image-gen/appearance-resolution', () => ({
  resolveCharacterAppearances: jest.fn(),
  sanitizeAppearancesIfNeeded: jest.fn(),
  equippedWardrobeItemsForAppearance: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/wardrobe/resolve-equipped', () => ({
  resolveEquippedOutfitForCharacter: jest.fn(),
}))
jest.mock('@/lib/services/lantern-notifications/writer', () => ({
  postLanternImageNotification: jest.fn().mockResolvedValue(undefined),
}))

const USER = 'user-1'
const CHAT_ID = 'chat-1'
const WEBP_BYTES = Buffer.from('converted webp bytes')

const CONCEALED_PROMPT = 'a shuttered bedroom, a sheet draped across her hips'
const CANDID_PROMPT = 'a shuttered bedroom, a woman lying nude in tousled sheets'

const mockGetRepositories = jest.mocked(getRepositories)
const mockCreateImageProvider = jest.mocked(createImageProvider)
const mockConvertToWebP = jest.mocked(convertToWebP)
const mockResolveDanger = jest.mocked(resolveDangerousContentSettings)
const mockShouldUseUncensoredRoute = jest.mocked(shouldUseUncensoredRoute)
const mockGetCheapLLM = jest.mocked(getCheapLLMProvider)
const mockResolveUncensoredCheap = jest.mocked(resolveUncensoredCheapLLMSelection)
const mockCraftPrompt = jest.mocked(craftStoryBackgroundPrompt)
const mockExtractConversation = jest.mocked(extractVisibleConversation)
const mockDeriveScene = jest.mocked(deriveSceneContext)
const mockIsModerationError = jest.mocked(isImageModerationError)
const mockResolveReroute = jest.mocked(resolveUncensoredImageProfileForReroute)
const mockWriteLantern = jest.mocked(writeLanternBackgroundToMountStore)
const mockResolveAppearances = jest.mocked(resolveCharacterAppearances)
const mockSanitizeAppearances = jest.mocked(sanitizeAppearancesIfNeeded)

const SELECTION = {
  provider: 'openai', modelName: 'm', connectionProfileId: 'p1', isLocal: false,
} as never

function makeJob(characterIds: string[] = []) {
  return {
    id: 'job-1',
    userId: USER,
    payload: {
      chatId: CHAT_ID,
      characterIds,
      imageProfileId: 'profile-1',
      sceneContext: 'the morning after',
      projectId: null,
    },
  } as never
}

const CHARACTER = {
  id: 'char-1',
  name: 'Amy',
  physicalDescription: 'a young woman',
  pronouns: { subject: 'she', object: 'her', possessive: 'her' },
}

const APPEARANCE = {
  characterId: 'char-1',
  characterName: 'Amy',
  physicalDescription: 'a young woman',
  physicalDescriptionName: 'Default',
  clothingDescription: 'naked, barefoot, wearing pearls',
  clothingSource: 'narrative',
  wasSanitized: false,
}

/** The `routesDangerousToUncensored` argument of the sanitization call. */
function sanitizeRoutesFlag(): boolean {
  return mockSanitizeAppearances.mock.calls[0][3] as boolean
}

/** The `uncensoredImageTarget` flag on the nth craft call. */
function craftTargetFlag(call = 0): boolean | undefined {
  const ctx = mockCraftPrompt.mock.calls[call][0] as { uncensoredImageTarget?: boolean }
  return ctx.uncensoredImageTarget
}

/** Wire the Concierge to a dangerous chat, with or without an uncensored image profile. */
function markDangerous(withUncensoredImageProfile: boolean) {
  mockShouldUseUncensoredRoute.mockReturnValue(true)
  mockResolveDanger.mockReturnValue({
    settings: {
      mode: 'AUTO_ROUTE',
      scanImagePrompts: true,
      uncensoredImageProfileId: withUncensoredImageProfile ? 'uncensored-image-profile' : null,
    },
  } as never)
  // Dangerous chats swap the cheap LLM for the uncensored text profile.
  mockResolveUncensoredCheap.mockReturnValue(SELECTION)
}

function imageProviderMock() {
  return mockCreateImageProvider.mock.results[
    mockCreateImageProvider.mock.results.length - 1
  ].value as { generateImage: jest.Mock }
}

beforeEach(() => {
  jest.clearAllMocks()

  mockGetRepositories.mockReturnValue({
    chats: {
      findById: jest.fn().mockResolvedValue({
        id: CHAT_ID, projectId: null, title: 'The Morning After',
        sceneState: null, messageCount: 0, contextSummary: null,
      }),
      getMessages: jest.fn().mockResolvedValue([]),
      getEquippedOutfitForCharacter: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    },
    characters: {
      findById: jest.fn().mockResolvedValue(null),
      findByUserId: jest.fn().mockResolvedValue([]),
    },
    imageProfiles: {
      findById: jest.fn().mockResolvedValue({
        id: 'profile-1', apiKeyId: 'key-1', modelName: 'image-model',
        provider: 'openai', name: 'Default Image Profile', parameters: {},
      }),
    },
    connections: {
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-test' }),
      findByUserId: jest.fn().mockResolvedValue([
        { id: 'p1', isDefault: true, provider: 'openai', modelName: 'm' },
      ]),
    },
    chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
    files: { create: jest.fn().mockResolvedValue({ id: 'file-1' }) },
  } as never)

  mockResolveDanger.mockReturnValue({ settings: { mode: 'OFF', scanImagePrompts: false } } as never)
  mockShouldUseUncensoredRoute.mockReturnValue(false)
  mockGetCheapLLM.mockReturnValue(SELECTION)
  mockResolveUncensoredCheap.mockReturnValue(SELECTION)
  mockExtractConversation.mockReturnValue([])
  mockDeriveScene.mockResolvedValue(null as never)
  mockCraftPrompt.mockResolvedValue({ success: true, result: CONCEALED_PROMPT } as never)
  mockIsModerationError.mockReturnValue(false)
  mockResolveReroute.mockResolvedValue(null as never)
  mockResolveAppearances.mockResolvedValue({
    appearances: [APPEARANCE], llmResolved: true,
  } as never)
  mockSanitizeAppearances.mockImplementation(async (a: never) => a)

  mockCreateImageProvider.mockImplementation(() => ({
    generateImage: jest.fn().mockResolvedValue({
      images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: null }],
    }),
  }) as never)

  mockConvertToWebP.mockResolvedValue({
    buffer: WEBP_BYTES, mimeType: 'image/webp',
    filename: 'story_background.webp', wasConverted: true,
  } as never)

  mockWriteLantern.mockResolvedValue({
    storageKey: 'mount-blob:mock-lantern:blob-1', mountPointId: 'mock-lantern',
    blobId: 'blob-1', relativePath: 'generated/story.webp',
    storedMimeType: 'image/webp', sizeBytes: WEBP_BYTES.length, sha256: 'unused',
  } as never)
})

describe('story-background handler — uncensoredImageTarget', () => {
  it('conceals for an ordinary chat', async () => {
    await handleStoryBackgroundGeneration(makeJob())

    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag()).toBe(false)
  })

  it('conceals for a dangerous chat with NO uncensored image profile configured', async () => {
    markDangerous(false)

    await handleStoryBackgroundGeneration(makeJob())

    expect(craftTargetFlag()).toBe(false)
  })

  it('crafts candidly for a dangerous chat with an uncensored image profile configured', async () => {
    markDangerous(true)

    await handleStoryBackgroundGeneration(makeJob())

    expect(craftTargetFlag()).toBe(true)
  })

  it('crafts candidly for an operator-Uncensored chat even under a global OFF (real predicate + resolver)', async () => {
    // The regression that motivated the four-state control: the operator
    // asserts the chat spicy, the global Concierge mode is OFF, and the
    // prompt must still go out candid and bound for the uncensored profile —
    // with every scan disabled (nothing left to classify).
    const actualOverride = jest.requireActual('@/lib/services/dangerous-content/chat-override')
    const actualResolver = jest.requireActual('@/lib/services/dangerous-content/resolver.service')
    mockShouldUseUncensoredRoute.mockImplementation(actualOverride.shouldUseUncensoredRoute)
    mockResolveDanger.mockImplementation(actualResolver.resolveDangerousContentSettings)

    const repos = mockGetRepositories() as never as {
      chats: { findById: jest.Mock }
      chatSettings: { findByUserId: jest.Mock }
    }
    repos.chats.findById.mockResolvedValue({
      id: CHAT_ID, projectId: null, title: 'The Morning After',
      sceneState: null, messageCount: 0, contextSummary: null,
      conciergeOverride: 'UNCENSORED', isDangerousChat: false,
    })
    repos.chatSettings.findByUserId.mockResolvedValue({
      dangerousContentSettings: {
        mode: 'OFF',
        threshold: 0.7,
        scanTextChat: true,
        scanImagePrompts: true,
        scanImageGeneration: false,
        displayMode: 'SHOW',
        showWarningBadges: true,
        uncensoredImageProfileId: 'uncensored-image-profile',
      },
    })

    await handleStoryBackgroundGeneration(makeJob())

    expect(craftTargetFlag()).toBe(true)
    // The resolver's settings actually reached the handler with the forced
    // AUTO_ROUTE and every scan off.
    const resolved = mockResolveDanger.mock.results[0].value as {
      settings: { mode: string; scanImagePrompts: boolean }
      source: string
    }
    expect(resolved.source).toBe('chat-uncensored')
    expect(resolved.settings.mode).toBe('AUTO_ROUTE')
    expect(resolved.settings.scanImagePrompts).toBe(false)
  })
})

describe('story-background handler — appearance sanitization gate', () => {
  /** Put a character in the job so appearance resolution actually runs. */
  function withCharacter() {
    const repos = mockGetRepositories() as unknown as Record<string, unknown>
    mockGetRepositories.mockReturnValue({
      ...repos,
      characters: {
        findById: jest.fn().mockResolvedValue(CHARACTER),
        findByUserId: jest.fn().mockResolvedValue([CHARACTER]),
      },
    } as never)
  }

  // Bug 133. The handler used to hand sanitization "an uncensored profile is
  // configured", but story backgrounds never route up front — so a moderated
  // chat's raw "naked, barefoot" appearance text sailed past the sanitizer and
  // into a prompt crafter working for a provider that promptly refused it.
  it('asks the sanitizer about routing, not about mere configuration', async () => {
    markDangerous(true)
    mockShouldUseUncensoredRoute.mockReturnValue(false) // ...but this chat is moderated
    withCharacter()

    await handleStoryBackgroundGeneration(makeJob(['char-1']))

    expect(mockSanitizeAppearances).toHaveBeenCalledTimes(1)
    expect(sanitizeRoutesFlag()).toBe(false)
  })

  it('leaves a flagged chat bound for the uncensored provider accurate', async () => {
    markDangerous(true)
    withCharacter()

    await handleStoryBackgroundGeneration(makeJob(['char-1']))

    expect(sanitizeRoutesFlag()).toBe(true)
  })
})

describe('story-background handler — moderation reroute', () => {
  /** First provider instance rejects for moderation; the reroute target accepts. */
  function rejectThenReroute() {
    mockIsModerationError.mockReturnValue(true)
    mockResolveReroute.mockResolvedValue({
      profile: {
        id: 'uncensored-image-profile', provider: 'openai',
        modelName: 'uncensored-model', parameters: {},
      },
      apiKey: 'sk-uncensored',
    } as never)

    let call = 0
    mockCreateImageProvider.mockImplementation(() => {
      call += 1
      return (call === 1
        ? { generateImage: jest.fn().mockRejectedValue(new Error('content moderation')) }
        : {
            generateImage: jest.fn().mockResolvedValue({
              images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: null }],
            }),
          }) as never
    })
  }

  // Bug 133. A moderated chat's rejected background used to be re-crafted
  // candidly and resent to the uncensored provider, so the provider's refusal
  // promoted a chat the user deliberately left moderated.
  it('does not reroute a moderated chat, failing the job instead', async () => {
    rejectThenReroute()

    await expect(handleStoryBackgroundGeneration(makeJob())).rejects.toThrow(
      /Image generation failed/,
    )

    expect(mockResolveReroute).not.toHaveBeenCalled()
    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag(0)).toBe(false)
  })

  it('does not reroute a dangerous chat with no uncensored image profile', async () => {
    markDangerous(false)
    rejectThenReroute()
    mockResolveReroute.mockResolvedValue(null as never)

    await expect(handleStoryBackgroundGeneration(makeJob())).rejects.toThrow(
      /Image generation failed/,
    )
  })

  it('resends the already-candid prompt for a flagged chat, without re-crafting', async () => {
    markDangerous(true)
    rejectThenReroute()
    mockCraftPrompt.mockResolvedValue({ success: true, result: CANDID_PROMPT } as never)

    await handleStoryBackgroundGeneration(makeJob())

    // One craft, made candidly up front — the reroute has nothing to un-drape.
    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag(0)).toBe(true)

    const sent = imageProviderMock().generateImage.mock.calls[0][0] as { prompt: string }
    expect(sent.prompt).toContain(CANDID_PROMPT)
  })
})
