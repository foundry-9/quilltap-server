/**
 * The per-turn OTHER pass honours memoryExtractionMode.otherPass
 * (`ctx.settings.mode`):
 *   'turn'   — every per-turn OTHER candidate is kept
 *   'hybrid' — per-turn OTHER candidates below perTurnOtherFloor are dropped
 *   'fold'   — no per-turn OTHER pass at all
 * The SELF pass is untouched in every mode.
 *
 * And the uncensored fallback (bug 213): every pass call carries the route's
 * fallback, whose `isDangerousChat` says whether the chat is on the uncensored
 * route (Unmoderated) — resolved once by `resolveExtractionRoute`.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn(() => ({})) }))
jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())
jest.mock('@/lib/llm/cheap-llm', () => ({
  buildCheapLLMConfig: jest.fn(() => ({})),
  getCheapLLMProvider: jest.fn(() => ({ provider: 'x', modelName: 'y' })),
  resolveUncensoredCheapLLMSelection: jest.fn((s: unknown) => s),
}))
jest.mock('@/lib/llm/model-context-data', () => ({ resolveMaxTokens: jest.fn(() => 8000) }))
jest.mock('@/lib/services/dangerous-content/resolver.service', () => ({ resolveConciergeSettings: jest.fn() }))
jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { resolveConciergeSettings } from '@/lib/services/dangerous-content/resolver.service'
import { runTurnPasses } from '@/lib/memory/extraction/turn'
import { resolveExtractionRoute } from '@/lib/memory/extraction/route'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import type { MemoryExtractionModeSettings } from '@/lib/schemas/settings.types'
import type { ChatMetadata, ConnectionProfile } from '@/lib/schemas/types'
import { makeExtractionContext, type TestSeat } from '../../../../helpers/extraction-context'
import { mockAdmitRow, admissionOutcome } from '../../../../helpers/admission-mock'

const mockExecute = jest.mocked(executeCheapLLMTask)
const mockAdmit = mockAdmitRow
const mockConcierge = jest.mocked(resolveConciergeSettings)

const AMY: TestSeat = { characterId: 'a', name: 'Amy' }
const BEA: TestSeat = { characterId: 'b', name: 'Bea' }

const cand = (summary: string, importance: number) => ({
  content: summary, summary, keywords: [], importance, kind: 'semantic',
})

function transcript(): TurnTranscript {
  return {
    turnOpenerMessageId: 'o1',
    userMessage: 'hi',
    characterSlices: [
      { characterId: 'a', characterName: 'Amy', characterPronouns: null, text: 't', contributingMessageIds: ['m1'] },
      { characterId: 'b', characterName: 'Bea', characterPronouns: null, text: 't', contributingMessageIds: ['m2'] },
    ],
    latestAssistantMessageId: 'm2',
    turnTimestamp: '2026-07-14T10:00:00.000Z',
  }
}

const ctxFor = (mode: Partial<MemoryExtractionModeSettings>) =>
  makeExtractionContext({ seats: [AMY, BEA], userId: 'u1', mode: { perTurnOtherFloor: 0.75, foldCandidatesPerSubject: 3, ...mode } })

const selfCalls = () => mockExecute.mock.calls.filter(c => c[4] === 'memory-extraction-self')
const otherCalls = () => mockExecute.mock.calls.filter(c => c[4] === 'memory-extraction-other')
const otherWrites = () =>
  mockAdmit.mock.calls.map(c => c[0]).filter(i => i.aboutCharacterId !== null && i.aboutCharacterId !== i.characterId)

beforeEach(() => {
  jest.clearAllMocks()
  // SELF answers nothing; each observer sees the other as the subject: one 0.9 and one 0.5 candidate.
  mockExecute.mockImplementation(async (_s, _m, _u, parse, taskType) => ({
    success: true,
    result: parse(taskType === 'memory-extraction-self'
      ? '[]'
      : JSON.stringify([{ subjectIndex: 1, ...cand('hinge', 0.9) }, { subjectIndex: 1, ...cand('trait', 0.5) }])),
  }) as never)
  mockAdmit.mockResolvedValue(admissionOutcome('insert', { id: 'new' }))
})

describe('runTurnPasses — otherPass mode', () => {
  it("'turn' keeps every per-turn OTHER candidate", async () => {
    await runTurnPasses(ctxFor({ otherPass: 'turn' }), transcript())
    expect(otherCalls()).toHaveLength(2)
    expect(otherWrites()).toHaveLength(4)
  })

  it("'hybrid' drops per-turn OTHER candidates below the floor", async () => {
    const result = await runTurnPasses(ctxFor({ otherPass: 'hybrid' }), transcript())
    expect(otherCalls()).toHaveLength(2)
    const writes = otherWrites()
    expect(writes).toHaveLength(2)
    expect(writes.every(w => w.importance >= 0.75)).toBe(true)
    expect(result.debugLogs.join('\n')).toContain('Hybrid floor')
  })

  it("'fold' runs no per-turn OTHER pass but still runs SELF", async () => {
    const result = await runTurnPasses(ctxFor({ otherPass: 'fold' }), transcript())
    expect(otherCalls()).toHaveLength(0)
    expect(selfCalls()).toHaveLength(2)
    expect(otherWrites()).toHaveLength(0)
    expect(result.debugLogs.join('\n')).toContain('otherPass=fold')
  })
})

describe('uncensored fallback (bug 213)', () => {
  const policy = { failoverAllowed: true, desk: { textProfileId: 'desk' } }
  const profiles = [{ id: 'desk', isDangerousCompatible: true }] as unknown as ConnectionProfile[]
  const profile = { id: 'p', provider: 'OPENAI', modelName: 'm' } as unknown as ConnectionProfile

  beforeEach(() => mockConcierge.mockReturnValue(policy as never))

  it('every pass call carries the route\'s fallback', async () => {
    const ctx = ctxFor({ otherPass: 'turn' })
    const fallback = { conciergePolicy: policy, availableProfiles: profiles, isDangerousChat: true }
    const withFallback = { ...ctx, route: { ...ctx.route, uncensoredFallback: fallback as never } }
    await runTurnPasses(withFallback, transcript())
    expect(mockExecute).toHaveBeenCalledTimes(4)
    for (const call of mockExecute.mock.calls) expect(call[7]).toBe(fallback)
  })

  it('carries isDangerousChat on the fallback for a chat on the uncensored route', () => {
    const route = resolveExtractionRoute({
      chat: { id: 'chat-1', conciergeMode: 'unmoderated' } as unknown as ChatMetadata,
      connectionProfile: profile,
      chatSettings: null,
      availableProfiles: profiles,
    })
    expect(route.uncensoredFallback).toEqual({ conciergePolicy: policy, availableProfiles: profiles, isDangerousChat: true })
  })

  it('says false for a moderated chat', () => {
    const route = resolveExtractionRoute({
      chat: { id: 'chat-1' } as unknown as ChatMetadata,
      connectionProfile: profile,
      chatSettings: null,
      availableProfiles: profiles,
    })
    expect(route.uncensoredFallback).toMatchObject({ isDangerousChat: false })
  })
})
