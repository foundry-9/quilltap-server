/**
 * The extraction context, end to end against mocked repositories (memory
 * refactor §3.7):
 *
 *  (a) `buildExtractionContext` once per unit of work — a three-character
 *      turn hydrates each character once, however many passes read it.
 *  (b) Carina memories carry the project id, with the `carina` provenance
 *      (bug 222).
 *  (c) The episode pass receives the uncensored fallback on an Unmoderated
 *      chat (bug 213).
 */

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

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  ...jest.requireActual('@/lib/memory/cheap-llm-tasks/core-execution'),
  executeCheapLLMTask: jest.fn(),
}))

jest.mock('@/lib/memory/admission', () => ({
  ...jest.requireActual('@/lib/memory/admission'),
  admitCandidate: jest.fn(),
}))

jest.mock('@/lib/memory/settings', () => ({
  resolveMemorySettings: jest.fn(),
}))

jest.mock('@/lib/memory/time/calendar-refresh', () => ({
  refreshMemoryTimeZone: jest.fn(async () => 'UTC'),
}))

jest.mock('@/lib/chat/speaker-names', () => ({
  ...jest.requireActual('@/lib/chat/speaker-names'),
  resolveSpeakerNames: jest.fn(async () => new Map([
    ['p-amy', 'Amy'],
    ['p-ben', 'Ben'],
    ['p-cleo', 'Cleo'],
  ])),
}))

jest.mock('@/lib/memory/cheap-llm-tasks/canon', () => ({
  loadCanonForSelfWithCommonplace: jest.fn(async () => ({ source: 'none' })),
  loadCanonForObserverAboutSubject: jest.fn(async () => ({ source: 'none' })),
  renderSelfCanonBlock: jest.fn(() => 'SELF CANON'),
  renderOtherCanonBlock: jest.fn(() => 'OTHER CANON'),
}))

jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({
  resolveConciergeSettings: jest.fn(() => ({
    onDuty: true,
    routeDirect: false,
    failoverAllowed: true,
    source: 'test',
    desk: { textProfileId: null, imageProfileId: null },
  })),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { admitCandidate } from '@/lib/memory/admission'
import { resolveMemorySettings } from '@/lib/memory/settings'
import {
  buildExtractionContext,
  memoryCursorStore,
  runCarinaExtraction,
  runFoldPass,
  runTurnExtraction,
} from '@/lib/memory/extraction'
import type { MemoryCandidate } from '@/lib/memory/candidate'
import type { MessageEvent } from '@/lib/schemas/types'

const PROFILE = { id: 'prof-1', userId: 'u1', provider: 'OPENAI', modelName: 'gpt-test', maxTokens: 8000 }

const CHARACTERS: Record<string, Record<string, unknown>> = {
  'char-amy': { id: 'char-amy', name: 'Amy', pronouns: null },
  'char-ben': { id: 'char-ben', name: 'Ben', pronouns: null },
  'char-cleo': { id: 'char-cleo', name: 'Cleo', pronouns: null },
  'char-ada': { id: 'char-ada', name: 'Ada', pronouns: null },
}

function seat(id: string, characterId: string) {
  return {
    id,
    type: 'CHARACTER',
    characterId,
    controlledBy: 'llm',
    isActive: true,
    status: 'active',
    hasHistoryAccess: true,
    displayOrder: 0,
    connectionProfileId: 'prof-1',
  }
}

function message(id: string, role: 'USER' | 'ASSISTANT', content: string, at: string, participantId?: string) {
  return { id, type: 'message', role, content, attachments: [], createdAt: at, ...(participantId ? { participantId } : {}) }
}

const THREE_SEAT_CHAT = {
  id: 'chat-1',
  chatType: 'salon',
  projectId: null,
  participants: [seat('p-amy', 'char-amy'), seat('p-ben', 'char-ben'), seat('p-cleo', 'char-cleo')],
}

const TURN_MESSAGES = [
  message('m-user', 'USER', 'Shall we open the vault?', '2026-10-12T10:00:00.000Z'),
  message('m-amy', 'ASSISTANT', 'I have the key.', '2026-10-12T10:00:01.000Z', 'p-amy'),
  message('m-ben', 'ASSISTANT', 'I will keep watch.', '2026-10-12T10:00:02.000Z', 'p-ben'),
  message('m-cleo', 'ASSISTANT', 'I brought the lantern.', '2026-10-12T10:00:03.000Z', 'p-cleo'),
]

type Repos = ReturnType<typeof makeRepos>

function makeRepos(chat: Record<string, unknown>, messages: unknown[], project: Record<string, unknown> | null = null) {
  return {
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => messages),
      updateMessage: jest.fn(async () => undefined),
    },
    connections: {
      findById: jest.fn(async () => PROFILE),
      findByUserId: jest.fn(async () => [PROFILE]),
    },
    chatSettings: { findByUserId: jest.fn(async () => ({ cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST' } })) },
    characters: { findById: jest.fn(async (id: string) => CHARACTERS[id] ?? null) },
    projects: { findById: jest.fn(async () => project) },
    memories: { findByCharacterAndSourceMessageIds: jest.fn(async () => []) },
  }
}

let repos: Repos

function prime(chat: Record<string, unknown>, messages: unknown[], project: Record<string, unknown> | null = null): Repos {
  repos = makeRepos(chat, messages, project)
  jest.mocked(getRepositories).mockReturnValue(repos as never)
  return repos
}

/** The model answers every call with one memory; the pass's own parser reads it. */
function answerWith(raw: unknown) {
  jest.mocked(executeCheapLLMTask).mockImplementation((async (
    _sel: unknown, _msgs: unknown, _user: unknown, parse: (raw: string) => unknown,
  ) => ({
    success: true,
    result: parse(JSON.stringify(raw)),
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  })) as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveMemorySettings).mockResolvedValue({
    extraction: {
      limits: { enabled: false, maxPerHour: 20, softStartFraction: 0.7, softFloor: 0.7 },
      mode: { otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 },
    },
  } as never)
  jest.mocked(admitCandidate).mockImplementation((async (candidate: MemoryCandidate) => ({
    action: { kind: 'insert' },
    memory: { id: `mem-${candidate.subject.holderId}` },
    novelDetails: [],
    linkedIds: [],
    trace: { thresholds: {}, assessments: [], embeddingAttempts: 1, orphansIgnored: 0, searchedK: 5, notes: [] },
  })) as never)
  answerWith([])
})

describe('buildExtractionContext once per unit of work', () => {
  it('hydrates each of three characters exactly once across the SELF and OTHER passes', async () => {
    prime(THREE_SEAT_CHAT, TURN_MESSAGES)
    answerWith([{ content: 'Holds the vault key.', summary: 'Has the key', importance: 0.6 }])

    const ctx = await buildExtractionContext('chat-1', 'u1', { connectionProfileId: 'prof-1' })
    const result = await runTurnExtraction(ctx, { turnOpenerMessageId: 'm-user' })

    // Three SELF calls and three OTHER calls ran off the one context…
    expect(result.hadContributions).toBe(true)
    expect(jest.mocked(executeCheapLLMTask)).toHaveBeenCalledTimes(6)
    // …and every character was read from the repository once, not per pass.
    expect(repos.characters.findById).toHaveBeenCalledTimes(3)
    for (const id of ['char-amy', 'char-ben', 'char-cleo']) {
      expect(repos.characters.findById.mock.calls.filter(c => c[0] === id)).toHaveLength(1)
    }
    expect(repos.chats.findById).toHaveBeenCalledTimes(1)
    expect(repos.chats.getMessages).toHaveBeenCalledTimes(1)
  })

  it('takes the profile from an LLM seat when none is named', async () => {
    prime(THREE_SEAT_CHAT, TURN_MESSAGES)
    const ctx = await buildExtractionContext('chat-1', 'u1')
    expect(repos.connections.findById).toHaveBeenCalledWith('prof-1')
    expect(ctx.route.connectionProfile).toBe(PROFILE)
  })
})

describe('Carina memories carry projectId (bug 222)', () => {
  const carinaMessage = {
    id: 'carina-1',
    type: 'message',
    role: 'ASSISTANT',
    systemSender: 'carina',
    content: 'The vault opens at midnight.',
    carinaMeta: { answererId: 'char-ada', question: 'When does the vault open?' },
    createdAt: '2026-10-12T10:00:00.000Z',
  } as unknown as MessageEvent

  it('admits the answerer\'s memory with the chat project and the carina provenance', async () => {
    prime(
      { id: 'chat-1', chatType: 'salon', projectId: 'proj-1', contextSummary: 'They found the map.', participants: [] },
      [carinaMessage],
      { id: 'proj-1', description: 'A heist in Edwardian London' },
    )
    answerWith([{ content: 'Told them the vault opens at midnight.', summary: 'Vault opens at midnight', importance: 0.6 }])

    const ctx = await buildExtractionContext('chat-1', 'u1', { connectionProfileId: 'prof-1', extraCharacterIds: ['char-ada'] })
    const result = await runCarinaExtraction(ctx, carinaMessage, 'char-ada')

    expect(result).not.toBeNull()
    expect(admitCandidate).toHaveBeenCalledTimes(1)
    const candidate = jest.mocked(admitCandidate).mock.calls[0][0]
    expect(candidate.provenance.projectId).toBe('proj-1')
    expect(candidate.provenance.pass).toBe('carina')
    expect(candidate.provenance.chatId).toBe('chat-1')
    expect(candidate.provenance.sourceMessageId).toBe('carina-1')
    // SELF only: about the answerer, nothing about the asker.
    expect(candidate.subject.holderId).toBe('char-ada')
    expect(candidate.subject.aboutId ?? null).toBeNull()
    expect(result!.createdIds).toEqual(['mem-char-ada'])

    // The project and the running summary ride in as orienting background.
    const prompt = (jest.mocked(executeCheapLLMTask).mock.calls[0][1] as Array<{ content: string }>)
      .map(m => m.content)
      .join('\n')
    expect(prompt).toContain('PROJECT: A heist in Edwardian London')
    expect(prompt).toContain('STORY SO FAR: They found the map.')
  })

  it('marks autonomous-room provenance when the chat is autonomous', async () => {
    prime({ id: 'chat-1', chatType: 'autonomous', projectId: null, participants: [] }, [carinaMessage])
    answerWith([{ content: 'Told them the vault opens at midnight.', summary: 'Vault opens at midnight', importance: 0.6 }])

    const ctx = await buildExtractionContext('chat-1', 'u1', { connectionProfileId: 'prof-1', extraCharacterIds: ['char-ada'] })
    await runCarinaExtraction(ctx, carinaMessage, 'char-ada')

    const candidate = jest.mocked(admitCandidate).mock.calls[0][0]
    expect(candidate.provenance.witnessedContext).toBe('autonomous_room')
    expect(candidate.provenance.projectId).toBeNull()
  })
})

describe('the episode pass receives the uncensored fallback (bug 213)', () => {
  const stretch = [
    message('f-1', 'USER', 'We should leave before dawn.', '2026-10-12T09:00:00.000Z', 'p-amy'),
    message('f-2', 'ASSISTANT', 'Then we leave before dawn.', '2026-10-12T09:01:00.000Z', 'p-ben'),
  ]

  async function episodeFallback(chat: Record<string, unknown>) {
    prime(chat, stretch)
    const ctx = await buildExtractionContext('chat-1', 'u1', {
      connectionProfileId: 'prof-1',
      cursors: memoryCursorStore('chat-1'),
    })
    await runFoldPass(ctx, 'episode-fold', { windowMessages: stretch as unknown as MessageEvent[] })
    expect(executeCheapLLMTask).toHaveBeenCalledTimes(1)
    const call = jest.mocked(executeCheapLLMTask).mock.calls[0]
    expect(call[4]).toBe('fold-episode-extraction')
    return call[7] as { isDangerousChat?: boolean; conciergePolicy?: unknown } | undefined
  }

  it('passes isDangerousChat: true on an Unmoderated chat', async () => {
    const fallback = await episodeFallback({ ...THREE_SEAT_CHAT, conciergeMode: 'unmoderated' })
    expect(fallback).toBeDefined()
    expect(fallback!.isDangerousChat).toBe(true)
    expect(fallback!.conciergePolicy).toBeDefined()
  })

  it('passes isDangerousChat: false on a Moderated chat, whatever the classifier telemetry says', async () => {
    const fallback = await episodeFallback({ ...THREE_SEAT_CHAT, conciergeMode: 'moderated', isDangerousChat: true })
    expect(fallback!.isDangerousChat).toBe(false)
  })
})
