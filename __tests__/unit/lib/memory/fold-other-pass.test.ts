/**
 * Fold-grain OTHER pass: respects the mode, caps candidates per subject,
 * writes through the shared candidate writer, advances the watermark; and the
 * idle catch-up sweep selects only idle chats whose tail is past the watermark.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({
  extractOtherMemoriesFromFold: jest.fn(),
  loadCanonForObserverAboutSubject: jest.fn(async () => ({ source: 'none' })),
  renderOtherCanonBlock: jest.fn(() => ''),
}))
jest.mock('@/lib/memory/memory-processor', () => ({
  writeCandidate: jest.fn(async () => undefined),
  applyImportanceFloor: jest.fn((c: unknown[]) => c),
  resolveExtractionRateLimit: jest.fn(async () => ({ mode: 'allow' })),
}))
jest.mock('@/lib/chat/speaker-names', () => ({
  resolveSpeakerNames: jest.fn(async () => new Map([['s-amy', 'Amy'], ['s-bea', 'Bea']])),
  speakerLabel: jest.fn((m: { participantId: string }) => (m.participantId === 's-amy' ? 'Amy' : 'Bea')),
}))
jest.mock('@/lib/instance-settings', () => ({
  getMemoryExtractionModeSettings: jest.fn(),
  getMemoryExtractionLimits: jest.fn(async () => ({ enabled: false })),
}))
jest.mock('@/lib/llm/cheap-llm', () => ({
  getCheapLLMProvider: jest.fn(), resolveUncensoredCheapLLMSelection: jest.fn(),
}))
jest.mock('@/lib/llm/model-context-data', () => ({ resolveMaxTokens: jest.fn(() => 8000) }))
jest.mock('@/lib/services/dangerous-content/chat-override', () => ({ shouldUseUncensoredRoute: jest.fn(() => false) }))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({ resolveConciergeSettings: jest.fn() }))
jest.mock('@/lib/services/chat-message/turn-transcript', () => ({ resolveUserCharacterParticipant: jest.fn(() => undefined) }))
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  runFoldOtherPass,
  runFoldOtherCatchup,
  findFoldOtherCatchupCandidates,
  messagesPastWatermark,
} from '@/lib/memory/fold-other-pass'
import { getRepositories } from '@/lib/repositories/factory'
import { extractOtherMemoriesFromFold } from '@/lib/memory/cheap-llm-tasks'
import { writeCandidate } from '@/lib/memory/memory-processor'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'

const mockRepos = getRepositories as jest.Mock
const mockExtract = extractOtherMemoriesFromFold as jest.Mock
const mockWrite = writeCandidate as jest.Mock
const mockMode = getMemoryExtractionModeSettings as jest.Mock

const msg = (id: string, participantId: string, over: Record<string, unknown> = {}) => ({
  id, type: 'message', role: 'ASSISTANT', content: `c ${id}`, participantId,
  createdAt: '2026-10-01T10:00:00.000Z', ...over,
}) as never

const cand = (s: string, importance = 0.6) => ({ content: s, summary: s, keywords: [], importance })

let chatUpdate: jest.Mock
let chat: Record<string, unknown>
let allMessages: unknown[]

function setupRepos() {
  chatUpdate = jest.fn(async () => ({}))
  mockRepos.mockReturnValue({
    chats: {
      findById: jest.fn(async () => chat),
      getMessages: jest.fn(async () => allMessages),
      update: chatUpdate,
      findAll: jest.fn(async () => [chat]),
    },
    characters: {
      findById: jest.fn(async (id: string) => ({ id, name: id === 'c-amy' ? 'Amy' : 'Bea', pronouns: null })),
    },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockMode.mockResolvedValue({ otherPass: 'hybrid', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
  chat = {
    id: 'chat-1', userId: 'u1', chatType: 'salon', messageCount: 4, lastMessageAt: '2026-10-01T10:00:00.000Z',
    otherExtractionWatermarkMessageId: null,
    participants: [
      { id: 's-amy', type: 'CHARACTER', characterId: 'c-amy', controlledBy: 'llm', connectionProfileId: 'prof-1' },
      { id: 's-bea', type: 'CHARACTER', characterId: 'c-bea', controlledBy: 'llm', connectionProfileId: 'prof-1' },
    ],
  }
  allMessages = [msg('m1', 's-amy'), msg('m2', 's-bea'), msg('m3', 's-amy'), msg('m4', 's-bea')]
  setupRepos()
  mockExtract.mockImplementation(async (_w: unknown, _o: unknown, subjects: Array<{ id: string }>) => ({
    success: true,
    result: new Map(subjects.map(s => [s.id, [cand('a'), cand('b'), cand('c'), cand('d'), cand('e')]])),
  }))
})

const baseInput = () => ({
  chatId: 'chat-1', userId: 'u1', windowMessages: allMessages as never, cheapLLM: {} as never,
  timelineMode: 'realtime' as const, inAutonomousRoom: false,
})

describe('runFoldOtherPass', () => {
  it("does nothing in 'turn' mode", async () => {
    mockMode.mockResolvedValue({ otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    const r = await runFoldOtherPass(baseInput())
    expect(r.skippedReason).toBe('mode-turn')
    expect(mockExtract).not.toHaveBeenCalled()
    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it('caps candidates per subject at foldCandidatesPerSubject and advances the watermark', async () => {
    const r = await runFoldOtherPass(baseInput())
    // 2 observers x 1 subject each x cap 3
    expect(mockExtract).toHaveBeenCalledTimes(2)
    expect(mockExtract.mock.calls[0][3]).toBe(3)
    expect(mockWrite).toHaveBeenCalledTimes(6)
    expect(mockWrite.mock.calls.every(c => c[0].pass === 'OTHER')).toBe(true)
    expect(r.watermarkAdvancedTo).toBe('m4')
    expect(chatUpdate).toHaveBeenCalledWith('chat-1', { otherExtractionWatermarkMessageId: 'm4' })
  })

  it('honours a smaller configured cap', async () => {
    mockMode.mockResolvedValue({ otherPass: 'fold', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 1 })
    await runFoldOtherPass(baseInput())
    expect(mockWrite).toHaveBeenCalledTimes(2)
  })

  it('skips a window already behind the watermark', async () => {
    chat.otherExtractionWatermarkMessageId = 'm4'
    const r = await runFoldOtherPass(baseInput())
    expect(r.skippedReason).toBe('behind-watermark')
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it('does not advance the watermark when a pass is lost to a timeout', async () => {
    mockExtract.mockResolvedValue({ success: false, timedOut: true, error: 'timeout' })
    const r = await runFoldOtherPass(baseInput())
    expect(r.passesLostToTimeout).toBe(2)
    expect(chatUpdate).not.toHaveBeenCalled()
  })

  it('never throws into the fold', async () => {
    mockRepos.mockImplementation(() => { throw new Error('db gone') })
    await expect(runFoldOtherPass(baseInput())).resolves.toMatchObject({ skippedReason: 'error' })
  })
})

describe('runFoldOtherPass — wide windows are read in slices (bug 206)', () => {
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) => msg(`h${i + 1}`, i % 2 === 0 ? 's-amy' : 's-bea'))

  it('reads 150 eligible messages as three slices and advances the watermark past each', async () => {
    allMessages = history(150)
    const r = await runFoldOtherPass(baseInput())

    // 3 slices x 2 observers
    expect(mockExtract).toHaveBeenCalledTimes(6)
    const sliceSizes = mockExtract.mock.calls.map(c => (c[0] as unknown[]).length)
    expect(sliceSizes).toEqual([60, 60, 60, 60, 30, 30])
    expect(chatUpdate.mock.calls.map(c => c[1].otherExtractionWatermarkMessageId)).toEqual(['h60', 'h120', 'h150'])
    expect(r.watermarkAdvancedTo).toBe('h150')
    expect(r.observers).toBe(2)
    // Every slice wrote candidates whose source message lies inside it.
    const sources = new Set(mockWrite.mock.calls.map(c => c[0].sourceMessageId))
    expect(sources).toEqual(new Set(['h59', 'h60', 'h119', 'h120', 'h149', 'h150']))
  })

  it('covers the final slice through an explicit cover-through id', async () => {
    allMessages = history(70)
    const r = await runFoldOtherPass({ ...baseInput(), coverThroughMessageId: 'tail-record' })
    expect(chatUpdate.mock.calls.map(c => c[1].otherExtractionWatermarkMessageId)).toEqual(['h60', 'tail-record'])
    expect(r.watermarkAdvancedTo).toBe('tail-record')
  })

  it('stops at a slice lost to a timeout, leaving the watermark at the last slice read', async () => {
    allMessages = history(150)
    let call = 0
    mockExtract.mockImplementation(async (_w: unknown, _o: unknown, subjects: Array<{ id: string }>) => {
      call++
      if (call === 3) return { success: false, timedOut: true, error: 'timeout' }
      return { success: true, result: new Map(subjects.map(s => [s.id, [cand('a')]])) }
    })
    const r = await runFoldOtherPass(baseInput())
    expect(r.passesLostToTimeout).toBe(1)
    // Slice 2's other observer still ran; slice 3 was never read.
    expect(mockExtract).toHaveBeenCalledTimes(4)
    expect(chatUpdate.mock.calls.map(c => c[1].otherExtractionWatermarkMessageId)).toEqual(['h60'])
    expect(r.watermarkAdvancedTo).toBe('h60')
  })
})

describe('messagesPastWatermark', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('returns everything without a watermark', () => expect(messagesPastWatermark(list, null)).toHaveLength(3))
  it('returns only what follows the watermark', () => expect(messagesPastWatermark(list, 'b')).toEqual([{ id: 'c' }]))
  it('treats a vanished watermark as absent', () => expect(messagesPastWatermark(list, 'zzz')).toHaveLength(3))
})

describe('findFoldOtherCatchupCandidates', () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z')

  it('selects an idle chat whose last message is past the watermark', async () => {
    chat.lastMessageAt = '2026-10-08T08:00:00.000Z'
    chat.otherExtractionWatermarkMessageId = 'm2'
    const sel = await findFoldOtherCatchupCandidates({ now })
    expect(sel.candidates).toEqual([
      { chatId: 'chat-1', userId: 'u1', lastMessageId: 'm4', connectionProfileId: 'prof-1' },
    ])
  })

  it('skips a chat whose watermark is already its last message', async () => {
    chat.lastMessageAt = '2026-10-08T08:00:00.000Z'
    chat.otherExtractionWatermarkMessageId = 'm4'
    expect((await findFoldOtherCatchupCandidates({ now })).candidates).toHaveLength(0)
  })

  it('skips a chat that is not yet idle', async () => {
    chat.lastMessageAt = '2026-10-08T11:00:00.000Z'
    expect((await findFoldOtherCatchupCandidates({ now })).candidates).toHaveLength(0)
  })

  it('selects nothing in turn mode', async () => {
    mockMode.mockResolvedValue({ otherPass: 'turn', perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3 })
    chat.lastMessageAt = '2026-10-08T08:00:00.000Z'
    expect((await findFoldOtherCatchupCandidates({ now })).candidates).toHaveLength(0)
  })

  it('bounds the sweep and reports the overflow', async () => {
    chat.lastMessageAt = '2026-10-08T08:00:00.000Z'
    const repos = mockRepos()
    const second = { ...chat, id: 'chat-2', lastMessageAt: '2026-10-08T07:00:00.000Z' }
    repos.chats.findAll.mockResolvedValue([chat, second])
    const sel = await findFoldOtherCatchupCandidates({ now, limit: 1 })
    expect(sel.candidates).toHaveLength(1)
    expect(sel.candidates[0].chatId).toBe('chat-1')
    expect(sel.deferred).toBe(1)
  })
})

describe('runFoldOtherCatchup — routing and project (bugs 213, 222)', () => {
  const policy = { failoverAllowed: true, desk: { textProfileId: 'desk' } }

  function withCatchupRepos(project: Record<string, unknown> | null) {
    const base = mockRepos()
    mockRepos.mockReturnValue({
      ...base,
      chatSettings: { findByUserId: jest.fn(async () => ({})) },
      projects: { findById: jest.fn(async () => project) },
    })
  }

  it('sets isDangerousChat from the Concierge state and passes the project description', async () => {
    ;(shouldUseUncensoredRoute as jest.Mock).mockReturnValue(true)
    ;(resolveConciergeSettings as jest.Mock).mockReturnValue(policy)
    chat.projectId = 'proj-1'
    withCatchupRepos({ id: 'proj-1', description: 'A gaslit mystery' })

    await runFoldOtherCatchup({
      chatId: 'chat-1',
      userId: 'u1',
      connectionProfile: { id: 'prof-1' } as never,
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true } as never,
      availableProfiles: [],
      ignoreIdle: true,
    })

    const call = mockExtract.mock.calls[0]
    expect(call[6]).toEqual({ conciergePolicy: policy, availableProfiles: [], isDangerousChat: true })
    expect(call[10]).toMatchObject({ projectDescription: 'A gaslit mystery' })
    expect(mockWrite.mock.calls[0][0].ctx.projectId).toBe('proj-1')
  })
})

describe('runFoldOtherPass — review findings 4, 7, 13', () => {
  const history = (n: number) =>
    Array.from({ length: n }, (_, i) => msg(`h${i + 1}`, i % 2 === 0 ? 's-amy' : 's-bea'))
  let getMessages: jest.Mock

  function liveRepos() {
    setupRepos()
    chatUpdate.mockImplementation(async (_id: string, patch: Record<string, unknown>) => {
      Object.assign(chat, patch)
      return chat
    })
    getMessages = jest.fn(async () => allMessages)
    const repos = mockRepos()
    mockRepos.mockReturnValue({
      ...repos,
      chats: { ...repos.chats, getMessages },
      chatSettings: { findByUserId: jest.fn(async () => ({})) },
      projects: { findById: jest.fn(async () => null) },
    })
  }
  const firstIdOf = (call: unknown[]) => ((call[0] as Array<{ content: string }>)[0].content).replace('c ', '')

  it('#4: a slice lost to a timeout is read by the next fold even when that fold only covers newer turns', async () => {
    allMessages = history(250)
    liveRepos()
    let call = 0
    mockExtract.mockImplementation(async (_w: unknown, _o: unknown, subjects: Array<{ id: string }>) => {
      call++
      if (call === 3) return { success: false, timedOut: true, error: 'timeout' }
      return { success: true, result: new Map(subjects.map(s => [s.id, []])) }
    })
    await runFoldOtherPass({ ...baseInput(), windowMessages: (allMessages as never[]).slice(0, 240) })
    expect(chat.otherExtractionWatermarkMessageId).toBe('h60')

    mockExtract.mockClear()
    mockExtract.mockImplementation(async (_w: unknown, _o: unknown, subjects: Array<{ id: string }>) => ({
      success: true, result: new Map(subjects.map(s => [s.id, []])),
    }))
    const r = await runFoldOtherPass({ ...baseInput(), windowMessages: (allMessages as never[]).slice(240) })

    expect(firstIdOf(mockExtract.mock.calls[0])).toBe('h61')
    expect(r.watermarkAdvancedTo).toBe('h250')
  })

  it('#7: a long catch-up backlog takes several jobs and the watermark advances monotonically', async () => {
    allMessages = history(600)
    liveRepos()
    mockExtract.mockImplementation(async (_w: unknown, _o: unknown, subjects: Array<{ id: string }>) => ({
      success: true, result: new Map(subjects.map(s => [s.id, []])),
    }))
    const marks: string[] = []
    for (let job = 0; job < 4; job++) {
      mockExtract.mockClear()
      const r = await runFoldOtherCatchup({
        chatId: 'chat-1', userId: 'u1', connectionProfile: { id: 'prof-1' } as never,
        cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true } as never,
        availableProfiles: [], ignoreIdle: true,
      })
      // At most four slices (two observers each) per job.
      expect(mockExtract.mock.calls.length).toBeLessThanOrEqual(8)
      if (r.watermarkAdvancedTo) marks.push(r.watermarkAdvancedTo)
      if (chat.otherExtractionWatermarkMessageId === 'h600') break
    }
    expect(marks).toEqual(['h240', 'h480', 'h600'])
  })

  it('#13: uses the transcript it is handed instead of reading it again', async () => {
    allMessages = history(10)
    liveRepos()
    chat.otherExtractionWatermarkMessageId = 'h4'
    await runFoldOtherPass({
      ...baseInput(),
      windowMessages: (allMessages as never[]).slice(6),
      chatMessages: allMessages as never,
    })
    expect(getMessages).not.toHaveBeenCalled()
    expect(firstIdOf(mockExtract.mock.calls[0])).toBe('h5')
  })
})
