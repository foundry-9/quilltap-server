/**
 * Bug 203: a hand edit (PUT /api/v1/memories/[id]) goes through `updateMemory`
 * (`lib/memory/admission`), which keeps the row's derived state in step —
 * re-embed, reinforcedImportance, two-sided links, frozen archive, realtime
 * hint, Commonplace mirror.
 */

jest.mock('@/lib/logger', () => {
  const child = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return { logger: { ...child, child: jest.fn(() => child) } }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/memory/index-store', () => ({
  memoryIndex: {
    search: jest.fn(),
    shape: jest.fn(),
    upsert: jest.fn(),
    indexInserted: jest.fn(),
    setTier: jest.fn(),
    remove: jest.fn(),
    reload: jest.fn(),
    reloadAll: jest.fn(),
    entries: jest.fn(),
  },
  embeddingTextFor: jest.requireActual('@/lib/memory/index-store/embedding-text').embeddingTextFor,
}))
jest.mock('@/lib/memory/time/calendar-refresh', () => ({ refreshMemoryTimeZone: jest.fn(async () => 'UTC') }))
jest.mock('@/lib/memory/frozen-archive-cache', () => ({ invalidateFrozenArchive: jest.fn() }))
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))
jest.mock('@/lib/file-storage/commonplace-digest-vault-bridge', () => ({
  writeCommonplaceDigestsToVault: jest.fn().mockResolvedValue({ written: 1, unchanged: 0, skipped: 0 }),
}))

import { updateMemory } from '@/lib/memory/admission'
import { getRepositories } from '@/lib/repositories/factory'
import { memoryIndex } from '@/lib/memory/index-store'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { invalidateFrozenArchive } from '@/lib/memory/frozen-archive-cache'
import { publishRealtime } from '@/lib/realtime/bus'
import { writeCommonplaceDigestsToVault } from '@/lib/file-storage/commonplace-digest-vault-bridge'
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance'

type Row = Record<string, any>

const NEW_VECTOR = new Float32Array([0.5, 0.5])

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
    // The link deltas (bug 231): applied to the row as it stands.
    addRelatedMemoryIds: jest.fn(async (_c: string, id: string, ids: string[]) => {
      const row = byId.get(id)
      if (!row) return null
      const list = [...(row.relatedMemoryIds ?? [])]
      for (const add of ids) if (add !== id && !list.includes(add)) list.push(add)
      row.relatedMemoryIds = list
      return list
    }),
    removeRelatedMemoryIds: jest.fn(async (_c: string, id: string, ids: string[]) => {
      const row = byId.get(id)
      if (!row) return null
      row.relatedMemoryIds = (row.relatedMemoryIds ?? []).filter((l: string) => !ids.includes(l))
      return row.relatedMemoryIds
    }),
    findByCharacterId: jest.fn(async (characterId: string) =>
      Array.from(byId.values()).filter((r) => r.characterId === characterId)
    ),
    // Stands in for the repository's hot-digest query (source CONSOLIDATED,
    // hot tier, the subject's bucket) — the set consolidation mirrors.
    findHotDigests: jest.fn(async (characterId: string, subject: string) =>
      Array.from(byId.values()).filter(
        (r) =>
          r.characterId === characterId &&
          r.source === 'CONSOLIDATED' &&
          (r.tier ?? 'hot') === 'hot' &&
          r.aboutCharacterId === (subject === 'self' ? characterId : subject)
      )
    ),
  }
  const name = (id: string) => ({ id, name: id === 'holder' ? 'Holly' : id === 'otto' ? 'Otto' : 'Pip' })
  const characters = {
    findById: jest.fn(async (id: string) => name(id)),
    findByIdRaw: jest.fn(async (id: string) => name(id)),
  }
  jest.mocked(getRepositories).mockReturnValue({ memories, characters } as never)
  // The index writes the text and its vector in one row update.
  jest.mocked(memoryIndex.upsert).mockImplementation(async (characterId, entries) => {
    const rows = []
    for (const e of entries) {
      rows.push(await memories.updateForCharacter(characterId, e.id, { ...(e.alongside ?? {}), embedding: e.embedding }))
    }
    return rows as never
  })
  jest.mocked(generateEmbeddingForUser).mockResolvedValue({ embedding: NEW_VECTOR } as never)
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

