/**
 * The research kit's scope and document tools (docs/developer/features/research-kit.md §5.1, §5.3, §5.4):
 * scope resolution (a store outside the pool is "not found" with the nearest
 * names), `find_documents` folding, deduplication by file and the miss
 * message, and `list_documents` collapsing.
 *
 * @jest-environment node
 */

const mockScan = jest.fn()
const mockAccessible = jest.fn()
const mockReadDocument = jest.fn()
const mockBlocked = jest.fn()
const mockClassify = jest.fn()
const mockOwnerStore = jest.fn()
const mockRepos = {
  docMountFileLinks: { scanForResearch: (...a: unknown[]) => mockScan(...a) },
  characters: { findAllRaw: jest.fn(async () => [{ id: 'char-amy', name: 'Amy' }]) },
  projects: { findAllRaw: jest.fn(async () => []) },
  groups: { findAllRaw: jest.fn(async () => []) },
}

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: () => mockRepos }))
jest.mock('@/lib/doc-edit/path-resolver', () => ({
  getAccessibleMountPoints: (...a: unknown[]) => mockAccessible(...a),
  resolveDocEditPath: jest.fn(async (_scope: string, path: string) => ({ path })),
  isTextFile: (p: string) => /\.(md|txt|json)$/i.test(p),
}))
jest.mock('@/lib/doc-edit/uri-producers', () => ({
  buildDocStoreUriResolver: async () => ({
    uriForMount: (store: string, _id: string, path: string) => `qtap://${store}/${path}`,
  }),
}))
jest.mock('@/lib/documents/core', () => ({ readDocument: (...a: unknown[]) => mockReadDocument(...a) }))
jest.mock('@/lib/tools/handlers/doc-edit/shared', () => ({
  getCharacterBlockedReadPaths: (...a: unknown[]) => mockBlocked(...a),
}))
jest.mock('@/lib/mount-index/reach', () => ({
  classifyMount: (...a: unknown[]) => mockClassify(...a),
  resolveOwnerStore: (...a: unknown[]) => mockOwnerStore(...a),
}))
jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  flattenTierPool: (pool: { ids: string[] }) => pool.ids,
}))

import { findDocuments, listDocuments } from '@/lib/research/documents'
import { resolveResearchScope, resolveStoreArg, type ResearchScope } from '@/lib/research/scope'
import { joinUnderCeiling, searchTerms } from '@/lib/research/text'

const VAULT = { id: 'mp-amy', name: 'Amy Character Vault', mountType: 'database' }
const LORE = { id: 'mp-lore', name: 'Estate Lore', mountType: 'database' }
const DISK = { id: 'mp-disk', name: 'Notes on Disk', mountType: 'filesystem' }
const EVERYTHING: ResearchScope = { kind: 'everything' }
const POOL: ResearchScope = { kind: 'pool', pool: { ids: ['mp-lore'] } as never }

function row(mountPointId: string, relativePath: string, text: string | null, extra: Record<string, unknown> = {}) {
  return {
    linkId: `${mountPointId}:${relativePath}`,
    mountPointId,
    relativePath,
    fileName: relativePath.split('/').pop(),
    fileId: `file:${relativePath}`,
    fileType: 'markdown',
    fileSizeBytes: 2048,
    lastModified: '2026-11-01T00:00:00.000Z',
    text,
    ...extra,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAccessible.mockImplementation(async (q: { operatorOverride?: boolean; mountPool?: { ids: string[] } }) =>
    q.operatorOverride ? [VAULT, LORE, DISK] : [VAULT, LORE, DISK].filter((s) => q.mountPool?.ids.includes(s.id)),
  )
  mockBlocked.mockResolvedValue(new Set())
  mockClassify.mockResolvedValue(null)
  mockScan.mockResolvedValue([])
})

