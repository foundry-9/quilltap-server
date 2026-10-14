/**
 * Bug 235 — one vector store manager per process.
 *
 * Next.js evaluated `lib/embedding/vector-store.ts` once per bundle (the
 * instrumentation bundle, where the job dispatcher's post-commit reload runs,
 * and each route bundle, where chat recall searches). A module-level
 * singleton gave every copy its own cache, so the dispatcher's reload dropped
 * its own copy while recall kept searching vectors from before a reindex.
 *
 * `jest.isolateModules` gives each require a fresh module registry — the same
 * shape as two bundles in one process — and the two copies must share one
 * manager and one cache.
 */

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn().mockReturnThis() },
}))

const mockFindIndexRows = jest.fn()
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () => ({
    memories: { findIndexRowsByCharacterId: (characterId: string) => mockFindIndexRows(characterId) },
  }),
}))

// Override the global mock from jest.setup.ts so the real module is loaded.
jest.mock('@/lib/embedding/vector-store', () => jest.requireActual('@/lib/embedding/vector-store'))

jest.mock('@/lib/embedding/embedding-service', () => ({
  cosineSimilarity: () => 1,
}))

type VectorStoreModule = typeof import('@/lib/embedding/vector-store')

function loadFreshCopy(): VectorStoreModule {
  let mod: VectorStoreModule | undefined
  jest.isolateModules(() => {
    mod = jest.requireActual('@/lib/embedding/vector-store') as VectorStoreModule
  })
  return mod!
}

const REGISTRY_KEY = Symbol.for('quilltap.processSingletons')

beforeEach(() => {
  jest.clearAllMocks()
  delete (globalThis as unknown as Record<symbol, unknown>)[REGISTRY_KEY]
  mockFindIndexRows.mockResolvedValue([
    { id: 'm1', embedding: new Float32Array([1, 0, 0]), tier: 'hot' },
  ])
})

describe('getVectorStoreManager across module copies (bug 235)', () => {
  it('returns the same manager from two separately evaluated copies', () => {
    const routeCopy = loadFreshCopy()
    const instrumentationCopy = loadFreshCopy()
    expect(routeCopy).not.toBe(instrumentationCopy)
    expect(routeCopy.getVectorStoreManager()).toBe(instrumentationCopy.getVectorStoreManager())
  })

  it('a reload through one copy drops the store the other copy searches', async () => {
    const routeCopy = loadFreshCopy()
    const instrumentationCopy = loadFreshCopy()

    const first = await routeCopy.getVectorStoreManager().getStore('char-1')
    expect(first.size).toBe(1)
    expect(mockFindIndexRows).toHaveBeenCalledTimes(1)

    // The dispatcher's post-commit reload, through its own copy.
    expect(instrumentationCopy.getVectorStoreManager().unloadStore('char-1')).toBe(true)

    mockFindIndexRows.mockResolvedValue([
      { id: 'm1', embedding: new Float32Array([1, 0, 0, 0]), tier: 'hot' },
      { id: 'm2', embedding: new Float32Array([0, 1, 0, 0]), tier: 'hot' },
    ])
    const reloaded = await routeCopy.getVectorStoreManager().getStore('char-1')
    expect(reloaded).not.toBe(first)
    expect(reloaded.size).toBe(2)
    expect(reloaded.getDimensions()).toBe(4)
    expect(mockFindIndexRows).toHaveBeenCalledTimes(2)
  })
})
