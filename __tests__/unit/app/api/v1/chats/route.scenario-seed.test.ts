/**
 * POST /api/v1/chats — the scenario does not become the summary (bug 158).
 *
 * A scenario is a stage direction for a conversation that has not happened;
 * `contextSummary` is a record of one that has. Chat creation wrote the chosen
 * scenario into both columns — a leftover from before `scenarioText` existed —
 * so every reader of `contextSummary` believed a brand-new chat had already
 * been summarized. The greeting's "Recent Conversations" block inlines that
 * column, so an unsummarized prior chat handed the next greeting its scenario
 * and the character opened in the wrong room.
 *
 * Uses the global `jest` (not @jest/globals) so jest.mock(...) calls hoist
 * above the ES module imports under the SWC transform.
 */

// ---------------------------------------------------------------------------
// Heavy dependency mocks — the route just needs to traverse them intact.
// ---------------------------------------------------------------------------

jest.mock('@/lib/chat/initialize', () => ({
  buildChatContext: jest.fn().mockResolvedValue({
    systemPrompt: 'system prompt',
    firstMessage: 'hi',
    character: { id: 'char-a', name: 'Alice' },
    userCharacter: null,
    persona: null,
  }),
}))

jest.mock('@/lib/chat/initial-greeting', () => ({
  generateGreetingMessage: jest.fn().mockResolvedValue({ content: '' }),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveDangerousContentSettings: jest.fn().mockReturnValue({
    settings: { mode: 'DISABLED' },
  }),
}))

jest.mock('@/lib/services/dangerous-content/provider-routing.service', () => ({
  resolveProviderForDangerousContent: jest.fn(),
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
const SCENARIO_ID = 'c5555555-5555-4555-8555-555555555555'

const SCENARIO_BODY = [
  "# Scenario: Amy's Pool",
  '',
  'Amy is in her pool, and Charlie walks up the path and sits down on the flat',
  'rocks next to it.',
].join('\n')

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
    scenarios: [{ id: SCENARIO_ID, name: "Amy's Pool", content: SCENARIO_BODY }],
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
    name: 'Test profile',
    provider: 'ANTHROPIC',
    modelName: 'claude-test',
    baseUrl: null,
    apiKeyId: null,
    isDefault: false,
    parameters: {},
  }
}

function makeCreatedChat() {
  return {
    id: NEW_CHAT_ID,
    userId: USER_ID,
    title: 'Chat with Alice',
    chatType: 'salon',
    participants: [
      { id: 'np-a', type: 'CHARACTER', characterId: CHAR_ID, controlledBy: 'llm', isActive: true, displayOrder: 0 },
    ],
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

function baseBody(extra: Record<string, unknown> = {}) {
  return {
    title: 'Chat with Alice',
    participants: [
      { type: 'CHARACTER', characterId: CHAR_ID, connectionProfileId: PROFILE_ID, controlledBy: 'llm' },
    ],
    ...extra,
  }
}

/** The row the route handed to chats.create. */
function createdChatRow(mockRepos: MockRepositoryContainer) {
  return mockRepos.chats.create.mock.calls[0][0] as {
    contextSummary?: string | null
    scenarioText?: string | null
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/chats — the scenario does not become the summary (bug 158)', () => {
  let mockRepos: MockRepositoryContainer

  beforeEach(() => {
    jest.clearAllMocks()
    mockRepos = createMockRepositoryContainer()

    ;(mockRepos.chats as any).getEquippedOutfitForCharacter = jest.fn().mockResolvedValue(null)
    ;(mockRepos as any).wardrobe = { findByIds: jest.fn().mockResolvedValue([]) }
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

    mockRepos.chats.findById.mockImplementation(async (id: string) =>
      id === NEW_CHAT_ID ? (makeCreatedChat() as any) : null
    )
    mockRepos.characters.findById.mockImplementation(async (id: string) =>
      id === CHAR_ID ? (makeCharacter() as any) : null
    )
    mockRepos.connections.findById.mockResolvedValue(makeConnectionProfile() as any)
    mockRepos.chats.create.mockResolvedValue(makeCreatedChat() as any)
    mockRepos.chatSettings.findByUserId.mockResolvedValue({ userId: USER_ID } as any)
  })

  it('stores the chosen scenario in scenarioText and leaves contextSummary null', async () => {
    const res = await POST(createMockRequest(baseBody({ scenarioId: SCENARIO_ID })))

    expect(res.status).toBe(201)
    const row = createdChatRow(mockRepos)
    expect(row.scenarioText).toBe(SCENARIO_BODY)
    expect(row.contextSummary).toBeNull()
  })

  it('leaves contextSummary null when no scenario was chosen at all', async () => {
    const res = await POST(createMockRequest(baseBody()))

    expect(res.status).toBe(201)
    const row = createdChatRow(mockRepos)
    expect(row.scenarioText).toBeNull()
    expect(row.contextSummary).toBeNull()
  })

  it('never writes the scenario text into contextSummary, whatever the scenario is', async () => {
    await POST(createMockRequest(baseBody({ scenarioId: SCENARIO_ID })))

    const row = createdChatRow(mockRepos)
    // The precise shape of bug 158: the two columns holding the same bytes is
    // what made a stage direction look like a record of a conversation.
    expect(row.contextSummary).not.toBe(row.scenarioText)
  })
})
