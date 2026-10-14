/**
 * Bug 212 — the instance timezone (`ChatSettings.timezone`) feeds the memory
 * calendar, cached for the synchronous resolvers, and a failed read falls back.
 */

jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { getRepositories } from '@/lib/repositories/factory'
import { refreshMemoryTimeZone } from '../calendar-refresh'
import { getMemoryTimeZone, resetMemoryTimeZoneCacheForTests } from '../calendar'

const mockedRepos = getRepositories as jest.MockedFunction<typeof getRepositories>

describe('refreshMemoryTimeZone', () => {
  const savedEnv = process.env.QUILLTAP_TIMEZONE
  beforeEach(() => {
    resetMemoryTimeZoneCacheForTests()
    process.env.QUILLTAP_TIMEZONE = 'Europe/London'
  })
  afterEach(() => {
    resetMemoryTimeZoneCacheForTests()
    if (savedEnv === undefined) delete process.env.QUILLTAP_TIMEZONE
    else process.env.QUILLTAP_TIMEZONE = savedEnv
  })

  it('reads the instance timezone and caches it', async () => {
    const findAll = jest.fn().mockResolvedValue([{ timezone: 'America/Chicago' }])
    mockedRepos.mockReturnValue({ chatSettings: { findAll } } as never)
    expect(await refreshMemoryTimeZone(1_000)).toBe('America/Chicago')
    expect(getMemoryTimeZone()).toBe('America/Chicago')
    // Within the TTL no second read.
    await refreshMemoryTimeZone(2_000)
    expect(findAll).toHaveBeenCalledTimes(1)
  })

  it('falls back to QUILLTAP_TIMEZONE when the instance has none', async () => {
    mockedRepos.mockReturnValue({ chatSettings: { findAll: jest.fn().mockResolvedValue([{ timezone: null }]) } } as never)
    expect(await refreshMemoryTimeZone(1_000)).toBe('Europe/London')
  })

  it('never throws when the read fails', async () => {
    mockedRepos.mockImplementation(() => {
      throw new Error('no database')
    })
    await expect(refreshMemoryTimeZone(1_000)).resolves.toBe('Europe/London')
  })
})
