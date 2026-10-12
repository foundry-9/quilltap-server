/**
 * The extractor's CLOCK is rendered on the instance's memory calendar even on
 * a cold timezone cache (review of PR 90, finding 5). Every extraction entry
 * point resolves the instance zone before it builds a prompt, and a clock
 * that already carries a zone renders in that zone, so the prompt and the
 * `when` resolver cannot disagree.
 */

jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}))

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

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

import {
  extractSelfMemoriesFromTurn,
  extractOtherMemoriesFromTurn,
  extractOtherMemoriesFromFold,
  extractEpisodesFromFold,
  type OtherSubjectInput,
} from '../memory-tasks'
import { executeCheapLLMTask } from '../core-execution'
import { getRepositories } from '@/lib/repositories/factory'
import { resetMemoryTimeZoneCacheForTests } from '@/lib/memory/memory-calendar'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'

const SELECTION = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as unknown as CheapLLMSelection

const TRANSCRIPT = {
  characterSlices: [
    { characterId: 'obs', characterName: 'Friday', characterPronouns: null, text: 'We went to the pier.', contributingMessageIds: ['m1'] },
  ],
  userMessage: null,
  latestAssistantMessageId: 'm1',
} as unknown as TurnTranscript

const SUBJECTS: OtherSubjectInput[] = [
  { id: 's1', name: 'Amy', pronouns: null, isUser: false, canonBlock: 'ALREADY ESTABLISHED about Amy' },
]

// 2026-07-13T16:00Z is Tuesday 2026-07-14 01:00 in Tokyo, still Monday in UTC.
const NOW_ISO = '2026-07-13T16:00:00.000Z'
const TOKYO_STAMP = '2026-07-14 (Tuesday)'
const UTC_STAMP = '2026-07-13 (Monday)'

const ORIGINAL_ENV_TZ = process.env.QUILLTAP_TIMEZONE

function allPromptText(): string {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls
  const messages = calls[calls.length - 1][1] as Array<{ role: string; content: string }>
  return messages.map(m => m.content).join('\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMemoryTimeZoneCacheForTests()
  // The fallback (env) zone is UTC; the instance setting says Tokyo.
  process.env.QUILLTAP_TIMEZONE = 'UTC'
  jest.mocked(getRepositories).mockReturnValue({
    chatSettings: { findAll: jest.fn().mockResolvedValue([{ timezone: 'Asia/Tokyo' }]) },
  } as never)
  jest.mocked(executeCheapLLMTask).mockResolvedValue({ success: true, result: [] } as never)
})

afterAll(() => {
  if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
  else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
  resetMemoryTimeZoneCacheForTests()
})

describe('extraction CLOCK on a cold timezone cache', () => {
  const clock = { nowIso: NOW_ISO, timelineMode: 'realtime' as const }

  it('SELF pass renders the clock in the instance zone', async () => {
    await extractSelfMemoriesFromTurn(TRANSCRIPT, 'obs', 'CANON', SELECTION, 'user-1', undefined, 'chat-1', 2048, false, undefined, clock)
    expect(allPromptText()).toContain(`Current date/time: ${TOKYO_STAMP}`)
    expect(allPromptText()).not.toContain(UTC_STAMP)
  })

  it('per-turn OTHER pass renders the clock in the instance zone', async () => {
    await extractOtherMemoriesFromTurn(TRANSCRIPT, 'obs', SUBJECTS, SELECTION, 'user-1', undefined, 'chat-1', 2048, false, undefined, clock)
    expect(allPromptText()).toContain(`Current date/time: ${TOKYO_STAMP}`)
  })

  it('fold OTHER pass renders the clock in the instance zone', async () => {
    await extractOtherMemoriesFromFold(
      [{ speaker: 'Friday', content: 'We went to the pier.', createdAt: NOW_ISO }],
      { id: 'obs', name: 'Friday', pronouns: null },
      SUBJECTS,
      3,
      SELECTION,
      'user-1',
      undefined,
      'chat-1',
      2048,
      false,
      undefined,
      clock,
    )
    expect(allPromptText()).toContain(`Current date/time: ${TOKYO_STAMP}`)
  })

  it('fold episode pass states the local date in the instance zone', async () => {
    await extractEpisodesFromFold(
      [{ speaker: 'Friday', content: 'We went to the pier.', createdAt: NOW_ISO }],
      clock,
      SELECTION,
      'user-1',
      'chat-1',
    )
    expect(allPromptText()).toContain(TOKYO_STAMP)
  })

  it('a clock that carries its zone renders in that zone without a settings read', async () => {
    const findAll = jest.fn().mockResolvedValue([{ timezone: 'Asia/Tokyo' }])
    jest.mocked(getRepositories).mockReturnValue({ chatSettings: { findAll } } as never)
    await extractSelfMemoriesFromTurn(
      TRANSCRIPT, 'obs', 'CANON', SELECTION, 'user-1', undefined, 'chat-1', 2048, false, undefined,
      { ...clock, timeZone: 'Pacific/Kiritimati' },
    )
    // 16:00Z is 06:00 Tuesday on Kiritimati (UTC+14).
    expect(allPromptText()).toContain('Current date/time: 2026-07-14 (Tuesday)')
    expect(findAll).not.toHaveBeenCalled()
  })
})
