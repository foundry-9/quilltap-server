/**
 * The IN-SCENE rehearsal (`generateInSceneVoicedLine`).
 *
 * The contract that matters is what the impersonated character is shown. The
 * line is about to be *played*, so unlike the off-scene announcer it gets the
 * full per-turn briefing — roleplay template, Taboo, standing instructions —
 * and the transcript as that seat would see it. What it must never get is
 * tools. And because this is a rehearsal rather than a turn, nothing it touches
 * may throw: a dead recall, a dead provider, a bystander with a broken vault
 * all have to come back as a result the dialog can act on.
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

jest.mock('@/lib/services/system-prompt-compiler/compiler', () => ({
  getCompiledIdentityStack: jest.fn(() => 'STACK'),
}))

jest.mock('@/lib/chat/context/standing-instructions', () => ({
  resolveStandingInstructionsSection: jest.fn(async () => 'STANDING'),
}))

jest.mock('@/lib/instance-settings', () => ({
  getTabooSettings: jest.fn(async () => ({ phrases: ['not this phrase'] })),
}))

jest.mock('@/lib/services/chat-message/participant-resolver.service', () => ({
  getRoleplayTemplate: jest.fn(async () => ({ systemPrompt: 'TEMPLATE' })),
}))

jest.mock('@/lib/services/chat-message/user-identity-resolver.service', () => ({
  resolveUserIdentity: jest.fn(async () => ({
    name: 'The Proprietor',
    description: 'owns the place',
    source: 'chat-participant',
  })),
}))

import {
  generateInSceneVoicedLine,
  maxTokensForSeed,
  IN_SCENE_REWRITE_WINDOW,
} from '@/lib/services/announcer/in-scene-voiced'
import { getRepositories } from '@/lib/repositories/factory'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { buildSystemPrompt } from '@/lib/chat/context/system-prompt-builder'
import { getTabooSettings } from '@/lib/instance-settings'

const mockRepos = getRepositories as jest.Mock
const mockExecute = executeCheapLLMTask as jest.Mock
const mockRecall = searchMemoriesSemantic as jest.Mock
const mockBuildSystemPrompt = buildSystemPrompt as jest.Mock
const mockTaboo = getTabooSettings as jest.Mock

type AnyRecord = Record<string, unknown>

const SEAT = {
  id: 'seat-evangeline',
  type: 'CHARACTER' as const,
  characterId: 'char-evangeline',
  status: 'active',
  controlledBy: 'llm',
  hasHistoryAccess: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  connectionProfileId: 'prof-1',
  selectedSystemPromptId: null,
  selectedSubpromptIds: [],
}

const OTHER_SEAT = {
  id: 'seat-bertie',
  type: 'CHARACTER' as const,
  characterId: 'char-bertie',
  status: 'active',
  controlledBy: 'user',
  hasHistoryAccess: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const EVANGELINE = { id: 'char-evangeline', name: 'Evangeline', systemPrompts: [] }
const BERTIE = { id: 'char-bertie', name: 'Bertie', systemPrompts: [] }

const CHAT = {
  id: 'chat-1',
  projectId: null,
  scenarioText: null,
  participants: [SEAT, OTHER_SEAT],
  impersonatingParticipantIds: ['seat-evangeline'],
}

const PROFILE = {
  id: 'prof-1',
  name: 'Everyday',
  provider: 'ANTHROPIC',
  modelName: 'claude-sonnet-5',
}

function msg(over: AnyRecord): AnyRecord {
  return {
    type: 'message',
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'USER',
    content: 'something',
    createdAt: '2026-02-01T00:00:00.000Z',
    participantId: null,
    targetParticipantIds: null,
    systemSender: null,
    hostEvent: null,
    ...over,
  }
}

let messages: AnyRecord[] = []

function primeRepos(over: { characterFindById?: jest.Mock } = {}) {
  const findById =
    over.characterFindById
    ?? jest.fn(async (id: string) => (id === 'char-evangeline' ? EVANGELINE : BERTIE))
  mockRepos.mockReturnValue({
    chatSettings: { findByUserId: jest.fn(async () => ({ defaultRoleplayTemplateId: null })) },
    chats: { getMessages: jest.fn(async () => messages) },
    characters: { findById },
  })
}

function run(over: AnyRecord = {}) {
  return generateInSceneVoicedLine({
    chat: CHAT as never,
    participant: SEAT as never,
    character: EVANGELINE as never,
    profile: PROFILE as never,
    seedMarkdown: 'I tell him I will take the job, but only for double.',
    systemPromptId: null,
    subprompts: null,
    userId: 'user-1',
    ...over,
  } as never)
}

/** The user-role message the rewrite instruction rides on (always last). */
function lastUserMessage(): string {
  const sent = mockExecute.mock.calls[0][1] as Array<{ role: string; content: string }>
  return sent[sent.length - 1].content
}

