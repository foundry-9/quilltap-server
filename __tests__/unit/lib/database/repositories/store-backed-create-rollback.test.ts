/**
 * AbstractStoreBackedRepository.create takes its row back out when the store cannot be
 * provisioned. A row left behind is a hollow entity every later existence
 * check counts — first-startup seeding saw two such characters and never ran
 * again, so a new install's sample characters stayed empty for good.
 */

import { AbstractStoreBackedRepository } from '@/lib/database/repositories/store-backed.repository'

type Fake = Record<string, unknown> & {
  _create: jest.Mock
  _delete: jest.Mock
  provisionOfficialStore: jest.Mock
  afterCreate: jest.Mock
  findById: jest.Mock
}

function fakeRepo(overrides: Partial<Fake> = {}): Fake {
  const row = { id: 'char-1', name: 'Lorian' }
  return {
    store: { entityLabel: 'Character', idLogKey: 'characterId' },
    pointerField: 'officialMountPointId',
    prepareCreateData: (data: unknown) => data,
    safeQuery: (fn: () => Promise<unknown>) => fn(),
    _create: jest.fn().mockResolvedValue(row),
    _delete: jest.fn().mockResolvedValue(true),
    provisionOfficialStore: jest.fn().mockResolvedValue('mount-1'),
    afterCreate: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue({ ...row, officialMountPointId: 'mount-1' }),
    ...overrides,
  }
}

const create = (repo: Fake) =>
  (AbstractStoreBackedRepository.prototype.create as (this: unknown, data: unknown) => Promise<unknown>).call(repo, {
    name: 'Lorian',
  })

describe('AbstractStoreBackedRepository.create', () => {
  it('keeps the row when the store is provisioned', async () => {
    const repo = fakeRepo()
    await expect(create(repo)).resolves.toMatchObject({ id: 'char-1' })
    expect(repo._delete).not.toHaveBeenCalled()
    expect(repo.afterCreate).toHaveBeenCalled()
  })

  it('deletes the row it wrote and rethrows when provisioning fails', async () => {
    const failure = new Error('no such table: doc_mount_files')
    const repo = fakeRepo({ provisionOfficialStore: jest.fn().mockRejectedValue(failure) })
    await expect(create(repo)).rejects.toBe(failure)
    expect(repo._delete).toHaveBeenCalledWith('char-1')
    expect(repo.afterCreate).not.toHaveBeenCalled()
  })

  it('still rethrows the provisioning error when the rollback itself fails', async () => {
    const failure = new Error('vault write failed')
    const repo = fakeRepo({
      provisionOfficialStore: jest.fn().mockRejectedValue(failure),
      _delete: jest.fn().mockRejectedValue(new Error('database gone')),
    })
    await expect(create(repo)).rejects.toBe(failure)
  })
})
