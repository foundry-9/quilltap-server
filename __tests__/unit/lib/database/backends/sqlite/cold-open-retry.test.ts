/**
 * @jest-environment node
 *
 * Bug 180: the mount index had a cold-open retry ladder and the LLM logs did
 * not, so one flaky first read (a bind-mounted iCloud / VirtioFS volume)
 * degraded the logs for the life of the process. Both now open through one
 * ladder; these tests pin the ladder and the LLM-logs client's use of it.
 */

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { child: jest.fn(() => child) } }
})

jest.mock('@/lib/utils/sleep', () => ({
  sleepSync: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/text-codec-function', () => ({
  registerTextCodecFunction: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/llm-logs-protection', () => ({
  stopLLMLogsPeriodicCheckpoints: jest.fn(),
  runLLMLogsShutdownCheckpoint: jest.fn(),
}))

const mockDatabaseCtor = jest.fn()
jest.mock('better-sqlite3', () => ({
  __esModule: true,
  default: function MockDatabase(path: string) {
    return mockDatabaseCtor(path)
  },
}))

import { openWithColdOpenRetry } from '@/lib/database/backends/sqlite/cold-open-retry'
import {
  getLLMLogsSQLiteClient,
  isLLMLogsDegraded,
} from '@/lib/database/backends/sqlite/llm-logs-client'
import { sleepSync } from '@/lib/utils/sleep'
import { logger } from '@/lib/logger'

const mockLoggerChild = jest.mocked(logger.child({})) as unknown as Record<
  'debug' | 'info' | 'warn' | 'error',
  jest.Mock
>

const mockSleepSync = jest.mocked(sleepSync)

function fakeDb(opts: { probeThrows?: boolean } = {}) {
  return {
    pragma: jest.fn(),
    prepare: jest.fn(() => ({
      get: jest.fn(() => {
        if (opts.probeThrows) throw new Error('file is not a database')
        return { cnt: 0 }
      }),
    })),
    close: jest.fn(),
  }
}

const config = {
  path: '/tmp/qt-test/quilltap-llm-logs.db',
  walMode: false,
  journalMode: 'TRUNCATE',
  synchronous: 'NORMAL',
  busyTimeout: 5000,
  cacheSize: -2000,
} as never

describe('openWithColdOpenRetry', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the first success with its attempt count', () => {
    const attempt = jest
      .fn()
      .mockImplementationOnce(() => { throw new Error('flake') })
      .mockReturnValueOnce('db')

    const result = openWithColdOpenRetry('Thing', '/p', mockLoggerChild as never, attempt)

    expect(result).toEqual({ ok: true, value: 'db', attempts: 2 })
    expect(mockLoggerChild.warn).toHaveBeenCalledTimes(1)
    expect(mockLoggerChild.warn).toHaveBeenCalledWith('Thing cold-open failed — retrying', {
      path: '/p',
      attempt: 1,
      maxAttempts: 4,
      backoffMs: 200,
      error: 'flake',
    })
    expect(mockSleepSync).toHaveBeenCalledWith(200)
  })

  it('spends four attempts with 200/600/1500 ms backoff, then reports the last error', () => {
    const attempt = jest.fn(() => { throw new Error('file is not a database') })

    const result = openWithColdOpenRetry('Thing', '/p', mockLoggerChild as never, attempt)

    expect(attempt).toHaveBeenCalledTimes(4)
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(4)
    expect(mockSleepSync.mock.calls.map((c) => c[0])).toEqual([200, 600, 1500])
    expect(mockLoggerChild.warn).toHaveBeenCalledTimes(3)
  })
})

describe('getLLMLogsSQLiteClient cold open', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.__quilltapLLMLogsDatabase = undefined
    globalThis.__quilltapLLMLogsDegraded = undefined
  })

  it('recovers from a transient failed verify probe', () => {
    const bad = fakeDb({ probeThrows: true })
    const good = fakeDb()
    mockDatabaseCtor.mockReturnValueOnce(bad).mockReturnValueOnce(good)

    const db = getLLMLogsSQLiteClient(config)

    expect(db).toBe(good)
    expect(bad.close).toHaveBeenCalled()
    expect(isLLMLogsDegraded()).toBe(false)
    expect(mockLoggerChild.warn).toHaveBeenCalledWith(
      'LLM logs cold-open failed — retrying',
      expect.objectContaining({ attempt: 1, backoffMs: 200 })
    )
    expect(mockLoggerChild.info).toHaveBeenCalledWith(
      'LLM logs database connection established',
      expect.objectContaining({ attempts: 2 })
    )
  })

  it('degrades with one ERROR after four failed attempts', () => {
    mockDatabaseCtor.mockImplementation(() => fakeDb({ probeThrows: true }))

    expect(getLLMLogsSQLiteClient(config)).toBeNull()
    expect(mockDatabaseCtor).toHaveBeenCalledTimes(4)
    expect(isLLMLogsDegraded()).toBe(true)
    expect(mockLoggerChild.warn).toHaveBeenCalledTimes(3)
    expect(mockLoggerChild.error).toHaveBeenCalledTimes(1)
    expect(mockLoggerChild.error).toHaveBeenCalledWith(
      'Failed to initialize LLM logs database — entering degraded mode',
      expect.objectContaining({ attempts: 4, error: 'file is not a database' })
    )
  })
})
