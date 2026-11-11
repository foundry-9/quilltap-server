import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { importGroups } from '@/lib/import/quilltap-import/import-entities'
import type { ImportOptions, IdMappingState } from '@/lib/import/quilltap-import/types'
import type { Group } from '@/lib/schemas/types'

/**
 * Focused tests for the import half of the groups export→import round-trip.
 * `importGroups` recreates the group rows (provisioning a fresh official store
 * via create()) and populates the id map; membership re-establishment and
 * additional-store relinking happen in the import orchestrator (execute.ts).
 */

function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g-old',
    name: 'Adventurers',
    description: 'A band of heroes',
    instructions: null,
    state: {},
    color: '#ff8800',
    icon: '🛡️',
    officialMountPointId: 'old-store',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-02T00:00:00.000Z',
    ...overrides,
  } as Group
}

function emptyIdMaps(): IdMappingState {
  return {
    writtenChats: new Set(),
    writtenRows: new Set(),
    tags: new Map(),
    characters: new Map(),
    chats: new Map(),
    connectionProfiles: new Map(),
    imageProfiles: new Map(),
    embeddingProfiles: new Map(),
    roleplayTemplates: new Map(),
    projects: new Map(),
    groups: new Map(),
    mountPoints: new Map(),
    docMountFileLinks: new Map(),
  } as unknown as IdMappingState
}

function makeOptions(conflictStrategy: ImportOptions['conflictStrategy']): ImportOptions {
  return { conflictStrategy, includeMemories: false, includeRelatedEntities: true }
}

describe('importGroups', () => {
  const findById = jest.fn()
  const create = jest.fn()
  const del = jest.fn()
  const update = jest.fn()
  // Only the `groups` repo is exercised by importGroups.
  const repos = { groups: { findById, create, delete: del, update } } as never

  beforeEach(() => {
    jest.clearAllMocks()
    create.mockImplementation(async (data: { name: string }) => ({ id: 'g-new', ...data }))
  })

  it('creates a new group, strips id/timestamps/officialMountPointId, and maps old→new id', async () => {
    findById.mockResolvedValue(null)
    const idMaps = emptyIdMaps()
    const warnings: string[] = []

    const counts = await importGroups('u1', [makeGroup()], makeOptions('skip'), idMaps, repos, warnings)

    expect(counts).toEqual({ imported: 1, skipped: 0 })
    expect(create).toHaveBeenCalledTimes(1)
    const payload = create.mock.calls[0][0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('id')
    expect(payload).not.toHaveProperty('createdAt')
    expect(payload).not.toHaveProperty('updatedAt')
    expect(payload).not.toHaveProperty('officialMountPointId')
    expect(payload).toMatchObject({ name: 'Adventurers', description: 'A band of heroes', color: '#ff8800' })
    expect(idMaps.groups.get('g-old')).toBe('g-new')
    expect(warnings).toHaveLength(0)
  })

  it('skip strategy: an existing group is skipped and maps to itself (no create)', async () => {
    findById.mockResolvedValue(makeGroup())
    const idMaps = emptyIdMaps()
    const counts = await importGroups('u1', [makeGroup()], makeOptions('skip'), idMaps, repos, [])

    expect(counts).toEqual({ imported: 0, skipped: 1 })
    expect(create).not.toHaveBeenCalled()
    expect(idMaps.groups.get('g-old')).toBe('g-old')
  })

  it('duplicate strategy: an existing group is recreated under a new id with a suffixed name', async () => {
    findById.mockResolvedValue(makeGroup())
    const idMaps = emptyIdMaps()
    const counts = await importGroups('u1', [makeGroup()], makeOptions('duplicate'), idMaps, repos, [])

    expect(counts).toEqual({ imported: 1, skipped: 0 })
    expect(create).toHaveBeenCalledTimes(1)
    expect((create.mock.calls[0][0] as { name: string }).name).toBe('Adventurers (imported)')
    expect(del).not.toHaveBeenCalled()
    // The id map names the row that was created, never an id no row has (#195).
    expect(idMaps.groups.get('g-old')).toBe('g-new')
  })

  it('overwrite strategy: the existing group is updated in place and keeps its id (#188)', async () => {
    findById.mockResolvedValue(makeGroup())
    const idMaps = emptyIdMaps()
    const counts = await importGroups('u1', [makeGroup({ description: 'Rewritten' })], makeOptions('overwrite'), idMaps, repos, [])

    expect(del).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('g-old', expect.objectContaining({ description: 'Rewritten' }))
    // The group's own store is kept.
    expect(update.mock.calls[0][1]).not.toHaveProperty('officialMountPointId')
    expect(idMaps.groups.get('g-old')).toBe('g-old')
    expect(counts).toEqual({ imported: 1, skipped: 0 })
  })

  it('records a warning (and does not throw) when create fails', async () => {
    findById.mockResolvedValue(null)
    create.mockRejectedValue(new Error('store provisioning failed'))
    const warnings: string[] = []

    const counts = await importGroups('u1', [makeGroup()], makeOptions('skip'), emptyIdMaps(), repos, warnings)

    expect(counts).toEqual({ imported: 0, skipped: 0 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Adventurers')
  })
})
