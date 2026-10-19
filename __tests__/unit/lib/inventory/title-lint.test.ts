/**
 * @jest-environment node
 *
 * The Inventory title lint over the in-memory store: a title may not shadow a
 * kind name or a live gate key, at create or at rename, and a lint that cannot
 * read its pools refuses rather than passes. A title that IS its gate's target
 * passes with one `gate key naming` row; a rename away from a gate key logs
 * `gate dark` or `gate redirected`, never refuses.
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
import {
  addCharacter,
  getFakeRepos,
  GENERAL_MP,
  putDoc,
  putGateKey,
  resetStore,
  state,
} from '@/__tests__/helpers/inventory-fake-store'
import { resolveInventoryLocation, type InventoryLocation } from '@/lib/inventory/location'
import { createInventoryItem, deleteInventoryItem, instantiate, setInventoryItemArchived, updateInventoryItem } from '@/lib/inventory/item-mutations'
import { loadInventoryPool } from '@/lib/inventory/pool'
import { InventoryTitleCheckUnavailableError, InventoryTitleShadowError } from '@/lib/inventory/errors'
import { normalizeTitle } from '@/lib/inventory/title-lint'
import { resolveInventoryRef } from '@/lib/inventory/refs'
import type { InventoryCreateBody, InventoryRecord } from '@/lib/schemas/inventory.types'

const TAPE = "Friday's Yellow Tape Measure"

const repos = () => getFakeRepos() as never
const body = (fields: Partial<InventoryCreateBody>): InventoryCreateBody =>
  ({ kind: 'item', equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false, parentId: null, itemIds: [], metadata: {}, ...fields }) as InventoryCreateBody
const loc = async (scope: 'project' | 'character', id: string) =>
  (await resolveInventoryLocation(scope, id, repos(), 'user-1')) as InventoryLocation

/** The rows the lint wrote (refusals excluded). */
function lintRows(): Array<Record<string, unknown>> {
  return (logger.info as jest.Mock).mock.calls
    .filter(([message]) => String(message).startsWith('[InventoryTitleLint]') && !String(message).includes('rejected'))
    .map(([, meta]) => meta)
}

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
})

describe('normalization', () => {
  it('keeps apostrophes and possessives, collapses whitespace, folds case and diacritics', () => {
    expect(normalizeTitle(TAPE)).toBe("friday's yellow tape measure")
    expect(normalizeTitle(`  Friday's   Yellow\tTape  Measure `)).toBe("friday's yellow tape measure")
    expect(normalizeTitle('Ansíble Résonator')).toBe('ansible resonator')
  })

  it('is never looser than the resolver: whatever it calls equal, this calls equal', () => {
    const resolverNorm = (v: string) => v.trim().toLowerCase()
    const samples = [TAPE, ` ${TAPE.toUpperCase()} `, 'Ansible Resonator', 'ansible resonator', 'ANSÍBLE resonator', 'É', 'é']
    for (const a of samples) {
      for (const b of samples) {
        if (resolverNorm(a) === resolverNorm(b)) expect(normalizeTitle(a)).toBe(normalizeTitle(b))
      }
    }
  })
})

