/**
 * readCurrentConciergeState — the failover chokepoints' refusal-time read.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { readCurrentConciergeState } from '@/lib/services/dangerous-content/current-state'

const findById = jest.fn()
beforeEach(() => {
  findById.mockReset()
  jest.mocked(getRepositories).mockReturnValue({ chats: { findById } } as never)
})

describe('readCurrentConciergeState', () => {
  it('prefers the stored state over the snapshot (locked mid-flight)', async () => {
    findById.mockResolvedValue({ id: 'c', conciergeMode: 'locked' })
    await expect(readCurrentConciergeState('c', 'moderated')).resolves.toBe('locked')
  })

  it('falls back to the snapshot without a chat id, a chat, or a working read', async () => {
    await expect(readCurrentConciergeState(null, 'locked')).resolves.toBe('locked')
    findById.mockResolvedValue(null)
    await expect(readCurrentConciergeState('c', 'unmoderated')).resolves.toBe('unmoderated')
    findById.mockRejectedValue(new Error('db gone'))
    await expect(readCurrentConciergeState('c', 'locked')).resolves.toBe('locked')
  })

  it('reads a missing snapshot as Moderated', async () => {
    await expect(readCurrentConciergeState(undefined)).resolves.toBe('moderated')
  })
})
