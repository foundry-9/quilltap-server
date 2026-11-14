/**
 * Backup and deletion see every owned row (#202): a character, project or
 * group whose store cannot be read comes back as its raw row and is named,
 * and LLM logs are read a page at a time rather than capped.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}))

const rawCharacters = jest.fn()
const hydratedCharacters = jest.fn()
const findLogs = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/repositories/user-scoped', () => ({ getUserRepositories: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { getUserRepositories } from '@/lib/repositories/user-scoped'
import { readOwnedCharacters, readAllLlmLogs, unreadableStoreWarning } from '@/lib/backup/owned-rows'

describe('owned rows', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRepositories as jest.Mock).mockReturnValue({
      characters: { findAllRaw: () => rawCharacters() },
      llmLogs: { findByUserId: (...args: unknown[]) => findLogs(...args) },
    })
    ;(getUserRepositories as jest.Mock).mockReturnValue({ characters: { findAll: () => hydratedCharacters() } })
  })

  it('carries a character whose store cannot be read as its raw row, and names it', async () => {
    rawCharacters.mockResolvedValue([
      { id: 'c-ok', userId: 'u' },
      { id: 'c-broken', userId: 'u' },
      { id: 'c-other', userId: 'u2' },
    ])
    hydratedCharacters.mockResolvedValue([{ id: 'c-ok', userId: 'u', name: 'Whole' }])

    const owned = await readOwnedCharacters('u')

    expect(owned.rows).toEqual([{ id: 'c-ok', userId: 'u', name: 'Whole' }, { id: 'c-broken', userId: 'u' }])
    expect(owned.unreadable).toEqual(['c-broken'])
    expect(unreadableStoreWarning('character', owned.unreadable)).toContain('c-broken')
    expect(unreadableStoreWarning('character', [])).toBeNull()
  })

  it('reads every LLM log, page by page', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `log-${from + i}` }))
    findLogs
      .mockResolvedValueOnce(page(1000, 0))
      .mockResolvedValueOnce(page(1000, 1000))
      .mockResolvedValueOnce(page(345, 2000))

    const logs = await readAllLlmLogs('u')

    expect(logs).toHaveLength(2345)
    expect(findLogs).toHaveBeenNthCalledWith(3, 'u', 1000, 2000)
  })
})