describe('resolveResearchScope', () => {
  it('maps the operator surface to everything and a mount pool to the pool', () => {
    expect(resolveResearchScope({ userId: 'u', operatorSurface: true })).toEqual({ ok: true, scope: { kind: 'everything' } })
    expect(resolveResearchScope({ userId: 'u', mountPool: { ids: [] } as never })).toMatchObject({ ok: true, scope: { kind: 'pool' } })
  })

  it('refuses a context with neither, or with both', () => {
    expect(resolveResearchScope({ userId: 'u' }).ok).toBe(false)
    expect(resolveResearchScope({ userId: 'u', operatorSurface: true, mountPool: { ids: [] } as never }).ok).toBe(false)
  })
})

describe('resolveStoreArg', () => {
  it('resolves a store by name, case-insensitively', async () => {
    const result = await resolveStoreArg(EVERYTHING, 'estate lore', 'u')
    expect(result).toEqual({ ok: true, store: LORE })
  })

  it('resolves owner shorthand through resolveOwnerStore', async () => {
    mockOwnerStore.mockResolvedValue({ mountPointId: 'mp-amy' })
    const result = await resolveStoreArg(EVERYTHING, 'character: amy', 'u')
    expect(mockOwnerStore).toHaveBeenCalledWith('character', 'char-amy', mockRepos, 'u', expect.anything())
    expect(result).toEqual({ ok: true, store: VAULT })
  })

  it('treats a store outside the pool as not found and offers the nearest names in reach', async () => {
    const result = await resolveStoreArg(POOL, 'Amy Character Vault', 'u')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/^No store "Amy Character Vault" in reach\. Nearest: "Estate Lore"\./)
  })
})

describe('searchTerms', () => {
  it('keeps a quoted phrase as one term', () => {
    expect(searchTerms('"old harbour" lamp')).toEqual(['old harbour', 'lamp'])
  })
})