describe('updateMemory (bug 203)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('embeds the edited text and writes text and vector in one index upsert, invalidates the archive and publishes', async () => {
    const { byId } = setup([{ ...base, id: 'm1' }])
    const result = await updateMemory('holder', 'm1', { content: 'new text' }, { userId: 'u1' })

    expect(result.ok).toBe(true)
    // The edited text (not the stored one) is what gets embedded.
    expect(generateEmbeddingForUser).toHaveBeenCalledWith('old\n\nnew text', 'u1')
    expect(memoryIndex.upsert).toHaveBeenCalledWith('holder', [
      { id: 'm1', embedding: NEW_VECTOR, alongside: { content: 'new text' } },
    ])
    expect(byId.get('m1')!.content).toBe('new text')
    expect(byId.get('m1')!.embedding).toBe(NEW_VECTOR)
    expect(invalidateFrozenArchive).toHaveBeenCalledWith('holder')
    expect(publishRealtime).toHaveBeenCalledWith('memories')
    expect(writeCommonplaceDigestsToVault).not.toHaveBeenCalled()
  })

  it('recomputes reinforcedImportance from the reinforcement count when importance changes', async () => {
    const { byId, memories } = setup([{ ...base, id: 'm1' }])
    await updateMemory('holder', 'm1', { importance: 0.9 }, { userId: 'u1' })
    expect(byId.get('m1')!.reinforcedImportance).toBe(calculateReinforcedImportance(0.9, 4))
    // The embedded text did not change: a plain row update, no re-embed.
    expect(generateEmbeddingForUser).not.toHaveBeenCalled()
    expect(memoryIndex.upsert).not.toHaveBeenCalled()
    expect(memories.updateForCharacter).toHaveBeenCalledTimes(1)
  })

  it('leaves reinforcedImportance alone when importance is unchanged', async () => {
    const { byId } = setup([{ ...base, id: 'm1' }])
    await updateMemory('holder', 'm1', { importance: 0.3, summary: 'new' }, { userId: 'u1' })
    expect(byId.get('m1')!.reinforcedImportance).toBe(0.4)
  })

  it('refuses related ids that are missing or belong to another character', async () => {
    setup([
      { ...base, id: 'm1' },
      { ...base, id: 'foreign', characterId: 'someone-else' },
    ])
    const result = await updateMemory('holder', 'm1', { relatedMemoryIds: ['foreign', 'ghost'] }, { userId: 'u1' })
    expect(result).toEqual({ ok: false, reason: 'invalid-related', invalidIds: ['foreign', 'ghost'] })
    expect(memoryIndex.upsert).not.toHaveBeenCalled()
    expect(getRepositories().memories.updateForCharacter).not.toHaveBeenCalled()
  })

  it('writes links on both sides: added neighbours gain the id, dropped ones lose it', async () => {
    const { byId } = setup([
      { ...base, id: 'm1', relatedMemoryIds: ['old-n'] },
      { ...base, id: 'old-n', relatedMemoryIds: ['m1'] },
      { ...base, id: 'new-n', relatedMemoryIds: [] },
    ])
    const result = await updateMemory('holder', 'm1', { relatedMemoryIds: ['new-n', 'm1'] }, { userId: 'u1' })
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
    await updateMemory('holder', 'd1', { content: 'revised digest' }, { userId: 'u1' })

    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledTimes(1)
    const input = jest.mocked(writeCommonplaceDigestsToVault).mock.calls[0][0]
    expect(input.holderCharacterId).toBe('holder')
    expect(input.files).toHaveLength(1)
    expect(input.files[0]).toMatchObject({ subjectCharacterId: 'otto', subjectName: 'Otto', isSelf: false })
    expect(input.files[0].digests.map((d) => d.content).sort()).toEqual(['other digest', 'revised digest'])
  })

  it('mirrors through the consolidation writer: same digest set, both buckets when the subject moves', async () => {
    setup([
      // An unembedded hot digest is still a hot digest: consolidation mirrors it.
      { ...base, id: 'd1', source: 'CONSOLIDATED', aboutCharacterId: 'otto', content: 'otto digest' },
      { ...base, id: 'd2', source: 'CONSOLIDATED', aboutCharacterId: 'pip', content: 'pip digest' },
    ])
    await updateMemory('holder', 'd1', { aboutCharacterId: 'pip' }, { userId: 'u1' })

    expect(writeCommonplaceDigestsToVault).toHaveBeenCalledTimes(1)
    const input = jest.mocked(writeCommonplaceDigestsToVault).mock.calls[0][0]
    const bySubject = Object.fromEntries(input.files.map((f) => [f.subjectCharacterId, f.digests.map((d) => d.content).sort()]))
    expect(bySubject).toEqual({ otto: [], pip: ['otto digest', 'pip digest'] })
    const src = require('fs').readFileSync(require('path').join(process.cwd(), 'lib/memory/admission/update-memory.ts'), 'utf8')
    expect(src).not.toMatch(/function refreshCommonplaceMirror/)
  })

  it('reports a failed re-embed instead of saving text over a stale vector', async () => {
    const { byId, memories } = setup([{ ...base, id: 'm1', relatedMemoryIds: [] }, { ...base, id: 'n1' }])
    jest.mocked(generateEmbeddingForUser).mockRejectedValue(new Error('provider down'))

    const result = await updateMemory('holder', 'm1', { content: 'new text', relatedMemoryIds: ['n1'] }, { userId: 'u1' })

    expect(result).toEqual({
      ok: false,
      reason: 'embedding-failed',
      message: 'Could not embed the edited memory: provider down',
    })
    expect(byId.get('m1')!.content).toBe('old text')
    expect(memoryIndex.upsert).not.toHaveBeenCalled()
    expect(memories.updateForCharacter).not.toHaveBeenCalled()
    expect(memories.addRelatedMemoryIds).not.toHaveBeenCalled()
    expect(byId.get('n1')!.relatedMemoryIds).toEqual([])
    expect(invalidateFrozenArchive).not.toHaveBeenCalled()
    expect(publishRealtime).not.toHaveBeenCalled()
  })

  it('returns not-found for a memory of another character', async () => {
    setup([{ ...base, id: 'm1' }])
    expect(await updateMemory('someone-else', 'm1', { content: 'x' }, { userId: 'u1' })).toEqual({
      ok: false,
      reason: 'not-found',
    })
  })
})