describe('the crafted collision', () => {
  const MESSAGE_HEAD = [
    'title rejected: "Ansible Resonator"',
    'collides with KIND NAME "ansible resonator" (reason: kind-name shadow)',
    'and with a gate key on tool "lambda" (reason: live gate shadow)',
  ]
  const MESSAGE_TAIL = 'choose a title that is not a kind name and not a gate key.'

  async function seedResonator(): Promise<InventoryLocation> {
    const project = await loc('project', 'project-1')
    await createInventoryItem(repos(), project, body({ name: 'ansible resonator' }))
    putGateKey('lambda', 'ansible resonator')
    return project
  }

  function expectNamesBoth(error: Error): void {
    expect(error).toBeInstanceOf(InventoryTitleShadowError)
    const lines = error.message.split('\n')
    expect(lines.slice(0, 3)).toEqual(MESSAGE_HEAD)
    expect(lines[3]).toMatch(/^ {2}that gate's "ansible resonator" already lands on "ansible resonator/)
    expect(lines[4]).toBe(MESSAGE_TAIL)
  }

  it('is rejected on the create path, naming both collisions', async () => {
    const project = await seedResonator()
    const error = await refusalOf(createInventoryItem(repos(), project, body({ name: 'pocket ansible', title: 'Ansible Resonator' })))
    expectNamesBoth(error)
    expect((error as InventoryTitleShadowError).code).toBe('TITLE_SHADOW')
  })

  it('is rejected identically on the rename path', async () => {
    const project = await seedResonator()
    const created = await createInventoryItem(repos(), project, body({ name: 'pocket ansible', title: 'Brass Key' }))
    expectNamesBoth(await refusalOf(updateInventoryItem(repos(), project, created, { title: 'Ansible Resonator' })))
  })

  it('is rejected through diacritics and spacing too', async () => {
    const project = await seedResonator()
    const error = await refusalOf(createInventoryItem(repos(), project, body({ name: 'pocket ansible', title: 'Ansíble  Resonator' })))
    expect(error).toBeInstanceOf(InventoryTitleShadowError)
  })

  it('a kind name alone is a flat reject, the object’s own name included', async () => {
    const project = await loc('project', 'project-1')
    const error = await refusalOf(createInventoryItem(repos(), project, body({ name: 'lantern', title: 'Lantern' })))
    expect(error.message).toBe(
      'title rejected: "Lantern"\ncollides with KIND NAME "lantern" (reason: kind-name shadow)\nchoose a title that is not a kind name.',
    )
  })

  it('a name change under a standing title is the third door', async () => {
    const project = await loc('project', 'project-1')
    const lamp = await createInventoryItem(repos(), project, body({ name: 'lamp', title: 'Brass Lamp' }))
    const error = await refusalOf(updateInventoryItem(repos(), project, lamp, { name: 'brass lamp' }))
    expect(error.message).toContain('collides with KIND NAME "brass lamp" (reason: kind-name shadow)')
  })
})

describe('passes', () => {
  it('an ordinary rename passes silently, with no rows', async () => {
    const project = await loc('project', 'project-1')
    putGateKey('lambda', 'ansible resonator')
    const key = await createInventoryItem(repos(), project, body({ name: 'key', title: 'Brass Key' }))
    await updateInventoryItem(repos(), project, key, { title: 'Silver Key' })
    expect(lintRows()).toEqual([])
  })

  it('a no-op rename does not fail itself, even over a collision that predates the lint', async () => {
    const project = await loc('project', 'project-1')
    putDoc(state.projects[0].officialMountPointId!, 'Inventory/lantern.json', {
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'item',
      name: 'lantern',
      title: 'Lantern',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })
    const [lantern] = await project.readItems(true)
    await expect(updateInventoryItem(repos(), project, lantern, { title: 'Lantern', description: 'Smoky.' })).resolves.toBeTruthy()
  })

  it("Friday's tape measure: the title is its own gate's target, so it passes with one gate key naming row", async () => {
    const archetype = await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'tape measure', isArchetype: true }))
    putGateKey('measure_twice', TAPE)
    const friday = await loc('character', 'c-friday')
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record } = await instantiate(repos(), friday, archetype.id, { pool })

    await updateInventoryItem(repos(), friday, record, { title: TAPE }, { projectId: 'project-1' })

    expect(lintRows()).toEqual([
      expect.objectContaining({ reason: 'gate key naming', title: TAPE, tools: ['measure_twice'], itemId: record.id, alert: false }),
    ])
  })

  it('a gate key landing on two other objects is a shadow, not a naming', async () => {
    const project = await loc('project', 'project-1')
    await createInventoryItem(repos(), project, body({ name: 'compass', title: 'North Star' }))
    await createInventoryItem(repos(), project, body({ name: 'map', title: 'North Star' }))
    putGateKey('navigate', 'north star', { clause: 'withheldWhen', subject: 'inventoryCount' })
    const error = await refusalOf(createInventoryItem(repos(), project, body({ name: 'sextant', title: 'North Star' })))
    expect(error.message).toContain('collides with a gate key on tool "navigate" (reason: live gate shadow)')
  })
})

