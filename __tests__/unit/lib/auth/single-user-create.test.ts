/**
 * A brand-new instance creates its one user under the fixed SINGLE_USER_ID.
 * The id used to ride in the data, which `_create` ignores, so the user was
 * created under a random id; the next call found it by email, treated it as a
 * legacy user and ran migrateUserId, which logged a SQLite error on `projects`
 * (no userId column) on every new install.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositoriesSafe: jest.fn(),
}))

import { getOrCreateSingleUser, SINGLE_USER_ID } from '@/lib/auth/single-user'
import { getRepositoriesSafe } from '@/lib/repositories/factory'

describe('getOrCreateSingleUser on a fresh instance', () => {
  it('creates the user under the fixed id, passed where create reads it', async () => {
    const create = jest.fn().mockResolvedValue({})
    const migrateUserId = jest.fn()
    ;(getRepositoriesSafe as jest.Mock).mockResolvedValue({
      users: {
        findById: jest.fn().mockResolvedValue(null),
        findByEmail: jest.fn().mockResolvedValue(null),
        create,
        migrateUserId,
      },
      chatSettings: { updateForUser: jest.fn().mockResolvedValue(undefined) },
    })

    const user = await getOrCreateSingleUser()

    expect(user.id).toBe(SINGLE_USER_ID)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.any(String) }),
      expect.objectContaining({ id: SINGLE_USER_ID }),
    )
    expect(migrateUserId).not.toHaveBeenCalled()
  })
})
