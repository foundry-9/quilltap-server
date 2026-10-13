/**
 * An in-memory memories table and memory index for admission tests.
 *
 * The table answers the repository calls admission makes (`create`,
 * `findByIds`, the delta writes, `updateForCharacter`) the way the real
 * repository does on the parent's read-write connection: every write lands
 * at once and returns the row as it now stands. The index searches the rows'
 * own embeddings by cosine, so it is always in step with the table.
 *
 * Wire it with `jest.mock('@/lib/repositories/factory')` /
 * `jest.mock('@/lib/memory/index-store')` factories that delegate to
 * {@link fakeRepositories} / {@link fakeMemoryIndex}.
 */

import type { Memory } from '@/lib/schemas/types'
import { calculateReinforcedImportance } from '@/lib/memory/scoring/reinforced-importance'
import { appendCappedFootnotes } from '@/lib/memory/reinforcement-footnotes'

export interface FakeMemoryStore {
  rows: Map<string, Memory>
  writes: string[]
  nextId: number
}

export function createFakeMemoryStore(): FakeMemoryStore {
  return { rows: new Map(), writes: [], nextId: 1 }
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

export function seedMemory(store: FakeMemoryStore, overrides: Partial<Memory> & { id: string; embedding: Float32Array }): Memory {
  const row = {
    characterId: 'char-1',
    content: 'content',
    summary: 'summary',
    keywords: [],
    tags: [],
    importance: 0.5,
    aboutCharacterId: null,
    source: 'AUTO',
    kind: 'semantic',
    reinforcementCount: 1,
    lastReinforcedAt: null,
    relatedMemoryIds: [],
    reinforcedImportance: 0.5,
    tier: 'hot',
    supersededById: null,
    consolidatedFrom: [],
    entities: [],
    occurredAt: null,
    narrativeTime: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Memory
  store.rows.set(row.id, row)
  return row
}

export function fakeRepositories(store: FakeMemoryStore) {
  const copy = (m: Memory): Memory => ({ ...m })
  const write = (name: string) => store.writes.push(name)
  return {
    characters: {
      findById: async () => null,
      findByIdRaw: async () => null,
    },
    memories: {
      create: async (data: Partial<Memory>, opts?: { createdAt?: string; updatedAt?: string }) => {
        write('create')
        const id = `mem-${store.nextId++}`
        const now = opts?.createdAt ?? new Date().toISOString()
        const row = { tier: 'hot', supersededById: null, consolidatedFrom: [], ...data, id, createdAt: now, updatedAt: now } as Memory
        store.rows.set(id, row)
        return copy(row)
      },
      findByIds: async (ids: string[]) => ids.map((id) => store.rows.get(id)).filter((m): m is Memory => !!m).map(copy),
      findByIdForCharacter: async (_c: string, id: string) => (store.rows.get(id) ? copy(store.rows.get(id)!) : null),
      updateForCharacter: async (_c: string, id: string, patch: Partial<Memory>) => {
        write('updateForCharacter')
        const row = store.rows.get(id)
        if (!row) return null
        Object.assign(row, patch)
        return copy(row)
      },
      incrementReinforcement: async (_c: string, id: string, at: string, by = 1) => {
        write('incrementReinforcement')
        const row = store.rows.get(id)
        if (!row) return null
        row.reinforcementCount = (row.reinforcementCount ?? 1) + by
        row.reinforcedImportance = calculateReinforcedImportance(row.importance, row.reinforcementCount)
        row.lastReinforcedAt = row.lastReinforcedAt && row.lastReinforcedAt > at ? row.lastReinforcedAt : at
        return {
          reinforcementCount: row.reinforcementCount,
          reinforcedImportance: row.reinforcedImportance,
          lastReinforcedAt: row.lastReinforcedAt,
        }
      },
      appendReinforcementFootnotes: async (_c: string, id: string, details: string[]) => {
        write('appendReinforcementFootnotes')
        const row = store.rows.get(id)
        if (!row) return null
        const next = appendCappedFootnotes(row.content, details)
        row.content = next.content
        return next
      },
      addRelatedMemoryIds: async (_c: string, id: string, ids: string[]) => {
        write('addRelatedMemoryIds')
        const row = store.rows.get(id)
        if (!row) return null
        const list = [...(row.relatedMemoryIds ?? [])]
        for (const add of ids) if (add !== id && !list.includes(add)) list.push(add)
        row.relatedMemoryIds = list
        return [...list]
      },
      countCapBreakdown: async () => ({ hotTotal: 0, demotable: 0, protected: 0 }),
    },
    backgroundJobs: { findRecentByType: async () => [] },
  }
}

export function fakeMemoryIndex(store: FakeMemoryStore) {
  return {
    search: async (characterId: string, vector: Float32Array, opts: { limit: number; hotOnly: boolean }) =>
      Array.from(store.rows.values())
        .filter((m) => m.characterId === characterId && m.embedding && m.embedding.length === vector.length)
        .filter((m) => !opts.hotOnly || m.tier !== 'cold')
        .map((m) => ({ id: m.id, score: cosine(vector, m.embedding as Float32Array), metadata: { memoryId: m.id, characterId } }))
        .sort((a, b) => b.score - a.score)
        .slice(0, opts.limit),
    upsert: async (_c: string, entries: Array<{ id: string; embedding: Float32Array }>) => {
      store.writes.push('index.upsert')
      return entries.map((e) => {
        const row = store.rows.get(e.id)
        if (!row) return null
        row.embedding = e.embedding
        return { ...row }
      })
    },
    indexInserted: async () => undefined,
    setTier: async (_c: string, ids: string[], tier: 'hot' | 'cold', extra: Partial<Memory> = {}) => {
      store.writes.push('index.setTier')
      for (const id of ids) {
        const row = store.rows.get(id)
        if (row) Object.assign(row, { tier }, extra)
      }
      return ids.length
    },
    remove: async () => 0,
    reload: () => undefined,
    reloadAll: () => undefined,
  }
}
