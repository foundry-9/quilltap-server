/**
 * The story-background handler decides whether the crafted prompt is bound for
 * a moderated image provider or a Concierge uncensored one, and passes that as
 * `uncensoredImageTarget`. Appearance sanitization already steps aside for a
 * dangerous chat with an uncensored image profile configured; before this the
 * prompt crafter did not, so an uncensored provider still received a scene with
 * a sheet draped over it.
 *
 * Also locks the moderation-reroute path. Since the Concierge overhaul (phase
 * 1) a refused background is retried once on an uncensored understudy under
 * Auto-Route in any chat state but Locked — the old bug-133 gate that barred a
 * Moderated chat is gone — but the prompt is never re-crafted: a moderated chat's
 * concealed prompt is resent concealed, and an Unmoderated chat's candid prompt is
 * resent as-is. Under Detect Only nothing reroutes and the prompt stays
 * concealed even for an Unmoderated chat, and the Concierge says why.
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
import { resolveUncensoredImageUnderstudy } from '@/lib/services/dangerous-content/understudy'
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer'
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer'
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
  // The real derivation and failover gates (anything but Locked may fail
  // over), read by the resolver and the image failover chokepoint the handler
  // calls through; only the route question is steered per test.
  ...jest.requireActual('@/lib/services/dangerous-content/chat-override'),
  shouldUseUncensoredRoute: jest.fn(),
}))
jest.mock('@/lib/services/dangerous-content/understudy', () => ({
  resolveUncensoredImageUnderstudy: jest.fn(),
  resolveUncensoredTextUnderstudy: jest.fn(),
}))
jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeRefusalAnnouncement: jest.fn().mockResolvedValue(null),
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
const mockResolveReroute = jest.mocked(resolveUncensoredImageUnderstudy)
const mockAnnounceRefusal = jest.mocked(postConciergeRefusalAnnouncement)
const mockPostLantern = jest.mocked(postLanternImageNotification)
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

  it('crafts candidly for an operator-Unmoderated chat even under a global OFF (real predicate + resolver)', async () => {
    // The regression that motivated the operator's own state control: the operator
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
      conciergeMode: 'unmoderated', conciergeModeSetBy: 'operator', isDangerousChat: false,
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
    expect(resolved.source).toBe('chat-unmoderated')
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

  it('leaves an Unmoderated chat bound for the uncensored provider accurate', async () => {
    markDangerous(true)
    withCharacter()

    await handleStoryBackgroundGeneration(makeJob(['char-1']))

    expect(sanitizeRoutesFlag()).toBe(true)
  })
})

describe('story-background handler — moderation reroute', () => {
  const UNCENSORED = {
    id: 'uncensored-image-profile', provider: 'openai', name: 'Kestrel Studio',
    modelName: 'uncensored-model', parameters: {},
  }

  /** First provider instance rejects for moderation; the reroute target accepts. */
  function rejectThenReroute() {
    mockResolveReroute.mockResolvedValue({ profile: UNCENSORED, apiKey: 'sk-uncensored' } as never)

    let call = 0
    mockCreateImageProvider.mockImplementation(() => {
      call += 1
      return (call === 1
        ? { generateImage: jest.fn().mockRejectedValue(new Error('Generated image rejected by content moderation.')) }
        : {
            generateImage: jest.fn().mockResolvedValue({
              images: [{ b64Json: Buffer.from('png').toString('base64'), mimeType: 'image/png', revisedPrompt: null }],
            }),
          }) as never
    })
  }

  function firstSentPrompt(): string {
    const first = mockCreateImageProvider.mock.results[0].value as { generateImage: jest.Mock }
    return (first.generateImage.mock.calls[0][0] as { prompt: string }).prompt
  }

  it('reroutes a Moderated chat under Auto-Route, resending the concealed prompt unchanged', async () => {
    mockResolveDanger.mockReturnValue({
      settings: { mode: 'AUTO_ROUTE', scanImagePrompts: false, uncensoredImageProfileId: null },
    } as never)
    rejectThenReroute()

    await handleStoryBackgroundGeneration(makeJob())

    expect(mockResolveReroute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, exclude: ['profile-1'] }),
    )
    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag(0)).toBe(false)
    const second = imageProviderMock().generateImage.mock.calls[0][0] as { prompt: string }
    expect(second.prompt).toContain(CONCEALED_PROMPT)

    expect(mockAnnounceRefusal).toHaveBeenCalledWith(expect.objectContaining({
      chatId: CHAT_ID,
      kind: 'refusal-rerouted',
      details: expect.objectContaining({ purpose: 'lantern', answeringProfileName: 'Kestrel Studio' }),
    }))
    // The Lantern's bubble carries the call sheet: refused, then answered.
    const lanternCall = mockPostLantern.mock.calls[0][0] as { routeTrail?: Array<{ outcome: string; profileKind?: string }> }
    expect(lanternCall.routeTrail?.map(a => a.outcome)).toEqual(['refused', 'answered'])
    expect(lanternCall.routeTrail?.every(a => a.profileKind === 'image')).toBe(true)
    // The file records the model that actually drew it.
    const repos = mockGetRepositories() as never as { files: { create: jest.Mock } }
    expect(repos.files.create.mock.calls[0][0]).toMatchObject({ generationModel: 'uncensored-model' })
  })

  it('does not reroute under Detect Only, keeps even an Unmoderated chat\'s prompt concealed, and says why', async () => {
    mockShouldUseUncensoredRoute.mockReturnValue(true)
    mockResolveDanger.mockReturnValue({
      settings: { mode: 'DETECT_ONLY', scanImagePrompts: true, uncensoredImageProfileId: 'uncensored-image-profile' },
    } as never)
    rejectThenReroute()

    await expect(handleStoryBackgroundGeneration(makeJob())).rejects.toThrow(/Image generation failed/)

    expect(craftTargetFlag(0)).toBe(false)
    expect(mockResolveReroute).not.toHaveBeenCalled()
    expect(mockAnnounceRefusal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refusal-not-permitted' }))
  })

  it('fails the job, and says so, when there is no uncensored understudy', async () => {
    markDangerous(false)
    rejectThenReroute()
    mockResolveReroute.mockResolvedValue(null as never)

    await expect(handleStoryBackgroundGeneration(makeJob())).rejects.toThrow(
      /Image generation failed/,
    )
    expect(mockAnnounceRefusal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'refusal-no-understudy' }))
  })

  it('resends the already-candid prompt for an Unmoderated chat, without re-crafting', async () => {
    markDangerous(true)
    rejectThenReroute()
    mockCraftPrompt.mockResolvedValue({ success: true, result: CANDID_PROMPT } as never)

    await handleStoryBackgroundGeneration(makeJob())

    // One craft, made candidly up front — the reroute has nothing to un-drape.
    expect(mockCraftPrompt).toHaveBeenCalledTimes(1)
    expect(craftTargetFlag(0)).toBe(true)
    expect(firstSentPrompt()).toContain(CANDID_PROMPT)

    const sent = imageProviderMock().generateImage.mock.calls[0][0] as { prompt: string }
    expect(sent.prompt).toContain(CANDID_PROMPT)
  })

  it('leaves a non-moderation failure alone: no reroute, no announcement', async () => {
    mockResolveDanger.mockReturnValue({ settings: { mode: 'AUTO_ROUTE', scanImagePrompts: false } } as never)
    mockCreateImageProvider.mockImplementation(() => ({
      generateImage: jest.fn().mockRejectedValue(new Error('429 Too Many Requests')),
    }) as never)

    await expect(handleStoryBackgroundGeneration(makeJob())).rejects.toThrow(/429/)
    expect(mockResolveReroute).not.toHaveBeenCalled()
    expect(mockAnnounceRefusal).not.toHaveBeenCalled()
  })
})
