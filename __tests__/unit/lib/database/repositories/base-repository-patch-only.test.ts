/**
 * @jest-environment node
 *
 * `AbstractBaseRepository._update` and `patchOnlyFields()` — a whole-row
 * update rebuilds the row from a snapshot it read a moment earlier, so any
 * field it writes back can rewind a newer value written in between. A
 * patch-only field is left out of the `$set` unless the patch names it.
 *
 * The chats table relies on this for its Concierge state columns
 * (`ChatsRepository.patchOnlyFields`), which is what the second half checks.
 */

import { z } from 'zod'

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { AbstractBaseRepository } from '@/lib/database/repositories/base.repository'
import { ChatsRepository } from '@/lib/database/repositories/chats.repository'

const RowSchema = z.object({
  id: z.string(),
  title: z.string(),
  mode: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
type Row = z.infer<typeof RowSchema>

/** A collection whose stored row can be changed "behind" a read. */
function fakeCollection(initial: Row) {
  let stored: Record<string, unknown> = { ...initial }
  const sets: Array<Record<string, unknown>> = []
  return {
    sets,
    get stored() { return stored },
    /** Simulate another writer landing between `_update`'s read and write. */
    interleave: null as null | (() => void),
    async findOne() {
      const snapshot = { ...stored }
      const hook = this.interleave
      this.interleave = null
      hook?.()
      return snapshot
    },
    async updateOne(_filter: unknown, spec: { $set: Record<string, unknown> }) {
      sets.push(spec.$set)
      stored = { ...stored, ...spec.$set }
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
}

class RowsRepository extends AbstractBaseRepository<Row> {
  constructor(private readonly collection: ReturnType<typeof fakeCollection>, private readonly patchOnly: string[]) {
    super('rows', RowSchema)
  }
  protected override async getCollection() {
    return this.collection as never
  }
  protected override patchOnlyFields(): readonly string[] {
    return this.patchOnly
  }
  async create(): Promise<Row> { throw new Error('unused') }
  async update(id: string, data: Partial<Row>) { return this._update(id, data) }
  async delete(): Promise<boolean> { throw new Error('unused') }
}

const ROW: Row = { id: 'r1', title: 'Before', mode: 'moderated', createdAt: 't0', updatedAt: 't0' }

describe('AbstractBaseRepository._update — patch-only fields', () => {
  it('without patch-only fields, a stale snapshot rewinds a newer value (the hazard)', async () => {
    const coll = fakeCollection(ROW)
    const repo = new RowsRepository(coll, [])
    coll.interleave = () => { (coll.stored as Record<string, unknown>).mode = 'locked' }
    await repo.update('r1', { title: 'After' })
    expect(coll.stored.mode).toBe('moderated')
  })

  it('leaves a patch-only field out of the $set when the patch does not name it', async () => {
    const coll = fakeCollection(ROW)
    const repo = new RowsRepository(coll, ['mode'])
    coll.interleave = () => { (coll.stored as Record<string, unknown>).mode = 'locked' }
    const result = await repo.update('r1', { title: 'After' })
    expect(coll.sets[0]).not.toHaveProperty('mode')
    expect(coll.stored).toMatchObject({ title: 'After', mode: 'locked' })
    // The returned entity is still the full validated row.
    expect(result).toMatchObject({ title: 'After', mode: 'moderated' })
  })

  it('writes a patch-only field when the patch names it', async () => {
    const coll = fakeCollection(ROW)
    const repo = new RowsRepository(coll, ['mode'])
    await repo.update('r1', { mode: 'unmoderated' })
    expect(coll.sets[0]).toMatchObject({ mode: 'unmoderated' })
    expect(coll.stored.mode).toBe('unmoderated')
  })
})

describe('ChatsRepository — the Concierge state columns are patch-only', () => {
  it('declares conciergeMode, conciergeModeSetBy and conciergeModeReason', () => {
    const repo = new ChatsRepository() as unknown as { patchOnlyFields(): readonly string[] }
    expect([...repo.patchOnlyFields()].sort()).toEqual(['conciergeMode', 'conciergeModeReason', 'conciergeModeSetBy'])
  })
})

describe('ChatsRepository.setConciergeMode — compare-and-set', () => {
  function withFakeCollection(matched: boolean) {
    const updateOne = jest.fn(async () => ({ matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0 }))
    const repo = new ChatsRepository()
    jest.spyOn(repo as unknown as { getCollection: () => Promise<unknown> }, 'getCollection')
      .mockResolvedValue({ updateOne } as never)
    return { repo, updateOne }
  }
  const COLS = { conciergeMode: 'unmoderated' as const, conciergeModeSetBy: 'concierge' as const, conciergeModeReason: 'refusals' as const }

  it('writes unconditionally without an expected state', async () => {
    const { repo, updateOne } = withFakeCollection(true)
    await expect(repo.setConciergeMode('chat-1', COLS)).resolves.toBe(true)
    expect(updateOne).toHaveBeenCalledWith({ id: 'chat-1' }, { $set: COLS })
  })

  it('treats NULL as Moderated when Moderated is expected', async () => {
    const { repo, updateOne } = withFakeCollection(true)
    await repo.setConciergeMode('chat-1', COLS, 'moderated')
    expect(updateOne).toHaveBeenCalledWith(
      { id: 'chat-1', $or: [{ conciergeMode: 'moderated' }, { conciergeMode: null }] },
      { $set: COLS },
    )
  })

  it('reports a miss when the stored state no longer matches', async () => {
    const { repo, updateOne } = withFakeCollection(false)
    await expect(repo.setConciergeMode('chat-1', COLS, 'locked')).resolves.toBe(false)
    expect(updateOne).toHaveBeenCalledWith({ id: 'chat-1', $or: [{ conciergeMode: 'locked' }] }, { $set: COLS })
  })
})
