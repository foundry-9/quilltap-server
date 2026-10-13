/**
 * Review of PR 90, finding 5: per-turn extraction (also the Carina and dry-run
 * paths) runs on ONE memory-calendar zone — the extraction context's
 * `clock.timeZone`, resolved once when the context is built — and that zone
 * reaches both the extractor's CLOCK block and the `when` resolver. So the
 * prompt can never be rendered in the fallback zone while `when` resolves in
 * the instance zone, even with a cold timezone cache and a UTC fallback.
 *
 * A `when` resolves against the candidate's source message time (the slice's
 * `lastMessageCreatedAt`, else the turn timestamp).
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => ({
    // A settings read would find a different zone; the context's zone must win.
    chatSettings: { findAll: jest.fn(async () => [{ timezone: 'Europe/London' }]) },
  })),
}))

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

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({ executeCheapLLMTask: jest.fn() }))
jest.mock('@/lib/memory/admission', () => require('../../../../helpers/admission-mock').admissionModuleMock())

import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import { runTurnPasses } from '@/lib/memory/extraction/turn'
import { resetMemoryTimeZoneCacheForTests } from '@/lib/memory/time/calendar'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { makeExtractionContext } from '../../../../helpers/extraction-context'
import { mockAdmitRow as admitRow, admissionOutcome } from '../../../../helpers/admission-mock'

const mockExecute = jest.mocked(executeCheapLLMTask)

const ORIGINAL_ENV_TZ = process.env.QUILLTAP_TIMEZONE

// 16:00Z on 07-13 is 01:00 on Tuesday 07-14 in Tokyo, still Monday in UTC.
const SOURCE_TIME = '2026-07-13T16:00:00.000Z'

function transcript(): TurnTranscript {
  return {
    turnOpenerMessageId: 'opener-1',
    userMessage: 'Where did you go?',
    characterSlices: [{
      characterId: 'char-1',
      characterName: 'Avery',
      characterPronouns: null,
      text: 'I walked the pier yesterday.',
      contributingMessageIds: ['assistant-char-1'],
      lastMessageCreatedAt: SOURCE_TIME,
    }],
    latestAssistantMessageId: 'assistant-char-1',
    // A turn timestamp a day later: the slice's own time must be the anchor.
    turnTimestamp: '2026-07-14T16:00:00.000Z',
  }
}

describe('runTurnPasses — memory-calendar zone on a cold cache', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetMemoryTimeZoneCacheForTests()
    process.env.QUILLTAP_TIMEZONE = 'UTC'
    mockExecute.mockImplementation(async (_s, _m, _u, parse, taskType) => ({
      success: true,
      result: parse(taskType === 'memory-extraction-self'
        ? JSON.stringify([{ content: 'Avery walked the pier.', summary: 'pier walk', importance: 0.6, kind: 'episodic', when: 'yesterday' }])
        : '[]'),
    }) as never)
    admitRow.mockResolvedValue(admissionOutcome('insert', { id: 'mem-1' }))
  })

  afterAll(() => {
    if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
    else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
    resetMemoryTimeZoneCacheForTests()
  })

  it("renders the extractor's clock in the context's zone, and resolves `when` in it", async () => {
    const ctx = makeExtractionContext({
      seats: [{ characterId: 'char-1', name: 'Avery' }],
      timeZone: 'Asia/Tokyo',
    })

    await runTurnPasses(ctx, transcript())

    expect(mockExecute).toHaveBeenCalledTimes(1)
    const messages = mockExecute.mock.calls[0][1] as Array<{ content: string }>
    const promptText = messages.map(m => m.content).join('\n')
    // The turn's clock is its newest stamped message (the turn timestamp), in Tokyo.
    expect(promptText).toContain('Current date/time: 2026-07-15 (Wednesday)')
    // …not in the UTC fallback, where the same instant is still Tuesday.
    expect(promptText).not.toContain('Current date/time: 2026-07-14 (Tuesday)')

    // "yesterday" against the source message (Tuesday 07-14 in Tokyo) is 07-13,
    // whose Tokyo midnight is 07-12T15:00Z (the UTC fallback would say 07-12T00:00Z).
    expect(admitRow).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: '2026-07-12T15:00:00.000Z', sourceMessageTimestamp: SOURCE_TIME }),
      expect.anything(),
    )
  })
})