describe('the leaving direction', () => {
  async function fridayCarriesTape(): Promise<{ friday: InventoryLocation; record: InventoryRecord }> {
    const archetype = await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'tape measure', isArchetype: true }))
    putGateKey('measure_twice', TAPE)
    const friday = await loc('character', 'c-friday')
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record } = await instantiate(repos(), friday, archetype.id, { pool, overrides: { title: TAPE } })
    jest.clearAllMocks()
    return { friday, record }
  }

  it('renaming away logs gate dark when nothing else holds the key', async () => {
    const { friday, record } = await fridayCarriesTape()
    await updateInventoryItem(repos(), friday, record, { title: 'Old Yellow' }, { projectId: 'project-1' })
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark', gateKey: TAPE, tools: ['measure_twice'], alert: true })])
  })

  it('renaming away logs gate redirected, naming the stranger now holding the key', async () => {
    const { friday, record } = await fridayCarriesTape()
    // The project's pool cannot see Friday's vault, so this passes there as a naming.
    await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'ruler', title: TAPE }))
    jest.clearAllMocks()

    await updateInventoryItem(repos(), friday, record, { title: null }, { projectId: 'project-1' })

    const [row] = lintRows()
    expect(row).toMatchObject({ gateKey: TAPE, alert: true })
    expect(String(row.reason)).toMatch(/^gate redirected: Friday's Yellow Tape Measure/)
  })
})

describe('fail closed', () => {
  it('harness 1: a pool pointed at a store that does not exist refuses, naming it', async () => {
    state.groupMounts.set('c-friday', [{ group: { id: 'g-1', name: 'The Covenant' }, mountPointIds: ['mp-nowhere'] }])
    state.missingMounts.add('mp-nowhere')
    const error = await refusalOf(createInventoryItem(repos(), await loc('character', 'c-friday'), body({ name: 'key', title: 'Brass Key' })))
    expect(error).toBeInstanceOf(InventoryTitleCheckUnavailableError)
    expect((error as InventoryTitleCheckUnavailableError).code).toBe('TITLE_CHECK_UNAVAILABLE')
    expect(error.message.split('\n')).toEqual([
      'title rejected: "Brass Key"',
      'the title check could not read the inventory in store mp-nowhere (no such store; an empty read from it is not an answer)',
      'a title is not accepted unchecked; repair what could not be read, then try again.',
    ])
  })

  it('a tier whose read fails refuses, naming the store', async () => {
    const find = getFakeRepos().docMountDocuments.findManyByMountPointsInFolder
    const original = find.getMockImplementation()!
    find.mockImplementation(async (mps: string[], ...rest: unknown[]) => {
      if (mps.includes(GENERAL_MP)) throw new Error('disk on fire')
      return (original as (...args: unknown[]) => unknown)(mps, ...rest)
    })
    try {
      const error = await refusalOf(createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'key', title: 'Brass Key' })))
      expect(error.message).toContain(`could not read the inventory in store "${GENERAL_MP}" (disk on fire)`)
    } finally {
      find.mockImplementation(original)
    }
  })

  it('harness 2: a tool file listed but gone on open refuses, naming the file and store', async () => {
    state.gateKeysUnread.push({ mountName: 'Friday Character Vault', definitionPath: 'Tools/ghost.tool.json', reason: 'listed but not found on open' })
    const error = await refusalOf(createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'key', title: 'Brass Key' })))
    expect(error.message).toContain('could not read Tools/ghost.tool.json in store "Friday Character Vault" (listed but not found on open)')
  })

  it('an object with no title is not checked at all', async () => {
    state.gateKeysUnread.push({ mountName: 'X', definitionPath: 'Tools/', reason: 'listing failed' })
    await expect(createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'key' }))).resolves.toBeTruthy()
  })
})