describe('find_documents', () => {
  it('folds case, diacritics and curly quotes, and requires every term', async () => {
    mockScan.mockResolvedValue([
      row('mp-lore', 'Places/Café.md', 'The CAFÉ on the quay.\nIt’s always open.'),
      row('mp-lore', 'Places/Inn.md', 'The cafe is closed.'),
    ])
    const result = await findDocuments(EVERYTHING, { text: "cafe it's" }, { userId: 'u' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.hits.map((h) => h.path)).toEqual(['Places/Café.md'])
    expect(result.text).toContain('qtap://Estate Lore/Places/Café.md')
    expect(result.text).toMatch(/L1: The CAFÉ on the quay\./)
  })

  it('lists a file linked into several stores once, with the others counted', async () => {
    mockScan.mockResolvedValue([
      row('mp-lore', 'Shared/Map.md', 'the lighthouse', { fileId: 'blob-1' }),
      row('mp-amy', 'Knowledge/Map.md', 'the lighthouse', { fileId: 'blob-1' }),
    ])
    const result = await findDocuments(EVERYTHING, { text: 'lighthouse' }, { userId: 'u' })
    expect(result.ok && result.data.hits).toHaveLength(1)
    expect(result.ok && result.text).toContain('also in 1 other store')
  })

  it('ranks by match count, then by recency', async () => {
    mockScan.mockResolvedValue([
      row('mp-lore', 'a.md', 'lamp', { lastModified: '2026-11-05T00:00:00.000Z' }),
      row('mp-lore', 'b.md', 'lamp lamp lamp'),
      row('mp-lore', 'c.md', 'lamp', { lastModified: '2026-11-09T00:00:00.000Z' }),
    ])
    const result = await findDocuments(EVERYTHING, { text: 'lamp' }, { userId: 'u' })
    expect(result.ok && result.data.hits.map((h) => h.path)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('reads a filesystem-backed file through the document core', async () => {
    mockScan.mockResolvedValue([row('mp-disk', 'journal.md', null)])
    mockReadDocument.mockResolvedValue({ content: 'The lighthouse keeper.' })
    const result = await findDocuments(EVERYTHING, { text: 'keeper' }, { userId: 'u' })
    expect(mockReadDocument).toHaveBeenCalledTimes(1)
    expect(result.ok && result.data.hits).toHaveLength(1)
  })

  it('says plainly that a miss is absent, with the nearest names, and not to retry', async () => {
    mockScan.mockResolvedValue([row('mp-lore', 'Places/Harbour.md', 'boats')])
    const result = await findDocuments(EVERYTHING, { name: 'harbor' }, { userId: 'u' })
    expect(result.ok && result.data.hits).toEqual([])
    expect(result.ok && result.text).toMatch(/^No file in 3 stores named like "harbor"\. Nearest by name: "Places\/Harbour\.md"\./)
    expect(result.ok && result.text).toContain('do not retry with small spelling changes')
  })

  it('stays inside the pool and honours character_read:false there', async () => {
    mockScan.mockResolvedValue([row('mp-lore', 'secret.md', 'lamp'), row('mp-lore', 'open.md', 'lamp')])
    mockBlocked.mockResolvedValue(new Set(['secret.md']))
    const result = await findDocuments(POOL, { text: 'lamp' }, { userId: 'u' })
    expect(mockScan).toHaveBeenCalledWith(['mp-lore'], expect.anything())
    expect(result.ok && result.data.hits.map((h) => h.path)).toEqual(['open.md'])
  })

  it('refuses a call with neither text nor name', async () => {
    expect(await findDocuments(EVERYTHING, {}, { userId: 'u' })).toEqual({ ok: false, error: expect.any(String) })
  })
})

describe('list_documents', () => {
  it('lists the stores in reach with owners and counts when no store is named', async () => {
    mockClassify.mockImplementation(async (id: string) => (id === 'mp-amy' ? { scope: 'character', ownerName: 'Amy' } : null))
    mockScan.mockResolvedValue([row('mp-amy', 'identity.md', null), row('mp-amy', 'manifesto.md', null)])
    const result = await listDocuments(EVERYTHING, {}, { userId: 'u' })
    expect(result.ok && result.text).toContain('- Amy Character Vault (character: Amy; 2 files, last modified 2026-11-01)')
    expect(result.ok && result.text).toContain('- Estate Lore (linked store; 0 files)')
  })

  it('collapses a large folder and a picture folder into one line each', async () => {
    const many = Array.from({ length: 30 }, (_, i) => row('mp-lore', `Letters/letter-${i}.md`, null))
    mockScan.mockResolvedValue([...many, row('mp-lore', 'images/a.webp', null), row('mp-lore', 'README.md', null)])
    const result = await listDocuments(EVERYTHING, { store: 'Estate Lore' }, { userId: 'u' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const lines = result.text.split('\n')
    expect(lines).toContain('Letters/ (30 files, newest 2026-11-01: "letter-0.md")')
    expect(lines).toContain('images/ (1 file, newest 2026-11-01: "a.webp")')
    expect(lines).toContain('README.md (2026-11-01)')
    expect(lines.some((l) => l.includes('letter-5.md'))).toBe(false)
  })

  it('expands a folder asked for by name', async () => {
    mockScan.mockResolvedValue([row('mp-lore', 'Places/Inn.md', null), row('mp-lore', 'People/Amy.md', null)])
    const result = await listDocuments(EVERYTHING, { store: 'Estate Lore', folder: 'places' }, { userId: 'u' })
    expect(result.ok && result.text).toContain('Inn.md')
    expect(result.ok && result.text).not.toContain('Amy.md')
  })

  it('offers the nearest folders when a folder holds nothing', async () => {
    mockScan.mockResolvedValue([row('mp-lore', 'Places/Inn.md', null)])
    const result = await listDocuments(EVERYTHING, { store: 'Estate Lore', folder: 'Place' }, { userId: 'u' })
    expect(result.ok && result.text).toBe('No files under Place/ in "Estate Lore". Nearest folders: "Places".')
  })
})

describe('joinUnderCeiling', () => {
  it('keeps records whole and says how many it left out', () => {
    const text = joinUnderCeiling('head', ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)], {
      ceiling: 100,
      omittedHint: (n) => `[${n} more]`,
    })
    expect(text.split('\n\n')).toEqual(['head', 'a'.repeat(40), 'b'.repeat(40), '[1 more]'])
  })
})
