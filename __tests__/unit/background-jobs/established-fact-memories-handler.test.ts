/**
 * ESTABLISHED_FACT_MEMORIES: one MANUAL admission per non-removed LLM seat
 * (absent and silent included, the operator's seat excluded), and one seat's
 * failure never stops the others.
 */

import { handleEstablishedFactMemories } from '@/lib/background-jobs/handlers/established-fact-memories'
import { getRepositories } from '@/lib/repositories/factory'
import { admitCandidate } from '@/lib/memory/admission'
import type { MemoryCandidate } from '@/lib/memory/candidate'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/admission', () => ({ admitCandidate: jest.fn() }))

const mockRepos = getRepositories as jest.Mock
const mockAdmit = admitCandidate as jest.Mock

const FACT = 'The river has risen above the old mill.'

function seat(id: string, characterId: string, controlledBy: 'llm' | 'user', status: string) {
  return { id, type: 'CHARACTER', characterId, controlledBy, status }
}

function setup(characters: Record<string, unknown>) {
  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => ({
        id: 'chat-1',
        projectId: 'proj-1',
        participants: [
          seat('p-alice', 'c-alice', 'llm', 'active'),
          seat('p-bob', 'c-bob', 'llm', 'silent'),
          seat('p-carol', 'c-carol', 'llm', 'absent'),
          seat('p-gone', 'c-gone', 'llm', 'removed'),
          seat('p-user', 'c-user', 'user', 'active'),
        ],
      })),
      getMessages: jest.fn(async () => [
        {
          type: 'message', id: 'm-fact', role: 'ASSISTANT', content: FACT, participantId: null,
          systemSender: 'host', systemKind: 'established-fact', createdAt: '2026-10-01T10:00:00.000Z',
        },
      ]),
    },
    characters: { findByIdRaw: jest.fn(async (id: string) => characters[id] ?? null) },
  })
}

const job = { id: 'job-1', userId: 'user-1', payload: { chatId: 'chat-1', messageId: 'm-fact' } } as never

beforeEach(() => {
  jest.clearAllMocks()
  mockAdmit.mockImplementation(async (candidate: MemoryCandidate) => ({
    memory: { id: `mem-${candidate.subject.holderId}` },
    action: { kind: 'insert' },
  }))
})

describe('handleEstablishedFactMemories', () => {
  it('admits one MANUAL memory per non-removed LLM seat, absent and silent included', async () => {
    setup({ 'c-alice': { id: 'c-alice' }, 'c-bob': { id: 'c-bob' }, 'c-carol': { id: 'c-carol' }, 'c-user': { id: 'c-user' } })
    await handleEstablishedFactMemories(job)

    const holders = mockAdmit.mock.calls.map(([c]) => (c as MemoryCandidate).subject.holderId)
    expect(holders).toEqual(['c-alice', 'c-bob', 'c-carol'])

    const candidate = mockAdmit.mock.calls[0][0] as MemoryCandidate
    expect(candidate).toMatchObject({
      content: FACT,
      summary: FACT,
      kind: 'semantic',
      importance: 0.8,
      targeting: { temporal: 'present', scope: 'wide', context: 'information' },
      subject: { holderId: 'c-alice', aboutId: null },
      provenance: {
        source: 'MANUAL',
        pass: 'established-fact',
        chatId: 'chat-1',
        projectId: 'proj-1',
        sourceMessageId: 'm-fact',
      },
    })
  })

  it('one seat failing — embedding refused, a throw, a missing character — never stops the others', async () => {
    setup({ 'c-alice': { id: 'c-alice' }, 'c-carol': { id: 'c-carol' } }) // c-bob missing
    mockAdmit
      .mockResolvedValueOnce({ memory: null, action: { kind: 'reject', reason: 'embedding-failed' } })
      .mockRejectedValueOnce(new Error('boom'))
    await handleEstablishedFactMemories(job)
    // Alice (rejected) and Carol (threw) were both tried; Bob was skipped.
    expect(mockAdmit).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the fact row is gone', async () => {
    setup({})
    const repos = mockRepos()
    repos.chats.getMessages.mockResolvedValue([])
    mockRepos.mockReturnValue(repos)
    await handleEstablishedFactMemories(job)
    expect(mockAdmit).not.toHaveBeenCalled()
  })
})
