/**
 * #272: the Aurora grid's trash icon asks before a group is deleted, and
 * sends nothing when the operator declines.
 */

jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))

import { confirmAndDeleteGroup } from '@/app/aurora/shared/confirm-delete-group'
import { showConfirmation } from '@/lib/alert'

const confirm = showConfirmation as jest.Mock
const groups = [{ id: 'g1', name: 'The Drones Club' }]

beforeEach(() => jest.clearAllMocks())

describe('confirmAndDeleteGroup', () => {
  it('asks, naming the group, and deletes nothing when declined', async () => {
    confirm.mockResolvedValue(false)
    const deleteGroup = jest.fn()
    await expect(confirmAndDeleteGroup('g1', groups, deleteGroup)).resolves.toBe(false)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('The Drones Club'))
    expect(deleteGroup).not.toHaveBeenCalled()
  })

  it('deletes once confirmed', async () => {
    confirm.mockResolvedValue(true)
    const deleteGroup = jest.fn().mockResolvedValue(true)
    await expect(confirmAndDeleteGroup('g1', groups, deleteGroup)).resolves.toBe(true)
    expect(deleteGroup).toHaveBeenCalledWith('g1')
  })
})
