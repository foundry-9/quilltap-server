/**
 * Memory refactor Phase B — the index gets an owner; one deletion.
 *
 * - `memoryIndex` round-trips against real memory rows: upsert → search →
 *   setTier → hot-only search → remove, and a reload reads tiers from the rows
 *   so a cold row stays cold (bug 205 closed structurally).
 * - The per-character cache's first load is memoised.
 * - `retireMemories` scrubs all three link columns, retires a digest with its
 *   last member (except under retention), and under `keep: 'manual'` spares
 *   MANUAL rows, cold rows and a digest that still has a member.
 * - Grep-tests (invariant 5): nothing outside `index-store/` imports the
 *   vector cache, calls `updateTierBulk` or writes an embedding through
 *   `updateForCharacter`; nothing outside `retire.ts` calls `bulkDeleteUnsafe`.
 *
 * The SQL runs against a real in-memory SQLite table.
 */

import fs from 'fs'
import path from 'path'

jest.unmock('@/lib/embedding/vector-store')

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  __esModule: true,
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getDatabaseAsync: jest.fn(),
  initializeDatabase: jest.fn(),
}))

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(),
}))

jest.mock('@/lib/realtime/bus', () => ({
  publishRealtime: jest.fn(),
}))

jest.mock('@/lib/memory/commonplace-mirror', () => ({
  mirrorCommonplaceForSubjects: jest.fn(async () => 0),
}))

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => make()),
  })
  return { logger: make() }
})

import { rawQuery } from '@/lib/database/manager'
import { getRawDatabase } from '@/lib/database/backends/sqlite/client'
import { getRepositories } from '@/lib/repositories/factory'
import { publishRealtime } from '@/lib/realtime/bus'
import { MemoriesRepository } from '@/lib/database/repositories/memories.repository'
import { float32ToBlob } from '@/lib/embedding/float32-conversion'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import { memoryIndex } from '@/lib/memory/index-store'
import { retireMemories, retireChatMemories } from '@/lib/memory/retire'

// Real binding by absolute root path — a bare require resolves to the suite-wide mock.
const Database = require(path.join(process.cwd(), 'node_modules', 'better-sqlite3'))

const CHAR = 'char-1'
let db: InstanceType<typeof Database>

function vec(...xs: number[]): Float32Array {
  const v = Float32Array.from(xs)
  const norm = Math.hypot(...xs) || 1
  return v.map((x) => x / norm)
}

function seed(rows: Array<Record<string, unknown>>) {
  const insert = db.prepare(`INSERT INTO memories
    (id, characterId, aboutCharacterId, chatId, tier, source, supersededById, supersededAt, consolidatedFrom, relatedMemoryIds, embedding, updatedAt)
    VALUES (@id, @characterId, @aboutCharacterId, @chatId, @tier, @source, @supersededById, @supersededAt, @consolidatedFrom, @relatedMemoryIds, @embedding, @updatedAt)`)
  for (const r of rows) {
    insert.run({
      characterId: CHAR, aboutCharacterId: null, chatId: null, tier: 'hot', source: 'AUTO',
      supersededById: null, supersededAt: null, consolidatedFrom: '[]', relatedMemoryIds: '[]',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...r,
      embedding: r.embedding instanceof Float32Array ? float32ToBlob(r.embedding) : (r.embedding ?? null),
    })
  }
}

