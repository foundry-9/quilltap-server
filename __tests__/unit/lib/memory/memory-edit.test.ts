/**
 * Bug 203: a hand edit (PUT /api/v1/memories/[id]) goes through `editMemory`,
 * which keeps the row's derived state in step — re-embed, reinforcedImportance,
 * two-sided links, frozen archive, realtime hint, Commonplace mirror.
 */

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...child, child: jest.fn(() => child) } }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/memory-service', () => ({ updateMemoryWithEmbedding: jest.fn() }))
jest.mock('@/lib/memory/frozen-archive-cache', () => ({ invalidateFrozenArchive: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/file-storage/commonplace-digest-vault-bridge', () => ({
  writeCommonplaceDigestsToVault: jest.fn().mockResolvedValue({ written: 1, unchanged: 0, skipped: 0 }),
}))

import { editMemory } from '@/lib/memory/memory-edit'
import { getRepositories } from '@/lib/repositories/factory'
import { updateMemoryWithEmbedding } from '@/lib/memory/memory-service'
import { invalidateFrozenArchive } from '@/lib/memory/frozen-archive-cache'
import { publishRealtime } from '@/lib/realtime/bus'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import { calculateReinforcedImportance } from '@/lib/memory/reinforced-importance'

type Row = Record<string, any>

function setup(rows: Row[]) {
  const byId = new Map(rows.map((r) => [r.id, { ...r }]))
  const memories = {
    findByIdForCharacter: jest.fn(async (characterId: string, id: string) => {
      const row = byId.get(id)
      return row && row.characterId === characterId ? { ...row } : null
    }),
    updateForCharacter: jest.fn(async (_c: string, id: string, patch: Row) => {
      const row = byId.get(id)
      if (!row) return null
      Object.assign(row, patch)
      return { ...row }
    }),
    findByCharacterId: jest.fn(async (characterId: string) =>
      Array.from(byId.values()).filter((r) => r.characterId === characterId)
    ),
  }
  const characters = {
    findByIdRaw: jest.fn(async (id: string) => ({ id, name: id === 'holder' ? 'Holly' : 'Otto' })),
  }
  jest.mocked(getRepositories).mockReturnValue({ memories, characters } as never)
  jest.mocked(updateMemoryWithEmbedding).mockImplementation(async (characterId, id, patch) =>
    memories.updateForCharacter(characterId, id, patch as Row) as never
  )
  return { memories, byId }
}

const base = {
  characterId: 'holder',
  content: 'old text',
  summary: 'old',
  importance: 0.3,
  reinforcementCount: 4,
  reinforcedImportance: 0.4,
  relatedMemoryIds: [] as string[],
  source: 'AUTO',
  tier: 'hot',
  aboutCharacterId: null,
}

describe('editMemory (bug 203)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('routes text through the re-embedding update, invalidates the archive and publishes', async () => {
    setup([{ ...base, id: 'm1' }])
    const result = await editMemory('holder', 'm1', { content: 'new text' }, { userId: 'u1' })

    expect(result.ok).toBe(true)
    expect(updateMemoryWithEmbedding).toHaveBeenCalledWith('holder', 'm1', { content: 'new text' }, { userId: 'u1' })
    expect(invalidateFrozenArchive).toHaveBeenCalledWith('holder')
    expect(publishRealtime).toHaveBeenCalledWith('memories')
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })

  it('recomputes reinforcedImportance from the reinforcement count when importance changes', async () => {
    const { byId } = setup([{ ...base, id: 'm1' }])
    await editMemory('holder', 'm1', { importance: 0.9 }, { userId: 'u1' })
    expect(byId.get('m1')!.reinforcedImportance).toBe(calculateReinforcedImportance(0.9, 4))
  })

  it('leaves reinforcedImportance alone when importance is unchanged', async () => {
    const { byId } = setup([{ ...base, id: 'm1' }])
    await editMemory('holder', 'm1', { importance: 0.3, summary: 'new' }, { userId: 'u1' })
    expect(byId.get('m1')!.reinforcedImportance).toBe(0.4)
  })

  it('refuses related ids that are missing or belong to another character', async () => {
    setup([
      { ...base, id: 'm1' },
      { ...base, id: 'foreign', characterId: 'someone-else' },
    ])
    const result = await editMemory('holder', 'm1', { relatedMemoryIds: ['foreign', 'ghost'] }, { userId: 'u1' })
    expect(result).toEqual({ ok: false, reason: 'invalid-related', invalidIds: ['foreign', 'ghost'] })
    expect(updateMemoryWithEmbedding).not.toHaveBeenCalled()
  })

  it('writes links on both sides: added neighbours gain the id, dropped ones lose it', async () => {
    const { byId } = setup([
      { ...base, id: 'm1', relatedMemoryIds: ['old-n'] },
      { ...base, id: 'old-n', relatedMemoryIds: ['m1'] },
      { ...base, id: 'new-n', relatedMemoryIds: [] },
    ])
    const result = await editMemory('holder', 'm1', { relatedMemoryIds: ['new-n', 'm1'] }, { userId: 'u1' })
    expect(result.ok).toBe(true)
    expect(byId.get('m1')!.relatedMemoryIds).toEqual(['new-n'])
    expect(byId.get('new-n')!.relatedMemoryIds).toEqual(['m1'])
    expect(byId.get('old-n')!.relatedMemoryIds).toEqual([])
  })

  it('rewrites the Commonplace mirror for a hot digest, from every hot digest in its bucket', async () => {
    const embedding = new Float32Array([1, 0])
    setup([
      { ...base, id: 'd1', source: 'CONSOLIDATED', aboutCharacterId: 'otto', embedding },
      { ...base, id: 'd2', source: 'CONSOLIDATED', aboutCharacterId: 'otto', embedding, content: 'other digest' },
      { ...base, id: 'd3', source: 'CONSOLIDATED', aboutCharacterId: 'otto', embedding, tier: 'cold' },
    ])
    await editMemory('holder', 'd1', { content: 'revised digest' }, { userId: 'u1' })

    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledTimes(1)
    const input = jest.mocked(writeCommonplaceDigestsToVault).mock.calls[0][0]
    expect(input.holderCharacterId).toBe('holder')
    expect(input.files).toHaveLength(1)
    expect(input.files[0]).toMatchObject({ subjectCharacterId: 'otto', subjectName: 'Otto', isSelf: false })
    expect(input.files[0].digests.map((d) => d.content).sort()).toEqual(['other digest', 'revised digest'])
  })

  it('returns not-found for a memory of another character', async () => {
    setup([{ ...base, id: 'm1' }])
    expect(await editMemory('someone-else', 'm1', { content: 'x' }, { userId: 'u1' })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })
})
