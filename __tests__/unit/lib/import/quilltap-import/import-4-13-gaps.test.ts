/**
 * Import gaps found by the 4.13 import/restore audit (spec §4.2).
 *
 * - A groups-only bundle carries no characters and no stores, so its id maps
 *   are empty: membership and linked stores must resolve to the instance's
 *   own rows of those ids, and anything still unresolved is named.
 * - An NDJSON export that ends before its footer is truncated, and must be
 *   refused rather than imported as a success.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
}))

import { executeImport } from '@/lib/import/quilltap-import-service'
import { assembleExportFromStream } from '@/lib/import/quilltap-import-stream'
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'
import { createMockExportManifest } from '../../fixtures/test-factories'

function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop]
      if (!cache.has(prop)) cache.set(prop, jest.fn(async () => null))
      return cache.get(prop)
    },
  })
}

describe('groups-only bundle', () => {
  const LOCAL_CHARACTER = 'char-already-here'
  const LOCAL_STORE = 'store-already-here'
  let addMember: jest.Mock
  let link: jest.Mock

  beforeEach(() => {
    addMember = jest.fn(async () => undefined)
    link = jest.fn(async () => undefined)
    const userRepos = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => {
        if (prop === 'groups') return repoStub({ create: jest.fn(async (_d: unknown, o?: { id?: string }) => ({ id: o?.id ?? 'g-new' })) })
        if (prop === 'characters') return repoStub({ findById: jest.fn(async (id: string) => (id === LOCAL_CHARACTER ? { id } : null)) })
        if (prop === 'groupCharacterMembers') return repoStub({ addMember })
        if (prop === 'groupDocMountLinks') return repoStub({ link })
        return repoStub({ findAll: jest.fn(async () => []) })
      },
    })
    const globalRepos = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => {
        if (prop === 'docMountPoints') return repoStub({ findById: jest.fn(async (id: string) => (id === LOCAL_STORE ? { id } : null)), findAll: jest.fn(async () => []) })
        return repoStub({ findAll: jest.fn(async () => []) })
      },
    })
    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(globalRepos)
  })

  it('restores membership and linked stores against rows the instance already has, and names the rest', async () => {
    const result = await executeImport('u', {
      manifest: createMockExportManifest({ exportType: 'groups' }),
      data: {
        groups: [{
          id: 'g-source', name: 'Adventurers',
          _memberCharacterIds: [LOCAL_CHARACTER, 'char-nowhere'],
          _linkedStoreMountPointIds: [LOCAL_STORE, 'store-nowhere'],
        }],
      },
    } as never, { conflictStrategy: 'skip', includeMemories: false, includeRelatedEntities: true })

    expect(addMember).toHaveBeenCalledWith('g-new', LOCAL_CHARACTER)
    expect(link).toHaveBeenCalledWith('g-new', LOCAL_STORE)
    expect(addMember).toHaveBeenCalledTimes(1)
    expect(link).toHaveBeenCalledTimes(1)
    expect(result.warnings.some((w) => w.includes('Adventurers') && w.includes('1 member'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('Adventurers') && w.includes('1 linked store'))).toBe(true)
  })
})

describe('truncated NDJSON export', () => {
  async function* records(withFooter: boolean) {
    yield { kind: '__envelope__', format: 'qtap-ndjson', version: 1, manifest: createMockExportManifest({ exportType: 'tags' }) }
    yield { kind: 'tag', data: { id: 't1', name: 'One' } }
    if (withFooter) yield { kind: '__footer__', counts: { tags: 1 } }
  }

  it('refuses an export that ends before its footer', async () => {
    await expect(assembleExportFromStream(records(false))).rejects.toThrow(/footer|truncated/i)
  })

  it('accepts the same export with its footer', async () => {
    await expect(assembleExportFromStream(records(true))).resolves.toBeDefined()
  })
})
