/**
 * The OFF-SCENE rehearsal (`generateCharacterVoicedAnnouncement`).
 *
 * This one has no golden of its own, but the Insert Announcement dialog and
 * `help/insert-announcement.md` both describe its behaviour in detail, and it
 * now shares a core with the in-scene rehearsal. The snapshot below is the
 * guard on that refactor: the composed messages must not drift.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

jest.mock('@/lib/memory/memory-service', () => ({
  searchMemoriesSemantic: jest.fn(async () => []),
}))

jest.mock('@/lib/memory/memory-subject', () => ({
  buildMemorySubjectContext: jest.fn(async () => ({})),
}))

jest.mock('@/lib/chat/context/memory-injector', () => ({
  formatDynamicMemoryHead: jest.fn(() => ({ content: 'REMEMBERED' })),
}))

jest.mock('@/lib/services/commonplace-notifications/writer', () => ({
  buildCommonplaceLLMContext: jest.fn(({ relevant }: { relevant: string }) => `RECALL<${relevant}>`),
}))

jest.mock('@/lib/chat/context/system-prompt-builder', () => ({
  buildSystemPrompt: jest.fn(() => 'SYSTEM'),
}))

import { generateCharacterVoicedAnnouncement } from '@/lib/services/announcer/character-voiced'
import { getRepositories } from '@/lib/repositories/factory'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'

const mockRepos = getRepositories as jest.Mock
const mockExecute = executeCheapLLMTask as jest.Mock
const mockRecall = searchMemoriesSemantic as jest.Mock
const mockBuildSystemPrompt = buildSystemPrompt as jest.Mock

const AURORA = { id: 'char-aurora', name: 'Aurora' }
const PROFILE = {
  id: 'prof-1',
  name: 'Everyday',
  provider: 'ANTHROPIC',
  modelName: 'claude-sonnet-5',
}

const CHAT = {
  id: 'chat-1',
  participants: [
    { id: 'seat-bertie', type: 'CHARACTER', characterId: 'char-bertie', status: 'active' },
    { id: 'seat-jeeves', type: 'CHARACTER', characterId: 'char-jeeves', status: 'silent' },
    { id: 'seat-gone', type: 'CHARACTER', characterId: 'char-gone', status: 'absent' },
  ],
}

const NAMES: Record<string, string> = {
  'char-bertie': 'Bertie',
  'char-jeeves': 'Jeeves',
  'char-gone': 'Someone Departed',
  'char-aurora': 'Aurora',
}

function primeRepos() {
  mockRepos.mockReturnValue({
    chats: { findById: jest.fn(async () => CHAT) },
    characters: { findById: jest.fn(async (id: string) => ({ id, name: NAMES[id] })) },
  })
}

function run(over: Record<string, unknown> = {}) {
  return generateCharacterVoicedAnnouncement({
    chatId: 'chat-1',
    character: AURORA as never,
    profile: PROFILE as never,
    seedMarkdown: 'The wardrobe has been refreshed.',
    userId: 'user-1',
    ...over,
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  primeRepos()
  mockRecall.mockResolvedValue([])
  mockExecute.mockResolvedValue({ success: true, result: 'Aurora steps from behind the screen.' })
})

describe('generateCharacterVoicedAnnouncement', () => {
  it('composes a public announcement exactly as before the shared-core refactor', async () => {
    await run()
    expect(mockExecute.mock.calls[0][1]).toMatchSnapshot()
  })

  it('composes a whispered announcement exactly as before the shared-core refactor', async () => {
    mockRecall.mockResolvedValue([{ memory: { id: 'mem-1' } }])
    await run({ audienceNames: ['Bertie', 'Jeeves'] })
    expect(mockExecute.mock.calls[0][1]).toMatchSnapshot()
  })

  it('keeps its own flat token budget, task type, and identity-only system prompt', async () => {
    await run()
    const call = mockExecute.mock.calls[0]
    expect(call[4]).toBe('announcement-rewrite')
    expect(call[8]).toBe(2048)
    expect(call[9]).toBe('char-aurora')
    // No roleplay template, no Taboo, no tools — the off-scene rehearsal is
    // deliberately identity-only.
    expect(mockBuildSystemPrompt.mock.calls[0][0]).toEqual({
      character: AURORA,
      selectedSystemPromptId: null,
    })
  })

  it('reports a provider failure rather than throwing', async () => {
    mockExecute.mockResolvedValue({ success: false, error: 'the model refused' })
    expect(await run()).toEqual({
      success: false,
      proposedMarkdown: '',
      error: 'the model refused',
    })
  })

  it('tolerates a recall failure', async () => {
    mockRecall.mockRejectedValue(new Error('embedding provider is down'))
    const result = await run()
    expect(result.success).toBe(true)
    expect(JSON.stringify(mockExecute.mock.calls[0][1])).not.toContain('RECALL<')
  })
})