function read(id: string) {
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

function ids(column: string, id: string): string[] {
  return JSON.parse((read(id)?.[column] as string) ?? '[]')
}

function rowAsMemory(row: Record<string, unknown>) {
  return {
    ...row,
    consolidatedFrom: JSON.parse((row.consolidatedFrom as string) ?? '[]'),
    relatedMemoryIds: JSON.parse((row.relatedMemoryIds as string) ?? '[]'),
  }
}

/** The repository surface the index and the retirement chokepoint use, on the real table. */
function installRepos() {
  const real = new MemoriesRepository()
  const memories = {
    findIndexRowsByCharacterId: jest.fn((c: string) => real.findIndexRowsByCharacterId(c)),
    findDigestsContainingMembers: jest.fn((c: string[], m: string[]) => real.findDigestsContainingMembers(c, m)),
    findIdsSupersededByAny: jest.fn((c: string[], d: string[]) => real.findIdsSupersededByAny(c, d)),
    removeConsolidatedMembers: jest.fn((c: string, d: string, m: string[]) => real.removeConsolidatedMembers(c, d, m)),
    removeRelatedMemoryIdsEverywhere: jest.fn((list: string[]) => real.removeRelatedMemoryIdsEverywhere(list)),
    findByIds: jest.fn(async (list: string[]) =>
      list.map(read).filter((r): r is Record<string, unknown> => !!r).map(rowAsMemory)),
    findByChatId: jest.fn(async (chatId: string) =>
      (db.prepare('SELECT * FROM memories WHERE chatId = ?').all(chatId) as Record<string, unknown>[]).map(rowAsMemory)),
    updateForCharacter: jest.fn(async (_c: string, id: string, patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        const value = v instanceof Float32Array ? float32ToBlob(v) : Array.isArray(v) ? JSON.stringify(v) : v
        db.prepare(`UPDATE memories SET "${k}" = ? WHERE id = ?`).run(value, id)
      }
      const row = read(id)
      return row ? rowAsMemory(row) : null
    }),
    updateTierBulk: jest.fn(async (_c: string, list: string[], tier: string, extra: Record<string, unknown> = {}) => {
      for (const id of list) {
        db.prepare('UPDATE memories SET tier = ? WHERE id = ?').run(tier, id)
        if (extra.supersededById !== undefined) {
          db.prepare('UPDATE memories SET supersededById = ?, supersededAt = NULL WHERE id = ?')
            .run(extra.supersededById, id)
        }
      }
      return list.length
    }),
    bulkDeleteUnsafe: jest.fn(async (_c: string, list: string[]) => {
      let n = 0
      for (const id of list) n += db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes
      return n
    }),
  }
  ;(getRepositories as jest.Mock).mockReturnValue({ memories })
  return memories
}

beforeEach(() => {
  jest.clearAllMocks()
  getVectorStoreManager().unloadAll()
  db = new Database(':memory:')
  db.exec(`CREATE TABLE memories (
    id TEXT PRIMARY KEY, characterId TEXT, aboutCharacterId TEXT, chatId TEXT, tier TEXT, source TEXT,
    supersededById TEXT, supersededAt TEXT, consolidatedFrom TEXT, relatedMemoryIds TEXT,
    embedding BLOB, updatedAt TEXT)`)
  ;(rawQuery as jest.Mock).mockImplementation(async (sql: string, params: unknown[] = []) =>
    db.prepare(sql).all(...params))
  ;(getRawDatabase as jest.Mock).mockReturnValue(db)
})

afterEach(() => {
  db.close()
})