describe('what the lint guards', () => {
  it('a title that shadows a name really does hide the name round', async () => {
    // The failure the lint exists for, shown against the resolver itself.
    const project = await loc('project', 'project-1')
    await createInventoryItem(repos(), project, body({ name: 'ansible resonator' }))
    putDoc(state.projects[0].officialMountPointId!, 'Inventory/decoy.json', {
      id: '22222222-2222-4222-8222-222222222222',
      kind: 'item',
      name: 'decoy',
      title: 'ansible resonator',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    })
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const hits = resolveInventoryRef('ansible resonator', { items: pool.resolved(), owns: pool.owns }, new Set())
    expect(hits.map((h) => h.item.name)).toEqual(['decoy'])
  })
})

describe('archive, delete and restore are title events too', () => {
  async function fridayCarriesTape(): Promise<{ friday: InventoryLocation; record: InventoryRecord }> {
    const archetype = await createInventoryItem(repos(), await loc('project', 'project-1'), body({ name: 'tape measure', isArchetype: true }))
    putGateKey('measure_twice', TAPE)
    const friday = await loc('character', 'c-friday')
    const pool = await loadInventoryPool(repos(), { characterId: 'c-friday', projectId: 'project-1' })
    const { record } = await instantiate(repos(), friday, archetype.id, { pool, overrides: { title: TAPE } })
    jest.clearAllMocks()
    return { friday, record }
  }

  it('archiving the titled object rings gate dark', async () => {
    const { friday, record } = await fridayCarriesTape()
    await setInventoryItemArchived(friday, record, true)
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark', gateKey: TAPE, alert: true })])
  })

  it('deleting the titled object rings gate dark', async () => {
    const { friday, record } = await fridayCarriesTape()
    await deleteInventoryItem(getFakeRepos() as never, friday, record)
    expect(lintRows()).toEqual([expect.objectContaining({ reason: 'gate dark', gateKey: TAPE, alert: true })])
  })

  it('restoring an archived object brings its title back through the lint', async () => {
    const project = await loc('project', 'project-1')
    const lamp = await createInventoryItem(repos(), project, body({ name: 'lamp', title: 'Brass Lamp' }))
    const { item: archived } = await setInventoryItemArchived(project, lamp, true)
    await createInventoryItem(repos(), project, body({ name: 'brass lamp' }))
    const error = await refusalOf(setInventoryItemArchived(project, archived!, false))
    expect(error.message).toContain('collides with KIND NAME "brass lamp"')
  })

  it('a leaving title over an unreadable mount rings gate unverifiable, naming the mount', async () => {
    const { friday, record } = await fridayCarriesTape()
    state.groupMounts.set('c-friday', [{ group: { id: 'g-1', name: 'The Covenant' }, mountPointIds: ['mp-nowhere'] }])
    state.missingMounts.add('mp-nowhere')
    // Archiving is never refused, however much is unreadable; it rings instead.
    await setInventoryItemArchived(friday, record, true)
    const [row] = lintRows()
    expect(row).toMatchObject({ gateKey: TAPE, alert: true })
    expect(String(row.reason)).toMatch(/^gate unverifiable: the inventory in store mp-nowhere/)
  })
})

describe('evidence: the census line', () => {
  const censusLines = () =>
    (logger.debug as jest.Mock).mock.calls.filter(([message]) => message === '[InventoryTitleLint] Census').map(([, meta]) => meta)

  it('a description-only edit writes the census line and nothing else', async () => {
    const project = await loc('project', 'project-1')
    putGateKey('lambda', 'ansible resonator')
    const key = await createInventoryItem(repos(), project, body({ name: 'key', title: 'Brass Key' }))
    jest.clearAllMocks()
    await updateInventoryItem(repos(), project, key, { description: 'Opens the cellar.' })
    expect(lintRows()).toEqual([])
    expect(censusLines()).toEqual([
      expect.objectContaining({ door: 'update', entering: false, leaving: false, gateKeys: 1, toolStores: ['Quilltap General'] }),
    ])
    expect(censusLines()[0].pools).toEqual(expect.arrayContaining([`store "${GENERAL_MP}"`]))
  })
})
