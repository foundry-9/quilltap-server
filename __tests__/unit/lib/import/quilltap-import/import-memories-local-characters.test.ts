/**
 * Bug 240 — a chats-only `.qtap` export carries its memories but not its cast,
 * so on re-import every memory named a character absent from `idMaps` and was
 * skipped as "non-existent", although the character was right there in the
 * instance. A memory now resolves to the instance's own character of that id
 * (raw read, so a broken vault still owns its rows) unless the character is
 * an archived tombstone.
 */

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

import { importMemories } from '@/lib/import/quilltap-import/import-entities'
import { getRepositories } from '@/lib/repositories/factory'

const LOCAL = '11111111-1111-4111-8111-111111111111'
const ARCHIVED = '22222222-2222-4222-8222-222222222222'
const MISSING = '33333333-3333-4333-8333-333333333333'
const BUNDLED_SOURCE = '44444444-4444-4444-8444-444444444444'
const BUNDLED_NEW = '55555555-5555-4555-8555-555555555555'

let memoriesCreate: jest.Mock
let findByIdRaw: jest.Mock

function memory(id: string, characterId: string, aboutCharacterId: string | null = null) {
  return {
    id,
    characterId,
    aboutCharacterId,
    chatId: null,
    content: 'Marmalade hates the radiator.',
    summary: 'Marmalade and the radiator',
    tags: [],
    relatedMemoryIds: [],
    createdAt: '2026-10-13T13:52:06.439Z',
    updatedAt: '2026-10-13T13:52:06.439Z',
  }
}

function idMaps() {
  return {
    characters: new Map([[BUNDLED_SOURCE, BUNDLED_NEW]]),
    chats: new Map(),
    projects: new Map(),
    tags: new Map(),
    preserveIdsSkips: new Set(),
    messages: new Map(),
  }
}

async function run(memories: ReturnType<typeof memory>[]) {
  const warnings: string[] = []
  const result = await importMemories(
    'user-1',
    memories as never,
    { conflictStrategy: 'duplicate', includeMemories: true, includeRelatedEntities: true },
    idMaps() as never,
    { memories: { create: memoriesCreate } } as never,
    warnings,
  )
  return { result, warnings }
}

beforeEach(() => {
  jest.clearAllMocks()
  memoriesCreate = jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => ({ ...data, id: opts?.id ?? 'new' }))
  findByIdRaw = jest.fn(async (id: string) => {
    if (id === LOCAL) return { id: LOCAL, archivedAt: null }
    if (id === ARCHIVED) return { id: ARCHIVED, archivedAt: '2026-10-01T00:00:00.000Z' }
    return null
  })
  ;(getRepositories as jest.Mock).mockReturnValue({ characters: { findByIdRaw } })
})

describe('importMemories — characters the bundle does not carry (bug 240)', () => {
  it('imports a memory of a character this instance already holds', async () => {
    const { result, warnings } = await run([memory('m1', LOCAL, LOCAL)])
    expect(result.imported).toBe(1)
    expect(warnings).toEqual([])
    expect(memoriesCreate.mock.calls[0][0]).toMatchObject({ characterId: LOCAL, aboutCharacterId: LOCAL })
  })

  it('still prefers the bundle\'s own mapping', async () => {
    await run([memory('m1', BUNDLED_SOURCE, LOCAL)])
    expect(memoriesCreate.mock.calls[0][0]).toMatchObject({ characterId: BUNDLED_NEW, aboutCharacterId: LOCAL })
    expect(findByIdRaw).not.toHaveBeenCalledWith(BUNDLED_SOURCE)
  })

  it('skips a memory of an archived character rather than reviving the tombstone', async () => {
    const { result, warnings } = await run([memory('m1', ARCHIVED)])
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(warnings[0]).toMatch(/non-existent character/)
    expect(memoriesCreate).not.toHaveBeenCalled()
  })

  it('skips a memory of a character found nowhere, and drops an unknown aboutCharacterId', async () => {
    const { result } = await run([memory('m1', MISSING), memory('m2', LOCAL, MISSING)])
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(1)
    expect(memoriesCreate.mock.calls[0][0]).toMatchObject({ characterId: LOCAL, aboutCharacterId: null })
  })

  it('reads each local character once per import', async () => {
    await run([memory('m1', LOCAL), memory('m2', LOCAL), memory('m3', LOCAL)])
    expect(findByIdRaw.mock.calls.filter(([id]) => id === LOCAL)).toHaveLength(1)
  })
})
