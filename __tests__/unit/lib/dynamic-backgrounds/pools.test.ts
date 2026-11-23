/**
 * @jest-environment node
 *
 * loadCollagePool (lib/dynamic-backgrounds/pools.ts): which pictures each
 * page's collage may draw from (spec §3.1).
 */

jest.mock('@/lib/file-storage/lantern-store-bridge', () => ({
  getLanternBackgroundsStore: jest.fn(async () => ({ mountPointId: 'lantern-mp' })),
}))
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => {
    throw new Error('tests pass repos explicitly')
  }),
}))

import { CollageScopeNotFoundError, loadCollagePool } from '@/lib/dynamic-backgrounds/pools'

const USER = 'user-1'
const PROJECT = '11111111-1111-4111-8111-111111111111'
const CHARACTER = '22222222-2222-4222-8222-222222222222'

let n = 0
function row(over: Record<string, unknown> = {}) {
  n += 1
  return {
    id: `f${String(n).padStart(3, '0')}`,
    userId: USER,
    sha256: `${n}`.padStart(64, '0'),
    mimeType: 'image/webp',
    source: 'GENERATED',
    category: 'IMAGE',
    generationKey: null,
    generationModeration: 'moderated',
    folderPath: null,
    storageKey: null,
    projectId: null,
    linkedTo: [],
    tags: [],
    width: 1600,
    height: 900,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }
}

/** A project-less backdrop: Lantern mount, linked under generated/. */
const lanternBackdrop = (over: Record<string, unknown> = {}) =>
  row({ storageKey: `mount-blob:lantern-mp:blob-${n + 1}`, ...over })

function makeRepos(opts: {
  generated?: ReturnType<typeof row>[]
  lanternLinks?: Array<{ sha256: string; relativePath: string }>
  project?: Record<string, unknown> | null
  chats?: Array<Record<string, unknown>>
  linked?: ReturnType<typeof row>[]
  filed?: ReturnType<typeof row>[]
  character?: Record<string, unknown> | null
  tagged?: ReturnType<typeof row>[]
}) {
  return {
    files: {
      findGeneratedImages: jest.fn(async () => opts.generated ?? []),
      findByLinkedToAny: jest.fn(async (ids: readonly string[]) =>
        (opts.linked ?? []).filter((f) => (f.linkedTo as string[]).some((id) => ids.includes(id))),
      ),
      findByProjectId: jest.fn(async () => opts.filed ?? []),
      findByTag: jest.fn(async () => opts.tagged ?? []),
      findUncensoredBySha256s: jest.fn(async () => []),
    },
    docMountFileLinks: { findByMountPointId: jest.fn(async () => opts.lanternLinks ?? []) },
    projects: { findById: jest.fn(async () => (opts.project === undefined ? { id: PROJECT } : opts.project)) },
    chats: {
      findAll: jest.fn(async () => opts.chats ?? []),
      findByIds: jest.fn(async () => []),
    },
    characters: { findByIdRaw: jest.fn(async () => (opts.character === undefined ? { id: CHARACTER, archivedAt: null } : opts.character)) },
  } as never
}

const allow = { allowUncensored: true }
const ids = (pool: Array<{ fileId: string }>) => pool.map((p) => p.fileId).sort()

describe('loadCollagePool — home', () => {
  it('takes project and project-less backdrops, and no tool pictures', async () => {
    const projectBackdrop = row({ folderPath: '/story-backgrounds/', projectId: PROJECT })
    const lantern = lanternBackdrop()
    const tool = lanternBackdrop()
    const repos = makeRepos({
      generated: [projectBackdrop, lantern, tool],
      lanternLinks: [
        { sha256: lantern.sha256, relativePath: 'generated/scene.webp' },
        { sha256: tool.sha256, relativePath: 'tool/teapot.webp' },
      ],
    })
    const pool = await loadCollagePool({ scope: 'home', id: null, userId: USER }, allow, repos)
    expect(ids(pool)).toEqual([projectBackdrop.id, lantern.id].sort())
  })

  it('never takes avatar rolls or non-images, and dedupes by sha256', async () => {
    const a = row({ folderPath: '/story-backgrounds/' })
    const twin = row({ folderPath: '/story-backgrounds/', sha256: a.sha256 })
    const roll = row({ folderPath: '/story-backgrounds/', generationKey: 'k' })
    const pdf = row({ folderPath: '/story-backgrounds/', mimeType: 'application/pdf' })
    const repos = makeRepos({ generated: [a, twin, roll, pdf] })
    const pool = await loadCollagePool({ scope: 'home', id: null, userId: USER }, allow, repos)
    expect(ids(pool)).toEqual([a.id])
  })

  it('assumes 16:9 for a backdrop with no recorded size and sorts by fileId', async () => {
    const b = row({ folderPath: '/story-backgrounds/', width: null, height: null })
    const a = row({ folderPath: '/story-backgrounds/' })
    const pool = await loadCollagePool({ scope: 'home', id: null, userId: USER }, allow, makeRepos({ generated: [b, a] }))
    expect(pool.map((p) => p.fileId)).toEqual([b.id, a.id].sort())
    const sized = pool.find((p) => p.fileId === b.id)!
    expect(sized.width / sized.height).toBeCloseTo(16 / 9)
  })
})

describe('loadCollagePool — project', () => {
  it('takes backdrops filed under the project and those of chats moved into it', async () => {
    const filed = row({ folderPath: '/story-backgrounds/', projectId: PROJECT })
    const moved = lanternBackdrop({ linkedTo: ['chat-in'] })
    const elsewhere = lanternBackdrop({ linkedTo: ['chat-out'] })
    const repos = makeRepos({
      chats: [{ id: 'chat-in', projectId: PROJECT }, { id: 'chat-out', projectId: null }],
      filed: [filed],
      linked: [moved, elsewhere],
      lanternLinks: [
        { sha256: moved.sha256, relativePath: 'generated/a.webp' },
        { sha256: elsewhere.sha256, relativePath: 'generated/b.webp' },
      ],
    })
    const pool = await loadCollagePool({ scope: 'project', id: PROJECT, userId: USER }, allow, repos)
    expect(ids(pool)).toEqual([filed.id, moved.id].sort())
  })

  it('throws for an unknown project', async () => {
    await expect(
      loadCollagePool({ scope: 'project', id: PROJECT, userId: USER }, allow, makeRepos({ project: null })),
    ).rejects.toBeInstanceOf(CollageScopeNotFoundError)
  })
})

describe('loadCollagePool — character', () => {
  it('takes avatar rolls only', async () => {
    const roll = row({ generationKey: 'k1', tags: [CHARACTER], width: null, height: null })
    const notRoll = row({ tags: [CHARACTER] })
    const pool = await loadCollagePool(
      { scope: 'character', id: CHARACTER, userId: USER },
      allow,
      makeRepos({ tagged: [roll, notRoll] }),
    )
    expect(ids(pool)).toEqual([roll.id])
    expect(pool[0].width / pool[0].height).toBeCloseTo(2 / 3)
  })

  it('is empty for an archived character', async () => {
    const roll = row({ generationKey: 'k1', tags: [CHARACTER] })
    const pool = await loadCollagePool(
      { scope: 'character', id: CHARACTER, userId: USER },
      allow,
      makeRepos({ tagged: [roll], character: { id: CHARACTER, archivedAt: '2026-01-01T00:00:00.000Z' } }),
    )
    expect(pool).toEqual([])
  })
})
