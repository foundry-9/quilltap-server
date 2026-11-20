/**
 * @jest-environment node
 *
 * Two shared repository bases, exercised through their bindings with the
 * storage primitives stubbed (no database is opened):
 *
 *  - `DefaultableProfileRepository` (image and embedding profiles): the one
 *    place the bindings differ is a failed finder read — image profiles
 *    rethrow, embedding profiles answer null.
 *  - `OwnerDocMountLinksRepository` (project and group store links): each
 *    binding filters on its own owner column, linking twice makes one row, and
 *    unlinking reports whether a row went.
 */

jest.mock('@/lib/logger', () => {
  const mock: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  mock.child = jest.fn(() => mock)
  return { logger: mock }
})

import { ImageProfilesRepository } from '@/lib/database/repositories/image-profiles.repository'
import { EmbeddingProfilesRepository } from '@/lib/database/repositories/embedding-profiles.repository'
import { ProjectDocMountLinksRepository } from '@/lib/database/repositories/project-doc-mount-links.repository'
import { GroupDocMountLinksRepository } from '@/lib/database/repositories/group-doc-mount-links.repository'
import { logger } from '@/lib/logger'

type Stubbed = Record<string, jest.Mock>

/** Replace a repository's storage primitives with mocks. */
function stub<T extends object>(repo: T, names: string[]): Stubbed {
  const mocks: Stubbed = {}
  for (const name of names) {
    mocks[name] = jest.fn()
    ;(repo as Record<string, unknown>)[name] = mocks[name]
  }
  return mocks
}

const PRIMITIVES = ['findOneByFilter', 'findByFilter', '_create', '_update', '_delete', 'updateMany', 'deleteMany']

describe('DefaultableProfileRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  describe.each([
    ['image profile', () => new ImageProfilesRepository()],
    ['embedding profile', () => new EmbeddingProfilesRepository()],
  ] as const)('%s binding', (noun, make) => {
    it('finds by name and by default with the user in the filter', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.findOneByFilter.mockResolvedValue({ id: 'p1' })

      expect(await repo.findByName('u1', 'Mine')).toEqual({ id: 'p1' })
      expect(db.findOneByFilter).toHaveBeenLastCalledWith({ userId: 'u1', name: 'Mine' })

      expect(await repo.findDefault('u1')).toEqual({ id: 'p1' })
      expect(db.findOneByFilter).toHaveBeenLastCalledWith({ userId: 'u1', isDefault: true })
    })

    it('answers null when nothing matches', async () => {
      const repo = make()
      stub(repo, PRIMITIVES).findOneByFilter.mockResolvedValue(undefined)
      expect(await repo.findByName('u1', 'Nobody')).toBeNull()
      expect(await repo.findDefault('u1')).toBeNull()
    })

    it('clears every default a user has', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.updateMany.mockResolvedValue(2)
      expect(await repo.unsetAllDefaults('u1')).toBe(2)
      expect(db.updateMany).toHaveBeenCalledWith({ userId: 'u1', isDefault: true }, { isDefault: false })
    })

    it('passes a patch to _update whole and names the kind in its log line', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db._update.mockResolvedValue({ id: 'p1' })
      const patch = { id: 'other', createdAt: 'then', name: 'Renamed' }
      expect(await repo.update('p1', patch)).toEqual({ id: 'p1' })
      expect(db._update).toHaveBeenCalledWith('p1', patch)
      const capital = noun.charAt(0).toUpperCase() + noun.slice(1)
      expect(logger.info).toHaveBeenCalledWith(`${capital} updated successfully`, { profileId: 'p1' })
    })

    it('reports a delete that removed nothing without a success line', async () => {
      const repo = make()
      stub(repo, PRIMITIVES)._delete.mockResolvedValue(false)
      expect(await repo.delete('gone')).toBe(false)
      expect(logger.info).not.toHaveBeenCalled()
    })
  })

  it('image profile finders rethrow a failed read', async () => {
    const repo = new ImageProfilesRepository()
    stub(repo, PRIMITIVES).findOneByFilter.mockRejectedValue(new Error('disk'))
    await expect(repo.findByName('u1', 'Mine')).rejects.toThrow()
    await expect(repo.findDefault('u1')).rejects.toThrow()
  })

  it('embedding profile finders answer null on a failed read', async () => {
    const repo = new EmbeddingProfilesRepository()
    stub(repo, PRIMITIVES).findOneByFilter.mockRejectedValue(new Error('disk'))
    expect(await repo.findByName('u1', 'Mine')).toBeNull()
    expect(await repo.findDefault('u1')).toBeNull()
    expect(await repo.findInstanceDefault()).toBeNull()
  })
})