function sentMessages(): Array<{ role: string; content: string; name?: string }> {
  return mockExecute.mock.calls[0][1]
}

beforeEach(() => {
  jest.clearAllMocks()
  messages = []
  primeRepos()
  mockRecall.mockResolvedValue([])
  mockTaboo.mockResolvedValue({ phrases: ['not this phrase'] })
  mockExecute.mockResolvedValue({ success: true, result: 'She lets the silence sit.' })
})

describe('generateInSceneVoicedLine', () => {
  it('gives the character the per-turn briefing — template, Taboo, standing instructions — and never tools', async () => {
    await run()

    expect(mockBuildSystemPrompt).toHaveBeenCalledTimes(1)
    const opts = mockBuildSystemPrompt.mock.calls[0][0]
    expect(opts.roleplayTemplate).toEqual({ systemPrompt: 'TEMPLATE' })
    expect(opts.tabooPhrases).toEqual(['not this phrase'])
    expect(opts.standingInstructions).toBe('STANDING')
    expect(opts.precompiledIdentityStack).toBe('STACK')
    // `{{user}}` is the OWNER persona, not the seat being impersonated.
    expect(opts.userCharacter).toEqual({ name: 'The Proprietor', description: 'owns the place' })
    expect(opts.toolInstructions).toBeUndefined()
  })

  it('includes the transcript window, capped, with the seat own lines as assistant', async () => {
    messages = [
      msg({ role: 'USER', content: 'bertie speaks', participantId: 'seat-bertie' }),
      msg({ role: 'ASSISTANT', content: 'evangeline speaks', participantId: 'seat-evangeline' }),
    ]
    await run()

    const sent = sentMessages()
    expect(sent[0].role).toBe('system')
    const transcript = sent.slice(1, -1)
    expect(transcript).toHaveLength(2)
    expect(transcript[0].role).toBe('user')
    expect(transcript[0].content).toContain('bertie speaks')
    expect(transcript[0].content).toContain('[Bertie]')
    expect(transcript[1].role).toBe('assistant')
    expect(transcript[1].content).toContain('evangeline speaks')
  })

  it(`shows at most ${IN_SCENE_REWRITE_WINDOW} played messages`, async () => {
    messages = Array.from({ length: IN_SCENE_REWRITE_WINDOW + 6 }, (_, i) =>
      msg({ role: 'USER', content: `line ${i}`, participantId: 'seat-bertie' }),
    )
    await run()

    const transcript = sentMessages().slice(1, -1)
    expect(transcript).toHaveLength(IN_SCENE_REWRITE_WINDOW)
    // The tail, not the head.
    expect(transcript[transcript.length - 1].content).toContain(
      `line ${IN_SCENE_REWRITE_WINDOW + 5}`,
    )
  })

  it('excludes Staff whispers and whispers aimed past this seat', async () => {
    messages = [
      msg({ role: 'ASSISTANT', content: 'the Host notes the time', systemSender: 'host' }),
      msg({
        role: 'USER',
        content: 'a word for Bertie alone',
        participantId: 'seat-bertie',
        targetParticipantIds: ['seat-bertie'],
      }),
      msg({
        role: 'USER',
        content: 'a word for Evangeline',
        participantId: 'seat-bertie',
        targetParticipantIds: ['seat-evangeline'],
      }),
      msg({ role: 'USER', content: 'said to the room', participantId: 'seat-bertie' }),
    ]
    await run()

    const transcript = sentMessages()
      .slice(1, -1)
      .map(m => m.content)
      .join('\n')
    expect(transcript).not.toContain('the Host notes the time')
    expect(transcript).not.toContain('a word for Bertie alone')
    expect(transcript).toContain('a word for Evangeline')
    expect(transcript).toContain('said to the room')
  })

  it('leads the user message with the recall block when there is one', async () => {
    mockRecall.mockResolvedValue([{ memory: { id: 'mem-1' } }])
    await run()
    expect(lastUserMessage().startsWith('RECALL<REMEMBERED>')).toBe(true)
  })

  it('tolerates a recall failure and still composes the rewrite', async () => {
    mockRecall.mockRejectedValue(new Error('embedding provider is down'))
    const result = await run()

    expect(result.success).toBe(true)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(lastUserMessage()).not.toContain('RECALL<')
  })

  it('tolerates a failed Taboo read', async () => {
    mockTaboo.mockRejectedValue(new Error('instance settings unreadable'))
    const result = await run()

    expect(result.success).toBe(true)
    expect(mockBuildSystemPrompt.mock.calls[0][0].tabooPhrases).toEqual([])
  })

  it('instructs verbatim preservation of the machinery in the draft', async () => {
    await run()
    const instruction = lastUserMessage()
    expect(instruction).toContain('dice notation')
    expect(instruction).toContain('`@Name` address exactly as written')
    expect(instruction).toContain('do not speak for anyone else')
    expect(instruction).toContain('Draft:')
    expect(instruction).toContain('I tell him I will take the job, but only for double.')
  })

  it('logs the call under its own task type', async () => {
    await run()
    expect(mockExecute.mock.calls[0][4]).toBe('impersonation-voice-rewrite')
    expect(mockExecute.mock.calls[0][9]).toBe('char-evangeline')
  })

  it('clamps the output budget to the draft length', async () => {
    expect(maxTokensForSeed('')).toBe(1024)
    expect(maxTokensForSeed('x'.repeat(100))).toBe(1024)
    expect(maxTokensForSeed('x'.repeat(4000))).toBe(2000)
    expect(maxTokensForSeed('x'.repeat(100000))).toBe(4096)

    await run({ seedMarkdown: 'x'.repeat(4000) })
    expect(mockExecute.mock.calls[0][8]).toBe(2000)
  })

  it('reports a provider failure rather than throwing', async () => {
    mockExecute.mockResolvedValue({ success: false, error: 'the model refused' })
    const result = await run()
    expect(result).toEqual({ success: false, proposedMarkdown: '', error: 'the model refused' })
  })

  it('reports an unexpected failure rather than throwing', async () => {
    mockRepos.mockImplementation(() => {
      throw new Error('repositories are unavailable')
    })
    const result = await run()
    expect(result.success).toBe(false)
    expect(result.error).toContain('repositories are unavailable')
  })

  it('survives a bystander whose vault cannot be read', async () => {
    primeRepos({
      characterFindById: jest.fn(async (id: string) => {
        if (id === 'char-bertie') throw new Error('vault unavailable')
        return EVANGELINE
      }),
    })
    messages = [msg({ role: 'USER', content: 'bertie speaks', participantId: 'seat-bertie' })]

    const result = await run()
    expect(result.success).toBe(true)
    // Unattributable, but present.
    const transcript = sentMessages().slice(1, -1)
    expect(transcript).toHaveLength(1)
    expect(transcript[0].content).toBe('bertie speaks')
  })
})
