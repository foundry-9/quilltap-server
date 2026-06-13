/**
 * Unit tests for the global background-job concurrency cap accessors
 * (`maxConcurrentJobs` instance setting). The dispatcher reads this each claim
 * cycle, so the clamping/default behaviour here is what actually bounds how many
 * jobs run at once.
 */

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
}))

import { rawQuery } from '@/lib/database/manager'
import { getMaxConcurrentJobs, setMaxConcurrentJobs } from '@/lib/instance-settings'

const mockRawQuery = jest.mocked(rawQuery)

describe('maxConcurrentJobs instance setting', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getMaxConcurrentJobs', () => {
    it('returns the default of 4 when the setting is unset', async () => {
      mockRawQuery.mockResolvedValue([] as never)
      await expect(getMaxConcurrentJobs()).resolves.toBe(4)
    })

    it('returns the stored value within range', async () => {
      mockRawQuery.mockResolvedValue([{ value: '8' }] as never)
      await expect(getMaxConcurrentJobs()).resolves.toBe(8)
    })

    it('clamps values above 32 down to 32', async () => {
      mockRawQuery.mockResolvedValue([{ value: '64' }] as never)
      await expect(getMaxConcurrentJobs()).resolves.toBe(32)
    })

    it('falls back to the default for sub-1 values', async () => {
      mockRawQuery.mockResolvedValue([{ value: '0' }] as never)
      await expect(getMaxConcurrentJobs()).resolves.toBe(4)
    })

    it('falls back to the default for non-numeric values', async () => {
      mockRawQuery.mockResolvedValue([{ value: 'lots' }] as never)
      await expect(getMaxConcurrentJobs()).resolves.toBe(4)
    })

    it('returns the default when the read throws', async () => {
      mockRawQuery.mockRejectedValue(new Error('db down'))
      await expect(getMaxConcurrentJobs()).resolves.toBe(4)
    })
  })

  describe('setMaxConcurrentJobs', () => {
    it('writes the clamped integer as a string', async () => {
      mockRawQuery.mockResolvedValue(undefined as never)
      await setMaxConcurrentJobs(8)
      expect(mockRawQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "instance_settings"'),
        ['maxConcurrentJobs', '8'],
      )
    })

    it('clamps values above 32', async () => {
      mockRawQuery.mockResolvedValue(undefined as never)
      await setMaxConcurrentJobs(100)
      expect(mockRawQuery).toHaveBeenCalledWith(expect.any(String), ['maxConcurrentJobs', '32'])
    })

    it('clamps values below 1', async () => {
      mockRawQuery.mockResolvedValue(undefined as never)
      await setMaxConcurrentJobs(0)
      expect(mockRawQuery).toHaveBeenCalledWith(expect.any(String), ['maxConcurrentJobs', '1'])
    })

    it('floors fractional values before writing', async () => {
      mockRawQuery.mockResolvedValue(undefined as never)
      await setMaxConcurrentJobs(6.9)
      expect(mockRawQuery).toHaveBeenCalledWith(expect.any(String), ['maxConcurrentJobs', '6'])
    })

    it('throws on a non-finite value', async () => {
      await expect(setMaxConcurrentJobs(Number.NaN)).rejects.toThrow('finite number')
      expect(mockRawQuery).not.toHaveBeenCalled()
    })
  })
})
