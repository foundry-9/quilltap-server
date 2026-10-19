/**
 * @jest-environment node
 *
 * The title lint at the document-write layer: an `Inventory/` file edited
 * with ordinary document tools — no Inventory mutation called — is linted
 * from its prior state, refused on a shadowing title, rung on a leaving one,
 * and counted in the census line when nothing changes. A `Tools/` file edit
 * writes the census line and no verdict. The Inventory mutations' own writes
 * pass through unlinted.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/repositories/factory', () => require('@/__tests__/helpers/inventory-fake-store').factoryModule())
jest.mock('@/lib/mount-index/database-store', () => require('@/__tests__/helpers/inventory-fake-store').databaseStoreModule())
jest.mock('@/lib/mount-index/folder-paths', () => require('@/__tests__/helpers/inventory-fake-store').folderPathsModule())
jest.mock('@/lib/instance-settings', () => require('@/__tests__/helpers/inventory-fake-store').instanceSettingsModule())
jest.mock('@/lib/mount-index/tiered-mount-pool', () => require('@/__tests__/helpers/inventory-fake-store').tieredPoolModule())
jest.mock('@/lib/pascal/tool-gate-keys', () => require('@/__tests__/helpers/inventory-fake-store').toolGateKeysModule())
jest.mock('@/lib/mount-index/ensure-owner-store', () => ({ ensureOwnerOfficialStore: jest.fn() }))
jest.mock('@/lib/inventory/item-images', () => ({ cleanupInventoryItemImages: jest.fn(async () => undefined) }))

import { logger } from '@/lib/logger'
import { addCharacter, getFakeRepos, putDoc, putGateKey, resetStore } from '@/__tests__/helpers/inventory-fake-store'
import { lintInventoryDocumentChange } from '@/lib/inventory/title-lint-documents'
import { withInventoryWritesLinted, isTitleLintPath, isTitleLintFolder, isToolDefinitionPath } from '@/lib/inventory/lint-scope'
import { InventoryTitleCheckUnavailableError, InventoryTitleShadowError } from '@/lib/inventory/errors'

const VAULT = 'mp-c-friday'
const TAPE_ID = '33333333-3333-4333-8333-333333333333'
const TAPE = "Friday's Yellow Tape Measure"

const file = (fields: Record<string, unknown>) =>
  JSON.stringify({ id: TAPE_ID, kind: 'item', name: 'tape measure', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...fields }, null, 2)

const lintRows = () =>
  (logger.info as jest.Mock).mock.calls
    .filter(([message]) => String(message).startsWith('[InventoryTitleLint]') && !String(message).includes('rejected') && !String(message).includes('refused'))
    .map(([, meta]) => meta)
const censusLines = () =>
  (logger.debug as jest.Mock).mock.calls.filter(([message]) => message === '[InventoryTitleLint] Census').map(([, meta]) => meta)

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a refusal')
}

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
  addCharacter('c-friday', 'Friday')
  putGateKey('measure_twice', TAPE)
  putDoc(VAULT, 'Inventory/tape measure.json', file({ title: TAPE }))
})

describe('the path predicates', () => {
  it('claim Inventory JSON and root Tools definitions, and nothing else', () => {
    expect(isTitleLintPath('Inventory/tape measure.json')).toBe(true)
    expect(isTitleLintPath('inventory/Belt/tape.json')).toBe(true)
    expect(isTitleLintPath('Tools/measure_twice.tool.json')).toBe(true)
    expect(isTitleLintPath('Tools/archive/old.tool.json')).toBe(false)
    expect(isTitleLintPath('metadata.json')).toBe(false)
    expect(isToolDefinitionPath('Inventory/x.json')).toBe(false)
    expect(isTitleLintFolder('Inventory')).toBe(true)
    expect(isTitleLintFolder('Inventory Notes')).toBe(false)
  })
})

describe('a hand edit to an Inventory file (case 11)', () => {
  it('a rewrite into a shadowing title is refused before it lands', async () => {
    putDoc(VAULT, 'Inventory/ruler.json', JSON.stringify({ id: '44444444-4444-4444-8444-444444444444', kind: 'item', name: 'ruler', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }))
    const error = await refusalOf(
      lintInventoryDocumentChange({ kind: 'write', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json', content: file({ title: 'Ruler' }) }),
    )
    expect(error).toBeInstanceOf(InventoryTitleShadowError)
    expect(error.message).toContain('collides with KIND NAME "ruler" (reason: kind-name shadow)')
  })

  it('a rewrite away from a gate key rings gate dark once the write lands', async () => {
    const afterWrite = await lintInventoryDocumentChange({
      kind: 'write', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json', content: file({ title: 'Old Yellow' }),
    })
    expect(lintRows()).toEqual([])
    afterWrite()
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark', gateKey: TAPE, itemId: TAPE_ID, alert: true })])
  })

  it('a delete with the doc tools rings the bell; a move out of Inventory/ does too', async () => {
    ;(await lintInventoryDocumentChange({ kind: 'delete', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json' }))()
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark' })])
    jest.clearAllMocks()
    ;(await lintInventoryDocumentChange({ kind: 'move', mountPointId: VAULT, fromPath: 'Inventory/tape measure.json', toPath: 'Attic/tape measure.json' }))()
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark' })])
  })

  it('a description-only rewrite writes the census line and nothing else', async () => {
    const afterWrite = await lintInventoryDocumentChange({
      kind: 'write', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json', content: file({ title: TAPE, description: 'Sixteen feet.' }),
    })
    afterWrite()
    expect(lintRows()).toEqual([])
    expect(censusLines()).toEqual([expect.objectContaining({ door: 'document-write', entering: false, leaving: false, gateKeys: 1 })])
  })

  it('a prior state that cannot be read refuses a titled write, naming the file', async () => {
    getFakeRepos().docMountDocuments.findByMountPointAndPath.mockRejectedValueOnce(new Error('index unavailable'))
    const error = await refusalOf(
      lintInventoryDocumentChange({ kind: 'write', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json', content: file({ title: 'Old Yellow' }) }),
    )
    expect(error).toBeInstanceOf(InventoryTitleCheckUnavailableError)
    expect(error.message).toContain('could not read Inventory/tape measure.json in store "Friday" (its prior state could not be read: index unavailable)')
  })
})

describe('what the document layer leaves alone', () => {
  it('a tool file edited with document tools writes the census line and no verdict (case 12)', async () => {
    const afterWrite = await lintInventoryDocumentChange({
      kind: 'write', mountPointId: VAULT, relativePath: 'Tools/measure_twice.tool.json', content: '{}',
    })
    afterWrite()
    expect(lintRows()).toEqual([])
    expect(censusLines()).toEqual([expect.objectContaining({ door: 'document-write', gateKeys: 1, toolStores: ['Quilltap General'] })])
  })

  it("the Inventory mutations' own writes pass through: they lint for themselves", async () => {
    await withInventoryWritesLinted(async () => {
      await lintInventoryDocumentChange({ kind: 'delete', mountPointId: VAULT, relativePath: 'Inventory/tape measure.json' })
    })
    expect(censusLines()).toEqual([])
  })
})