describe('OwnerDocMountLinksRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  const bindings = [
    ['projectId', () => new ProjectDocMountLinksRepository(), (r: any, id: string) => r.findByProjectId(id)],
    ['groupId', () => new GroupDocMountLinksRepository(), (r: any, id: string) => r.findByGroupId(id)],
  ] as const

  describe.each(bindings)('%s binding', (ownerKey, make, findByOwner) => {
    it('finds an owner\'s links on its own column', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.findByFilter.mockResolvedValue([{ id: 'l1' }])
      expect(await findByOwner(repo, 'o1')).toEqual([{ id: 'l1' }])
      expect(db.findByFilter).toHaveBeenCalledWith({ [ownerKey]: 'o1' })
    })

    it('finds a store\'s links, and answers an empty list when the read fails', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.findByFilter.mockResolvedValueOnce([{ id: 'l1' }])
      expect(await repo.findByMountPointId('m1')).toEqual([{ id: 'l1' }])
      expect(db.findByFilter).toHaveBeenCalledWith({ mountPointId: 'm1' })

      db.findByFilter.mockRejectedValue(new Error('degraded'))
      expect(await repo.findByMountPointId('m1')).toEqual([])
      expect(await findByOwner(repo, 'o1')).toEqual([])
    })

    it('links once: an existing link is returned and nothing is created', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.findOneByFilter.mockResolvedValueOnce(null)
      db._create.mockResolvedValue({ id: 'new' })

      expect(await repo.link('o1', 'm1')).toEqual({ id: 'new' })
      expect(db.findOneByFilter).toHaveBeenCalledWith({ [ownerKey]: 'o1', mountPointId: 'm1' })
      expect(db._create).toHaveBeenCalledWith({ [ownerKey]: 'o1', mountPointId: 'm1' })

      db.findOneByFilter.mockResolvedValueOnce({ id: 'new' })
      expect(await repo.link('o1', 'm1')).toEqual({ id: 'new' })
      expect(db._create).toHaveBeenCalledTimes(1)
    })

    it('unlink says whether a row went', async () => {
      const repo = make()
      const db = stub(repo, PRIMITIVES)
      db.deleteMany.mockResolvedValueOnce(1).mockResolvedValueOnce(0)
      expect(await repo.unlink('o1', 'm1')).toBe(true)
      expect(await repo.unlink('o1', 'm1')).toBe(false)
      expect(db.deleteMany).toHaveBeenCalledWith({ [ownerKey]: 'o1', mountPointId: 'm1' })
    })
  })

  it('a group\'s links are deleted by group and by store, with 0 on a failed write', async () => {
    const repo = new GroupDocMountLinksRepository()
    const db = stub(repo, PRIMITIVES)
    db.deleteMany.mockResolvedValueOnce(3).mockResolvedValueOnce(2)
    expect(await repo.deleteByGroupId('g1')).toBe(3)
    expect(db.deleteMany).toHaveBeenLastCalledWith({ groupId: 'g1' })
    expect(await repo.deleteByMountPointId('m1')).toBe(2)
    expect(db.deleteMany).toHaveBeenLastCalledWith({ mountPointId: 'm1' })

    db.deleteMany.mockRejectedValue(new Error('degraded'))
    expect(await repo.deleteByGroupId('g1')).toBe(0)
    expect(await repo.deleteByMountPointId('m1')).toBe(0)
  })
})
