/**
 * The extractor's CLOCK is rendered on the instance's memory calendar even on
 * a cold timezone cache (review of PR 90, finding 5). The zone is resolved
 * once — `withMemoryTimeZone` reads the instance setting — and carried on the
 * clock (`clockAt(ctx, iso)`); every prompt builder renders the CLOCK in the
 * zone on the clock it is handed, so the prompt and the `when` resolver
 * cannot disagree.
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

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

import { buildSelfTurnMessages } from '../prompts/self'
import { buildOtherTurnMessages, buildOtherFoldMessages, type OtherSubjectInput } from '../prompts/other'
import { buildEpisodeFoldMessages } from '../prompts/episode'
import { withMemoryTimeZone, type ExtractionClock } from '../prompts/shared'
import { clockAt } from '../context'
import { getRepositories } from '@/lib/repositories/factory'
import { resetMemoryTimeZoneCacheForTests } from '@/lib/memory/time/calendar'
import type { LLMMessage } from '@/lib/llm/base'
import type { TurnTranscript } from '@/lib/services/chat-message/turn-transcript'

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

function allPromptText(messages: LLMMessage[] | null): string {
  expect(messages).not.toBeNull()
  return messages!.map(m => m.content as string).join('\n')
}

beforeEach(() => {
  jest.clearAllMocks()
  resetMemoryTimeZoneCacheForTests()
  // The fallback (env) zone is UTC; the instance setting says Tokyo.
  process.env.QUILLTAP_TIMEZONE = 'UTC'
  jest.mocked(getRepositories).mockReturnValue({
    chatSettings: { findAll: jest.fn().mockResolvedValue([{ timezone: 'Asia/Tokyo' }]) },
  } as never)
})

afterAll(() => {
  if (ORIGINAL_ENV_TZ === undefined) delete process.env.QUILLTAP_TIMEZONE
  else process.env.QUILLTAP_TIMEZONE = ORIGINAL_ENV_TZ
  resetMemoryTimeZoneCacheForTests()
})

describe('withMemoryTimeZone on a cold timezone cache', () => {
  const clock: ExtractionClock = { nowIso: NOW_ISO, timelineMode: 'realtime' }

  it('resolves the instance zone, not the env fallback', async () => {
    const resolved = await withMemoryTimeZone(clock)
    expect(resolved.timeZone).toBe('Asia/Tokyo')
    expect(resolved.nowIso).toBe(NOW_ISO)
    expect(resolved.timelineMode).toBe('realtime')
  })

  it('keeps a clock that already carries its zone, without a settings read', async () => {
    const findAll = jest.fn().mockResolvedValue([{ timezone: 'Asia/Tokyo' }])
    jest.mocked(getRepositories).mockReturnValue({ chatSettings: { findAll } } as never)
    const resolved = await withMemoryTimeZone({ ...clock, timeZone: 'Pacific/Kiritimati' })
    expect(resolved.timeZone).toBe('Pacific/Kiritimati')
    expect(findAll).not.toHaveBeenCalled()
  })

  it('passes an absent clock through untouched', async () => {
    await expect(withMemoryTimeZone(undefined)).resolves.toBeUndefined()
  })
})

describe('clockAt carries the context zone onto each window clock', () => {
  it('copies the zone and timeline mode, setting the window instant', () => {
    const c = clockAt({ clock: { timeZone: 'Asia/Tokyo', nowMs: 0, timelineMode: 'narrative' } } as never, NOW_ISO)
    expect(c).toEqual({ nowIso: NOW_ISO, timelineMode: 'narrative', timeZone: 'Asia/Tokyo' })
  })
})

describe('extraction CLOCK renders in the zone on the clock it is handed', () => {
  let clock: ExtractionClock
  beforeEach(async () => {
    // As the extraction context does: resolve once, carry it on the clock.
    clock = await withMemoryTimeZone({ nowIso: NOW_ISO, timelineMode: 'realtime' })
  })

  it('SELF pass renders the clock in the instance zone', () => {
    const text = allPromptText(buildSelfTurnMessages({
      transcript: TRANSCRIPT, holderId: 'obs', canonBlock: 'CANON', cap: 1, inAutonomousRoom: false, clock,
    }))
    expect(text).toContain(`Current date/time: ${TOKYO_STAMP}`)
    expect(text).not.toContain(UTC_STAMP)
  })

  it('per-turn OTHER pass renders the clock in the instance zone', () => {
    const text = allPromptText(buildOtherTurnMessages({
      transcript: TRANSCRIPT, observer: { name: 'Friday', pronouns: null }, subjects: SUBJECTS, cap: 1, inAutonomousRoom: false, clock,
    }))
    expect(text).toContain(`Current date/time: ${TOKYO_STAMP}`)
  })

  it('fold OTHER pass renders the clock in the instance zone', () => {
    const text = allPromptText(buildOtherFoldMessages({
      stretch: [{ speaker: 'Friday', content: 'We went to the pier.', createdAt: NOW_ISO }],
      observer: { name: 'Friday', pronouns: null },
      subjects: SUBJECTS,
      cap: 3,
      inAutonomousRoom: false,
      clock,
    }))
    expect(text).toContain(`Current date/time: ${TOKYO_STAMP}`)
  })

  it('fold episode pass states the local date in the instance zone', () => {
    const text = allPromptText(buildEpisodeFoldMessages({
      stretch: [{ speaker: 'Friday', content: 'We went to the pier.', createdAt: NOW_ISO }],
      clock,
    }))
    expect(text).toContain(TOKYO_STAMP)
  })

  it('a clock that carries a different zone renders in that zone', () => {
    const text = allPromptText(buildSelfTurnMessages({
      transcript: TRANSCRIPT, holderId: 'obs', canonBlock: 'CANON', cap: 1, inAutonomousRoom: false,
      clock: { ...clock, timeZone: 'Pacific/Kiritimati' },
    }))
    // 16:00Z is 06:00 Tuesday on Kiritimati (UTC+14).
    expect(text).toContain('Current date/time: 2026-07-14 (Tuesday)')
  })

  it('the same instant in UTC renders the Monday stamp (the zone is what moves the date)', () => {
    const text = allPromptText(buildSelfTurnMessages({
      transcript: TRANSCRIPT, holderId: 'obs', canonBlock: 'CANON', cap: 1, inAutonomousRoom: false,
      clock: { ...clock, timeZone: 'UTC' },
    }))
    expect(text).toContain(`Current date/time: ${UTC_STAMP}`)
  })
})
