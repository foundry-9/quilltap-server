/**
 * @jest-environment node
 *
 * The gate-key census behind the Inventory title lint, through the real
 * discovery code: every literal inventory key in either gate clause, and an
 * honest account of what could not be read — a failed listing, a file listed
 * but gone on open (the catalogue-ghost shape), unreadable JSON — rather than
 * an empty answer that looks clean.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/mount-index/database-store', () => ({
  listDatabaseFiles: jest.fn(),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  },
}))
jest.mock('@/lib/mount-index/read-file', () => ({ readMountFileBytes: jest.fn() }))

import { getRepositories } from '@/lib/repositories/factory'
import { DatabaseStoreError, listDatabaseFiles } from '@/lib/mount-index/database-store'
import { readMountFileBytes } from '@/lib/mount-index/read-file'
import { collectToolGateKeys } from '@/lib/pascal/tool-gate-keys'

const mockGetRepositories = getRepositories as jest.Mock
const mockList = listDatabaseFiles as jest.Mock
const mockRead = readMountFileBytes as jest.Mock

const GONE = Symbol('gone')

/** Each store: path → definition object, raw string, or GONE (listed, missing on open). */
function prime(stores: Record<string, Record<string, unknown> | 'listing fails'>) {
  const mounts = Object.keys(stores).map((id) => ({ id, name: `store-${id}`, enabled: true, mountType: 'database', basePath: '' }))
  mockGetRepositories.mockReturnValue({
    docMountPoints: {
      findEnabled: jest.fn(async () => mounts),
      findById: jest.fn(async (id: string) => mounts.find((m) => m.id === id) ?? null),
    },
  })
  mockList.mockImplementation(async (id: string) => {
    const files = stores[id]
    if (files === 'listing fails') throw new Error('index unavailable')
    return Object.keys(files).map((relativePath) => ({ kind: 'file', relativePath }))
  })
  mockRead.mockImplementation(async (id: string, path: string) => {
    const content = (stores[id] as Record<string, unknown>)[path]
    if (content === GONE) throw new DatabaseStoreError('missing', 'NOT_FOUND')
    return { bytes: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) }
  })
}

const tool = (name: string, extra: Record<string, unknown>) => ({
  name,
  description: `The ${name} tool.`,
  outcomes: [{ when: true, message: 'done', state: 'info' }],
  ...extra,
})

beforeEach(() => jest.clearAllMocks())

describe('collectToolGateKeys', () => {
  it('collects every literal inventory key from both clauses and both subjects', async () => {
    prime({
      a: {
        'Tools/lambda.tool.json': tool('lambda', { availableWhen: { inventory: { 'ansible resonator': { eq: 'equipped' } } } }),
        'Tools/kappa.tool.json': tool('kappa', { withheldWhen: { inventoryCount: { lantern: { gte: 1 } } } }),
        'Tools/plain.tool.json': tool('plain', {}),
      },
    })
    const census = await collectToolGateKeys()
    expect(census.unread).toEqual([])
    expect(census.storesConsulted).toEqual(['store-a'])
    expect(census.keys.map((k) => [k.toolName, k.clause, k.subject, k.ref]).sort()).toEqual([
      ['kappa', 'withheldWhen', 'inventoryCount', 'lantern'],
      ['lambda', 'availableWhen', 'inventory', 'ansible resonator'],
    ])
  })

  it('reports a file listed but gone on open, instead of skipping it quietly', async () => {
    prime({ a: { 'Tools/inventory-tools-and-pascal.tool.json': GONE } })
    const census = await collectToolGateKeys()
    expect(census.keys).toEqual([])
    expect(census.unread).toEqual([
      { mountName: 'store-a', definitionPath: 'Tools/inventory-tools-and-pascal.tool.json', reason: 'listed but not found on open' },
    ])
  })

  it('reports a failed listing and an unparseable file; a schema-invalid file is not live and not unread', async () => {
    prime({
      a: 'listing fails',
      b: { 'Tools/broken.tool.json': '{ not json', 'Tools/invalid.tool.json': { name: 'invalid' } },
    })
    const census = await collectToolGateKeys()
    expect(census.unread.map((u) => [u.mountName, u.definitionPath])).toEqual([
      ['store-a', 'Tools/'],
      ['store-b', 'Tools/broken.tool.json'],
    ])
  })

  it('no enabled store at all is a failed look, not an empty house', async () => {
    prime({})
    const census = await collectToolGateKeys()
    expect(census.unread).toEqual([expect.objectContaining({ mountName: '(no enabled stores)' })])
  })
})

describe('any-of gates', () => {
  it('walks every group, and does not count aggregate keys', async () => {
    prime({
      a: {
        'Tools/tune.tool.json': {
          name: 'tune',
          description: 'Tune.',
          withheldWhen: [
            { inventory: { resonator: { eq: 'equipped' } } },
            { inventoryCount: { ring: { gte: 2 } }, inventoryAggregate: { 'equipped.names': { eq: 'lantern' } } },
          ],
          outcomes: [{ when: true, message: 'x', state: 'info' }],
        },
      },
    })
    const census = await collectToolGateKeys()
    expect(census.keys.map((k) => `${k.clause}:${k.subject}:${k.ref}`).sort()).toEqual([
      'withheldWhen:inventory:resonator',
      'withheldWhen:inventoryCount:ring',
    ])
  })
})