describe('memoryIndex — the rows are the index', () => {
  it('round-trips upsert → search → setTier → hot-only search → remove', async () => {
    seed([
      { id: 'a', embedding: vec(1, 0, 0) },
      { id: 'b', embedding: vec(0, 1, 0) },
      { id: 'c' }, // no vector yet
    ])
    const repos = installRepos()

    // Loaded from the rows: two vectors, c has none.
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: false })).map((h) => h.id)).toEqual(['a', 'b'])

    // Upsert writes the row and the loaded cache.
    await memoryIndex.upsert(CHAR, [{ id: 'c', embedding: vec(0.9, 0.1, 0) }])
    expect(repos.updateForCharacter).toHaveBeenCalledWith(CHAR, 'c', expect.objectContaining({ embedding: expect.any(Float32Array) }))
    expect(read('c')!.embedding).not.toBeNull()
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 2, hotOnly: false })).map((h) => h.id)).toEqual(['a', 'c'])

    // setTier writes the row and re-stamps the cache; hot-only search drops it.
    await memoryIndex.setTier(CHAR, ['a'], 'cold')
    expect(read('a')!.tier).toBe('cold')
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: true })).map((h) => h.id)).toEqual(['c', 'b'])
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: false })).map((h) => h.id)).toContain('a')

    // remove evicts from the cache.
    expect(await memoryIndex.remove(CHAR, ['c'])).toBe(1)
    expect((await memoryIndex.search(CHAR, vec(1, 0, 0), { limit: 5, hotOnly: false })).map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('a reload reads the tier with the vector, so a cold row stays cold (bug 205)', async () => {
    seed([
      { id: 'hot', embedding: vec(1, 0) },
      { id: 'cold', tier: 'cold', embedding: vec(1, 0.01) },
    ])
    installRepos()

    memoryIndex.reload(CHAR)
    const hits = await memoryIndex.search(CHAR, vec(1, 0), { limit: 5, hotOnly: true })
    expect(hits.map((h) => h.id)).toEqual(['hot'])
  })

  it('an upsert with no stated tier keeps the row\'s tier', async () => {
    seed([{ id: 'cold', tier: 'cold', embedding: vec(1, 0) }])
    installRepos()
    await memoryIndex.search(CHAR, vec(1, 0), { limit: 1, hotOnly: false }) // load

    await memoryIndex.upsert(CHAR, [{ id: 'cold', embedding: vec(0.8, 0.2) }])
    expect(await memoryIndex.search(CHAR, vec(1, 0), { limit: 5, hotOnly: true })).toEqual([])
  })

  it('does not load a cache just to take a write', async () => {
    seed([{ id: 'a' }])
    const repos = installRepos()
    await memoryIndex.upsert(CHAR, [{ id: 'a', embedding: vec(1, 0) }])
    expect(repos.findIndexRowsByCharacterId).not.toHaveBeenCalled()
    // The next search loads the row as written.
    expect((await memoryIndex.search(CHAR, vec(1, 0), { limit: 1, hotOnly: false })).map((h) => h.id)).toEqual(['a'])
  })

  it('memoises the first load: concurrent first uses share one read', async () => {
    seed([{ id: 'a', embedding: vec(1, 0) }])
    const repos = installRepos()
    await Promise.all([
      memoryIndex.search(CHAR, vec(1, 0), { limit: 1, hotOnly: false }),
      memoryIndex.search(CHAR, vec(1, 0), { limit: 1, hotOnly: false }),
      memoryIndex.shape(CHAR, 2),
    ])
    expect(repos.findIndexRowsByCharacterId).toHaveBeenCalledTimes(1)
  })

  it('reports a dimension mismatch through shape, and searches only matching vectors', async () => {
    seed([
      { id: 'old', embedding: vec(1, 0, 0) },
      { id: 'new', embedding: vec(1, 0) },
    ])
    installRepos()
    expect(await memoryIndex.shape(CHAR, 4)).toEqual({ size: 2, dominantDimensions: expect.any(Number), matching: 0 })
    expect((await memoryIndex.search(CHAR, vec(1, 0), { limit: 5, hotOnly: false })).map((h) => h.id)).toEqual(['new'])
  })
})

