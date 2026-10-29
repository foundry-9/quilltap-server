/**
 * @jest-environment node
 *
 * #120 — a `chat_settings` row holding a value `ChatSettingsSchema` refuses
 * (a legacy or imported `cheapLLMSettings`, say) used to read as "no
 * settings", so every load and every save inserted a new row, and the next
 * read found the refused row again and reverted to defaults.
 *
 * The read now repairs refused fields to their defaults, newest row first,
 * and `updateForUser` updates — and so repairs — the existing row.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { ChatSettingsRepository } from '@/lib/database/repositories/chat-settings.repository'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ROW_ID = '22222222-2222-4222-8222-222222222222'

type Doc = Record<string, unknown>

/** An in-memory `chat_settings` table that keeps rows exactly as stored. */
function fakeCollection(initial: Doc[]) {
  const rows: Doc[] = initial.map((row) => ({ ...row }))
  const matches = (row: Doc, filter: Doc) => Object.entries(filter).every(([k, v]) => row[k] === v)
  return {
    rows,
    async find(filter: Doc, options?: { sort?: Record<string, number> }) {
      const found = rows.filter((row) => matches(row, filter)).map((row) => ({ ...row }))
      if (options?.sort?.updatedAt === -1) {
        found.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      }
      return found
    },
    async findOne(filter: Doc) {
      const row = rows.find((r) => matches(r, filter))
      return row ? { ...row } : null
    },
    async insertOne(doc: Doc) {
      rows.push({ ...doc })
      return { insertedId: doc.id, acknowledged: true }
    },
    async updateOne(filter: Doc, spec: { $set: Doc }) {
      const row = rows.find((r) => matches(r, filter))
      if (!row) return { matchedCount: 0, modifiedCount: 0 }
      Object.assign(row, spec.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
}

function repoOver(collection: ReturnType<typeof fakeCollection>) {
  const repo = new ChatSettingsRepository()
  ;(repo as unknown as { getCollection: () => Promise<unknown> }).getCollection = async () => collection
  return repo
}

const INVALID_ROW: Doc = {
  id: ROW_ID,
  userId: USER_ID,
  avatarDisplayMode: 'ALWAYS',
  avatarDisplayStyle: 'CIRCULAR',
  tagStyles: {},
  cheapLLMSettings: { strategy: 'USER_DEFINED', userDefinedProfileId: 'not-a-uuid' },
  composerEmoji: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('ChatSettingsRepository — a stored row with a refused value (#120)', () => {
  it('reads the row with the refused field repaired to its default', async () => {
    const coll = fakeCollection([INVALID_ROW])
    const settings = await repoOver(coll).findByUserId(USER_ID)

    expect(settings?.id).toBe(ROW_ID)
    expect(settings?.cheapLLMSettings.strategy).toBe('PROVIDER_CHEAPEST')
    expect(coll.rows).toHaveLength(1)
  })

  it('does not insert a row when updateForUser meets the refused row', async () => {
    const coll = fakeCollection([INVALID_ROW])
    const repo = repoOver(coll)

    await repo.updateForUser(USER_ID, { avatarDisplayMode: 'ALWAYS' })
    await repo.updateForUser(USER_ID, { avatarDisplayMode: 'ALWAYS' })

    expect(coll.rows).toHaveLength(1)
  })

  it('keeps a save, and writes the repair back to the row', async () => {
    const coll = fakeCollection([INVALID_ROW])
    const repo = repoOver(coll)

    const saved = await repo.updateForUser(USER_ID, { composerEmoji: false })
    expect(saved?.composerEmoji).toBe(false)

    const reread = await repo.findByUserId(USER_ID)
    expect(reread?.id).toBe(ROW_ID)
    expect(reread?.composerEmoji).toBe(false)
    expect(coll.rows).toHaveLength(1)
    expect((coll.rows[0].cheapLLMSettings as Doc).strategy).toBe('PROVIDER_CHEAPEST')
  })

  it('clears or defaults a refused optional field rather than keeping its value', async () => {
    const coll = fakeCollection([{ ...INVALID_ROW, cheapLLMSettings: undefined, imageDescriptionProfileId: 'nope', sidebarWidth: 9999 }])
    const repo = repoOver(coll)

    const settings = await repo.findByUserId(USER_ID)
    expect(settings?.imageDescriptionProfileId).toBeNull()
    expect(settings?.sidebarWidth).toBe(256)
  })

  it('prefers the newest valid row when duplicates exist', async () => {
    const newer = {
      ...INVALID_ROW,
      id: '33333333-3333-4333-8333-333333333333',
      cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true, allowCheapFallback: false, embeddingProvider: 'OPENAI' },
      composerEmoji: false,
      updatedAt: '2026-02-01T00:00:00.000Z',
    }
    const coll = fakeCollection([INVALID_ROW, newer])

    const settings = await repoOver(coll).findByUserId(USER_ID)
    expect(settings?.id).toBe(newer.id)
    expect(settings?.composerEmoji).toBe(false)
  })

  it('still answers null when the user has no row, and creates one', async () => {
    const coll = fakeCollection([])
    const repo = repoOver(coll)

    expect(await repo.findByUserId(USER_ID)).toBeNull()
    await repo.updateForUser(USER_ID, {})
    expect(coll.rows).toHaveLength(1)
  })
})
