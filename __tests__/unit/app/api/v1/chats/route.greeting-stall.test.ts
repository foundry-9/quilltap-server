/**
 * POST /api/v1/chats — the greeting ladder when the provider goes quiet.
 *
 * Bug 141: a provider that accepted the request, answered with headers and then
 * sent no body held the create route open forever, and with it the Green Room
 * dialog, which cannot be dismissed. The stream watchdog turns that silence
 * into an `LLMStreamStalledError`; this file covers what the ladder does with
 * one. Every rung below a stall goes back to the same silent provider, so the
 * ladder ends there and the scripted greeting takes over.
 *
 * Uses the global `jest` (not @jest/globals) so jest.mock(...) calls hoist
 * above the ES module imports under the SWC transform.
 */

// ---------------------------------------------------------------------------
// Heavy dependency mocks — the route just needs to traverse them intact.
// ---------------------------------------------------------------------------

jest.mock('@/lib/chat/initialize', () => ({
  buildChatContext: jest.fn(),
}))

jest.mock('@/lib/chat/initial-greeting', () => ({
  generateGreetingMessage: jest.fn(),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn().mockResolvedValue({ rerouted: false }),
}))

jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn().mockResolvedValue({ newState: 'moderated', changed: false }),
}))

jest.mock('@/lib/chat/first-message-context', () => ({
  buildFirstMessageContext: jest.fn().mockResolvedValue({
    participantMemories: [],
    projectContext: null,
  }),
}))

jest.mock('@/lib/memory/memory-recap', () => ({
  buildRecentConversationsBlock: jest.fn().mockResolvedValue(''),
  calculateRecentConversationsLimit: jest.fn().mockReturnValue(0),
}))

jest.mock('@/lib/llm/model-context-data', () => ({
  getModelContextLimit: jest.fn().mockReturnValue(128000),
}))

jest.mock('@/lib/wardrobe/apply-outfit-selections', () => ({
  applyOutfitSelections: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/llm/cheap-llm', () => ({
  ...jest.requireActual('@/lib/llm/cheap-llm'),
  buildCheapLLMConfig: jest.fn().mockReturnValue(null),
}))

jest.mock('@/lib/services/chat-enrichment.service', () => ({
  enrichParticipantSummary: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
  enrichChatsForList: jest.fn().mockImplementation((chats: unknown) => chats),
  filterChatsByExcludedTags: jest.fn().mockImplementation((chats: unknown) => chats),
  cleanEnrichedChats: jest.fn().mockImplementation((chats: unknown) => chats),
}))

jest.mock('@/lib/import/sillytavern-import-service', () => ({
  importMultiCharacterChat: jest.fn(),
  importLegacyChat: jest.fn(),
}))

jest.mock('@/lib/services/host-notifications/writer', () => ({
  postHostAddAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostScenarioAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostUserCharacterAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostContinuationFromAnnouncement: jest.fn().mockResolvedValue(undefined),
  postHostContinuationToAnnouncement: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/aurora-notifications/writer', () => ({
  postOpeningOutfitWhisper: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/wardrobe/avatar-generation', () => ({
  triggerAvatarGenerationIfEnabled: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  loadProsperoProjectContext: jest.fn().mockResolvedValue(null),
  loadProsperoGeneralContext: jest.fn().mockResolvedValue(null),
  postProsperoContextAnnouncement: jest.fn().mockResolvedValue(undefined),
  postProsperoGroupContextWhisper: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  compileAllIdentityStacks: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/chat/apply-chat-continuation', () => ({
  applyChatContinuation: jest.fn().mockResolvedValue({
    replayedMessageCount: 0,
    hadLibrarianSummary: false,
    postedSourceTailBubble: false,
  }),
}))

jest.mock('@/lib/services/chat-message/autonomous-room.service', () => ({
  startAutonomousRoomManually: jest.fn().mockResolvedValue({ ok: true }),
}))