describe('retireMemories — the one deletion', () => {
  it('scrubs relatedMemoryIds, consolidatedFrom and supersededById, and evicts the vectors', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1', 'm-2']), embedding: vec(1, 0) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest', embedding: vec(1, 0.1) },
      { id: 'm-2', tier: 'cold', supersededById: 'digest', relatedMemoryIds: JSON.stringify(['m-1', 'x']) },
      { id: 'x', relatedMemoryIds: JSON.stringify(['m-1']), embedding: vec(0, 1) },
      { id: 'other-digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['o-1']) },
      { id: 'o-1', tier: 'cold', supersededById: 'other-digest' },
    ])
    installRepos()
    await memoryIndex.search(CHAR, vec(1, 0), { limit: 1, hotOnly: false }) // load the cache

    const report = await retireMemories(['m-1', 'other-digest'], { reason: 'item-delete' })

    expect(report.retired).toBe(2)
    expect(read('m-1')).toBeUndefined()
    // relatedMemoryIds: every holder loses the retired id.
    expect(ids('relatedMemoryIds', 'x')).toEqual([])
    expect(ids('relatedMemoryIds', 'm-2')).toEqual(['x'])
    // consolidatedFrom: the surviving digest counts only surviving members.
    expect(ids('consolidatedFrom', 'digest')).toEqual(['m-2'])
    // supersededById: a member of a retired digest becomes a demoted cold row.
    expect(read('o-1')!.supersededById).toBeNull()
    expect(read('o-1')!.tier).toBe('cold')
    // The vector is gone from the cache.
    const hits = await memoryIndex.search(CHAR, vec(1, 0.1), { limit: 5, hotOnly: false })
    expect(hits.map((h) => h.id)).not.toContain('m-1')
    expect(publishRealtime).toHaveBeenCalledWith('memories')
  })

  it('retires a digest with its last member', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1', 'gone']) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest' },
    ])
    installRepos()

    const report = await retireMemories(['m-1'], { reason: 'item-delete' })

    expect(report.digestsRetiredWithLastMember).toBe(1)
    expect(read('digest')).toBeUndefined()
  })

  it('retention never takes the digest its expired members leave behind', async () => {
    seed([
      { id: 'digest', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['m-1']) },
      { id: 'm-1', tier: 'cold', supersededById: 'digest' },
    ])
    installRepos()

    const report = await retireMemories(['m-1'], { reason: 'retention' })

    expect(report.digestsRetiredWithLastMember).toBe(0)
    expect(read('digest')).toBeDefined()
    expect(ids('consolidatedFrom', 'digest')).toEqual([])
  })

  it('keep: manual spares MANUAL rows, cold rows and a digest with a surviving member', async () => {
    seed([
      { id: 'auto', chatId: 'chat-1', relatedMemoryIds: JSON.stringify(['manual']) },
      { id: 'manual', chatId: 'chat-1', source: 'MANUAL', relatedMemoryIds: JSON.stringify(['auto']) },
      { id: 'cold', chatId: 'chat-1', tier: 'cold' },
      { id: 'kept-digest', chatId: 'chat-1', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['member']) },
      { id: 'member', chatId: 'chat-2', tier: 'cold', supersededById: 'kept-digest' },
      { id: 'empty-digest', chatId: 'chat-1', source: 'CONSOLIDATED', consolidatedFrom: JSON.stringify(['long-gone']) },
    ])
    installRepos()

    const report = await retireChatMemories('chat-1')

    expect(report.retiredIds.sort()).toEqual(['auto', 'empty-digest'])
    expect(report.sparedBy).toEqual({ manual: 1, digest: 1, cold: 1 })
    expect(read('manual')).toBeDefined()
    expect(read('cold')).toBeDefined()
    expect(read('kept-digest')).toBeDefined()
    // A spared row keeps its own links; it loses only the retired neighbour.
    expect(ids('relatedMemoryIds', 'manual')).toEqual([])
  })

  it('is idempotent: an id already gone is scrubbed from links and otherwise ignored', async () => {
    seed([{ id: 'n', relatedMemoryIds: JSON.stringify(['ghost']) }])
    installRepos()

    const report = await retireMemories(['ghost'], { reason: 'item-delete' })

    expect(report.retired).toBe(0)
    expect(ids('relatedMemoryIds', 'n')).toEqual([])
    expect(publishRealtime).not.toHaveBeenCalled()
  })
})

describe('MemoriesRepository.delete', () => {
  it('refuses: memories are deleted through retireMemories', async () => {
    await expect(new MemoriesRepository().delete('m-1')).rejects.toThrow(/retireMemories/)
  })
})

// ---------------------------------------------------------------------------
// Grep-tests (invariant 5)
// ---------------------------------------------------------------------------

const ROOT = process.cwd()
const SOURCE_DIRS = ['lib', 'app', 'components', 'hooks', 'migrations', 'packages/quilltap/src', 'scripts']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
    }
  }
  for (const dir of SOURCE_DIRS) walk(path.join(ROOT, dir))
  return out
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort()
}

describe('chokepoint grep-tests', () => {
  it('only index-store imports the in-process vector cache', () => {
    expect(filesMatching(/from ['"]@\/lib\/embedding\/vector-store['"]|import\(['"]@\/lib\/embedding\/vector-store['"]\)/))
      .toEqual(['lib/memory/index-store/memory-index.ts'])
  })

  it('only index-store moves memories between tiers', () => {
    expect(filesMatching(/memories\.updateTierBulk\(/)).toEqual(['lib/memory/index-store/memory-index.ts'])
  })

  it('only index-store writes an embedding through updateForCharacter', () => {
    const offenders = sourceFiles().filter((file) => {
      const src = fs.readFileSync(file, 'utf8')
      return /updateForCharacter\([^)]*\{[^}]*\bembedding\b/s.test(src)
    }).map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    expect(offenders).toEqual([])
    // The index's own write builds the patch first; it is the one writer.
    const index = fs.readFileSync(path.join(ROOT, 'lib/memory/index-store/memory-index.ts'), 'utf8')
    expect(index).toMatch(/embedding: entry\.embedding/)
  })

  it('only retire.ts deletes memory rows', () => {
    expect(filesMatching(/\.bulkDeleteUnsafe\(/)).toEqual(['lib/memory/retire.ts'])
    expect(filesMatching(/memories\.(delete|deleteForCharacter|deleteBySourceMessageId|deleteByChatId|bulkDelete)\(/)).toEqual([])
  })
})
