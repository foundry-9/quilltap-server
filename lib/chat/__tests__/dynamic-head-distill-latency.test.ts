/**
 * Bug 115 — the dynamic-head distillation is awaited inside a visible turn, so
 * it must ask for the interactive budget.
 *
 * `extractMemorySearchKeywords` serves two consumers with opposite answers to
 * "is anyone waiting?": the proactive pre-compute pass runs after delivery and
 * wants the generous `background` tier, while this fallback in `buildContext`
 * blocks the turn with an empty composer in front of the operator. The tier is
 * therefore the caller's to name, and bug 115 was this caller not naming it —
 * inheriting 90s *and* the free timeout retry a background pass is entitled to,
 * i.e. up to three minutes of nothing per responding character whenever the
 * cheap route stalled.
 *
 * The budget arithmetic itself is covered in
 * `lib/memory/cheap-llm-tasks/__tests__/task-deadline.test.ts`. What is asserted
 * here is only that the argument leaves this call site, because that is the half
 * bug 107's fix got right for its two siblings and missed here.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildContext } from '@/lib/chat/context-manager'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// The distillation runs inside the recall query stage; the cheap-LLM call it
// makes is where the latency class lands.
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  ...jest.requireActual('@/lib/memory/cheap-llm-tasks/core-execution'),
  executeCheapLLMTask: jest.fn(),
}))

jest.mock('@/lib/embedding/embedding-service', () => ({
  ...jest.requireActual('@/lib/embedding/embedding-service'),
  generateEmbeddingForUser: jest.fn().mockRejectedValue(new Error('no embedding profile in this test')),
}))

jest.mock('@/lib/memory/recall/search', () => ({
  searchRecall: jest.fn().mockResolvedValue({ candidates: [], strategy: 'text', trace: [] }),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { getRepositories } from '@/lib/repositories/factory'
import type { Character, ChatParticipantBase } from '@/lib/schemas/types'

const mockedTask = jest.mocked(executeCheapLLMTask)
/** The cheap-LLM calls the keyword distillation made. */
const distillCalls = () => mockedTask.mock.calls.filter(call => call[4] === 'memory-keyword-extraction')

const timestamp = new Date().toISOString()

const participantA = {
  id: 'participant-a',
  type: 'CHARACTER',
  characterId: 'char-a',
  controlledBy: 'llm',
  displayOrder: 0,
  isActive: true,
  status: 'active',
  hasHistoryAccess: true,
  createdAt: timestamp,
  updatedAt: timestamp,
} as unknown as ChatParticipantBase

/**
 * Only the fields `buildContext` reads on this path. Cast rather than spelled
 * in full: this test is about one argument at one call site, and a complete
 * `Character` literal here would be a second copy of that type to keep current.
 */
const characterA = {
  id: 'char-a',
  userId: 'user',
  name: 'Lyra',
  description: null,
  personality: null,
  systemPrompts: [],
  talkativeness: 0.6,
  tags: [],
  createdAt: timestamp,
  updatedAt: timestamp,
} as unknown as Character

beforeEach(() => {
  jest.clearAllMocks()
  mockedTask.mockResolvedValue({
    success: true,
    result: { keywords: ['the mission'], paraphrase: 'what happened on the mission' },
  } as never)
  jest.mocked(getRepositories).mockReturnValue({
    memories: {
      findMostImportant: jest.fn().mockResolvedValue([]),
      findHotDigests: jest.fn().mockResolvedValue([]),
      findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]),
    },
    characters: { findByUserId: jest.fn().mockResolvedValue([characterA]) },
    chats: { getMessages: jest.fn().mockResolvedValue([]), addMessage: jest.fn() },
    // buildContext always asks this seat what it is owed; nothing pending.
    chatInforms: {
      findPendingForParticipant: jest.fn().mockResolvedValue([]),
      findConsumedByMessages: jest.fn().mockResolvedValue([]),
    },
  } as never)
})

/** A turn with no pre-searched memories, so the fallback distillation runs. */
const buildATurn = () =>
  buildContext({
    provider: 'OPENAI',
    modelName: 'gpt-4o',
    userId: 'user',
    character: characterA,
    chat: {
      id: 'chat-1',
      userId: 'user',
      participants: [participantA],
      title: 'Test Chat',
      contextSummary: null,
      sillyTavernMetadata: null,
      tags: [],
      messageCount: 2,
      lastMessageAt: timestamp,
      lastRenameCheckInterchange: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    existingMessages: [
      { role: 'USER', content: 'Hello', id: 'm1' },
      { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
    ],
    newUserMessage: 'No, no. I mean the mission today.',
    embeddingProfileId: null,
    skipMemories: false,
    maxMemories: 1,
    minMemoryImportance: 0.3,
    respondingParticipant: participantA,
    allParticipants: [participantA],
    participantCharacters: new Map([['char-a', characterA]]),
    messagesWithParticipants: [],
    cheapLLMSelection: {
      provider: 'DEEPSEEK',
      modelName: 'deepseek-v4-flash',
      connectionProfileId: 'p1',
      isLocal: false,
    },
  } as never)

it('asks for the interactive budget — the turn is blocked behind this call', async () => {
  await buildATurn()

  expect(distillCalls()).toHaveLength(1)
  // The task options. Not `undefined`, which is the background tier by
  // omission and is what bug 115 was.
  expect(distillCalls()[0][10]).toEqual({ latency: 'interactive' })
})