// ---------------------------------------------------------------------------
// Imports under test must come after the mocks above.
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/v1/chats/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import { buildChatContext } from '@/lib/chat/initialize'
import { generateGreetingMessage } from '@/lib/chat/initial-greeting'
import { LLMStreamStalledError } from '@/lib/llm/stream-watchdog'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import {
  createMockRepositoryContainer,
  setupAuthMocks,
  type MockRepositoryContainer,
} from '@/__tests__/unit/lib/fixtures/mock-repositories'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'c1111111-1111-4111-8111-111111111111'
const CHAR_ID = 'c2222222-2222-4222-8222-222222222222'
const PROFILE_ID = 'c3333333-3333-4333-8333-333333333333'
const NEW_CHAT_ID = 'c4444444-4444-4444-8444-444444444444'

const mockedBuildChatContext = buildChatContext as unknown as jest.Mock
const mockedGenerateGreeting = generateGreetingMessage as unknown as jest.Mock

function makeCharacter() {
  return {
    id: CHAR_ID,
    userId: USER_ID,
    name: 'Alice',
    description: '',
    personality: '',
    manifesto: null,
    identity: '',
    title: '',
    scenarios: [],
    systemPrompts: [
      { id: 'sp-1', name: 'Default', content: 'You are a character.', isDefault: true, createdAt: '', updatedAt: '' },
    ],
    tags: [],
    controlledBy: 'llm',
    talkativeness: 0.5,
    defaultPartnerId: null,
    defaultTimestampConfig: null,
    defaultScenarioId: null,
    defaultImageProfileId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeConnectionProfile() {
  return {
    id: PROFILE_ID,
    userId: USER_ID,
    name: 'DeepSeek V4 Flash Thinking',
    provider: 'DEEPSEEK',
    modelName: 'deepseek-v4-flash',
    baseUrl: null,
    apiKeyId: null,
    isDefault: false,
    parameters: {},
  }
}

function makeCreatedChat(conciergeMode: 'moderated' | 'unmoderated' | 'locked' | null = null) {
  return {
    id: NEW_CHAT_ID,
    userId: USER_ID,
    title: 'Chat with Alice',
    chatType: 'salon',
    participants: [
      { id: 'np-a', type: 'CHARACTER', characterId: CHAR_ID, controlledBy: 'llm', isActive: true, displayOrder: 0 },
    ],
    messageCount: 0,
    conciergeMode,
    conciergeModeSetBy: conciergeMode === 'unmoderated' || conciergeMode === 'locked' ? 'operator' : null,
    isDangerousChat: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeUncensoredProfile() {
  return {
    id: 'c7777777-7777-4777-8777-777777777777',
    userId: USER_ID,
    name: 'The frank desk',
    provider: 'OPENROUTER',
    modelName: 'frank-model',
    baseUrl: null,
    apiKeyId: null,
    isDefault: false,
    parameters: {},
  }
}

function createMockRequest(body: Record<string, unknown>) {
  return {
    url: 'http://localhost:3000/api/v1/chats',
    method: 'POST',
    nextUrl: new URL('http://localhost:3000/api/v1/chats'),
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any
}

function baseBody() {
  return {
    title: 'Chat with Alice',
    participants: [
      { type: 'CHARACTER', characterId: CHAR_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
    ],
  }
}

/** The ASSISTANT opening line, whatever produced it. */
function openingLine(addMessage: jest.Mock): string | undefined {
  const call = addMessage.mock.calls.find(([, event]) => event?.role === 'ASSISTANT')
  return call?.[1]?.content
}

describe('POST /api/v1/chats — a greeting the provider never delivers', () => {
  let mockRepos: MockRepositoryContainer

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepositoryContainer()

    ;(mockRepos.chats as any).getEquippedOutfitForCharacter = jest.fn().mockResolvedValue(null)
    ;(mockRepos as any).wardrobe = { findByIdsForCharacter: jest.fn().mockResolvedValue([]) }
    ;(mockRepos as any).projects = {
      findById: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    }

    setupAuthMocks(getServerSession as unknown as jest.Mock, mockRepos, {
      id: USER_ID,
      email: 'csebold@example.com',
      name: 'Test User',
    } as any)

    ;(getRepositoriesSafe as unknown as jest.Mock).mockResolvedValue(mockRepos)
    ;(getRepositories as unknown as jest.Mock).mockReturnValue(mockRepos)

    // No scripted first message, so the route runs the greeting ladder.
    mockedBuildChatContext.mockResolvedValue({
      systemPrompt: 'system prompt',
      firstMessage: '',
      character: { id: CHAR_ID, name: 'Alice' },
      userCharacter: null,
      persona: null,
    })

    mockRepos.chats.findById.mockImplementation(async (id: string) =>
      id === NEW_CHAT_ID ? (makeCreatedChat() as any) : null
    )
    mockRepos.characters.findById.mockImplementation(async (id: string) =>
      id === CHAR_ID ? (makeCharacter() as any) : null
    )
    mockRepos.connections.findById.mockResolvedValue(makeConnectionProfile() as any)
    mockRepos.chats.create.mockImplementation(async () => makeCreatedChat() as any)
    mockRepos.chatSettings.findByUserId.mockResolvedValue({
      userId: USER_ID,
      dangerousContentSettings: { mode: 'OFF', threshold: 0.7 },
    } as any)
    ;(resolveProviderForDangerousContent as unknown as jest.Mock).mockResolvedValue({ rerouted: false })
  })

  it('stops the ladder on the first stall rather than spending another budget on the same silence', async () => {
    mockedGenerateGreeting.mockRejectedValue(
      new LLMStreamStalledError(90000, 0, 'DEEPSEEK', 'deepseek-v4-flash')
    )

    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    expect(mockedGenerateGreeting).toHaveBeenCalledTimes(1)
  })

  it('still opens the chat, with the scripted greeting in place of the generated one', async () => {
    mockedGenerateGreeting.mockRejectedValue(
      new LLMStreamStalledError(90000, 0, 'DEEPSEEK', 'deepseek-v4-flash')
    )

    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    expect(openingLine(mockRepos.chats.addMessage as unknown as jest.Mock)).toContain(
      "I'm Alice"
    )
  })

  it('keeps retrying an ordinary failure — only a silence ends the ladder', async () => {
    mockedGenerateGreeting.mockRejectedValue(new Error('502 Bad Gateway'))

    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    // Attempt 1 and the final plain retry; the memory-stripping rung is skipped
    // because this fixture carries no participant memories.
    expect(mockedGenerateGreeting).toHaveBeenCalledTimes(2)
  })

  it('leaves a healthy greeting alone', async () => {
    mockedGenerateGreeting.mockResolvedValue({ content: 'Good evening.', reasoningContent: '' })

    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    expect(mockedGenerateGreeting).toHaveBeenCalledTimes(1)
    expect(openingLine(mockRepos.chats.addMessage as unknown as jest.Mock)).toBe('Good evening.')
  })

  it('does not let a silence at the uncensored desk condemn the character\u2019s own profile', async () => {
    // An Unmoderated chat opens at the frank desk, which is a different
    // profile on a different provider. Its going quiet says nothing about
    // whether this character's own profile will.
    const uncensoredChat = makeCreatedChat('unmoderated')
    mockRepos.chats.findById.mockImplementation(async (id: string) =>
      id === NEW_CHAT_ID ? (uncensoredChat as any) : null
    )
    mockRepos.chats.create.mockImplementation(async () => uncensoredChat as any)
    ;(resolveProviderForDangerousContent as unknown as jest.Mock).mockResolvedValue({
      rerouted: true,
      connectionProfile: makeUncensoredProfile(),
      apiKey: 'frank-key',
      reason: 'configured uncensored profile',
    })

    mockedGenerateGreeting
      .mockRejectedValueOnce(new LLMStreamStalledError(90000, 0, 'OPENROUTER', 'frank-model'))
      .mockResolvedValueOnce({ content: 'Well then.', reasoningContent: '' })

    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    expect(mockedGenerateGreeting).toHaveBeenCalledTimes(2)
    expect(openingLine(mockRepos.chats.addMessage as unknown as jest.Mock)).toBe('Well then.')
  })
})
