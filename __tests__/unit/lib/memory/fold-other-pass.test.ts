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
  findFoldOtherCatchupCandidates,
  messagesPastWatermark,
} from '@/lib/memory/fold-other-pass'
import { getRepositories } from '@/lib/repositories/factory'
import { extractOtherMemoriesFromFold } from '@/lib/memory/cheap-llm-tasks'
import { writeCandidate } from '@/lib/memory/memory-processor'
import { getMemoryExtractionModeSettings } from '@/lib/instance-settings'

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
