/**
 * One insert policy for import and restore (refactor 4.13 spec 2).
 *
 * - #188: Overwrite keeps the existing row's id (updated in place, or
 *   recreated under the same id) — never a new id that strands every
 *   reference to the old one.
 * - #195: Duplicate maps the incoming id to the row that was created, never
 *   to an id no row receives.
 * - #193: a re-import that skips a chat does not insert the bundle's
 *   annotations, Document Mode state or informs again.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  },
}))

import { insertUnderPolicy, OutcomeTally } from '@/lib/backup/insert-policy'
import {
  importConnectionProfiles,
  importImageProfiles,
  importEmbeddingProfiles,
} from '@/lib/import/quilltap-import/import-profiles'
import { importTags, importRoleplayTemplates, importProjects } from '@/lib/import/quilltap-import/import-entities'
import { createIdMappingState, type ImportOptions } from '@/lib/import/quilltap-import/types'
import { executeImport } from '@/lib/import/quilltap-import-service'
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory'
import { createMockExportManifest } from '../../fixtures/test-factories'

function options(conflictStrategy: ImportOptions['conflictStrategy']): ImportOptions {
  return { conflictStrategy, includeMemories: false, includeRelatedEntities: true }
}

/** A repository whose rows live in a map; create honours `{ id }`. */
function memoryRepo<T extends { id: string }>(seed: T[] = []) {
  const rows = new Map(seed.map((row) => [row.id, row]))
  let counter = 0
  return {
    rows,
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    findAll: jest.fn(async () => [...rows.values()]),
    create: jest.fn(async (data: Record<string, unknown>, opts?: { id?: string }) => {
      const id = opts?.id ?? `created-${++counter}`
      const row = { ...data, id } as unknown as T
      rows.set(id, row)
      return row
    }),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = { ...(rows.get(id) as T), ...patch, id } as T
      rows.set(id, row)
      return row
    }),
    delete: jest.fn(async (id: string) => rows.delete(id)),
  }
}

describe('insertUnderPolicy', () => {
  const create = jest.fn(async (req: { id?: string }) => ({ id: req.id ?? 'fresh' }))

  beforeEach(() => jest.clearAllMocks())

  it('creates under the incoming id only when ids are preserved', async () => {
    const idMap = new Map<string, string>()
    expect(await insertUnderPolicy({ kind: 'thing', label: 'a', incomingId: 'in', strategy: 'skip', create, idMap }))
      .toEqual({ status: 'created', id: 'fresh' })
    expect(await insertUnderPolicy({ kind: 'thing', label: 'a', incomingId: 'in2', strategy: 'skip', preserveIds: true, create, idMap }))
      .toEqual({ status: 'created', id: 'in2' })
    expect(idMap).toEqual(new Map([['in', 'fresh'], ['in2', 'in2']]))
  })

  it('maps a duplicate to the created row', async () => {
    const idMap = new Map<string, string>()
    const outcome = await insertUnderPolicy({
      kind: 'thing', label: 'a', incomingId: 'in', strategy: 'duplicate',
      findExisting: async () => ({ id: 'in' }), create, idMap,
    })
    expect(outcome).toEqual({ status: 'created', id: 'fresh' })
    expect(idMap.get('in')).toBe('fresh')
    expect(create).toHaveBeenCalledWith({ id: undefined, duplicate: true })
  })

  it('overwrites in place when it can, else recreates under the same id', async () => {
    const update = jest.fn(async () => undefined)
    const inPlace = await insertUnderPolicy({
      kind: 'thing', label: 'a', incomingId: 'in', strategy: 'overwrite',
      findExisting: async () => ({ id: 'existing' }), create, update,
    })
    expect(inPlace).toEqual({ status: 'updated', id: 'existing' })
    expect(update).toHaveBeenCalledWith({ id: 'existing' })
    expect(create).not.toHaveBeenCalled()

    const order: string[] = []
    const recreated = await insertUnderPolicy({
      kind: 'thing', label: 'a', incomingId: 'in', strategy: 'overwrite',
      findExisting: async () => ({ id: 'existing' }),
      remove: async () => { order.push('remove') },
      create: async (req) => { order.push('create'); return { id: req.id ?? 'fresh' } },
    })
    expect(recreated).toEqual({ status: 'updated', id: 'existing' })
    expect(order).toEqual(['remove', 'create'])
  })

  it('treats a refused overwrite as a skip and says why', async () => {
    const warnings: string[] = []
    const outcome = await insertUnderPolicy({
      kind: 'roleplay template', label: 'Standard', incomingId: 'in', strategy: 'overwrite',
      findExisting: async () => ({ id: 'in' }), create,
      refuseOverwrite: () => 'it is a built-in template', warnings,
    })
    expect(outcome.status).toBe('skipped')
    expect(warnings[0]).toContain('built-in')
  })

  it('returns failed with a named warning instead of throwing', async () => {
    const warnings: string[] = []
    const tally = new OutcomeTally()
    tally.add(await insertUnderPolicy({
      kind: 'tag', label: 'Lost', incomingId: 'in', strategy: 'skip',
      create: async () => { throw new Error('disk full') }, warnings,
    }))
    expect(tally.failed).toBe(1)
    expect(tally.written).toBe(0)
    expect(warnings).toEqual(['Failed to import tag "Lost": disk full'])
  })
})

describe('#195 — Duplicate maps to the created row', () => {
  const profile = { id: 'p1', name: 'Workhorse', provider: 'OPENAI', modelName: 'm', tags: [], apiKeyId: 'k' }

  it.each([
    ['connection', importConnectionProfiles, 'connections', 'connectionProfiles'],
    ['image', importImageProfiles, 'imageProfiles', 'imageProfiles'],
    ['embedding', importEmbeddingProfiles, 'embeddingProfiles', 'embeddingProfiles'],
  ] as const)('%s profiles', async (_kind, importer, repoKey, mapKey) => {
    const repo = memoryRepo([{ ...profile }])
    const idMaps = createIdMappingState()
    await importer('u', [profile as never], options('duplicate'), idMaps, { [repoKey]: repo } as never, [])
    const mapped = idMaps[mapKey].get('p1')
    expect(mapped).toBeDefined()
    expect(mapped).not.toBe('p1')
    expect(repo.rows.has(mapped as string)).toBe(true)
  })

  it('roleplay templates and projects', async () => {
    const templates = memoryRepo([{ id: 't1', name: 'Mine', isBuiltIn: false }])
    const projects = memoryRepo([{ id: 'pr1', name: 'Saga' }])
    const idMaps = createIdMappingState()
    await importRoleplayTemplates('u', [{ id: 't1', name: 'Mine', systemPrompt: 's', tags: [] } as never], options('duplicate'), idMaps, { roleplayTemplates: templates } as never, [])
    await importProjects('u', [{ id: 'pr1', name: 'Saga' } as never], options('duplicate'), idMaps, { projects } as never, [])
    expect(templates.rows.has(idMaps.roleplayTemplates.get('t1') as string)).toBe(true)
    expect(idMaps.roleplayTemplates.get('t1')).not.toBe('t1')
    expect(projects.rows.has(idMaps.projects.get('pr1') as string)).toBe(true)
    expect(idMaps.projects.get('pr1')).not.toBe('pr1')
  })
})

describe('#188 — Overwrite keeps the existing id', () => {
  it('updates a connection profile in place and keeps its API key', async () => {
    const repo = memoryRepo([{ id: 'p1', name: 'Workhorse', provider: 'OPENAI', apiKeyId: 'key-1', tags: [] }])
    const idMaps = createIdMappingState()
    const counts = await importConnectionProfiles(
      'u',
      [{ id: 'p1', name: 'Workhorse', provider: 'OPENAI', modelName: 'new-model', apiKeyId: null, tags: [] } as never],
      options('overwrite'), idMaps, { connections: repo } as never, [],
    )
    expect(counts).toEqual({ imported: 1, skipped: 0 })
    expect(repo.delete).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update.mock.calls[0][1]).not.toHaveProperty('apiKeyId')
    expect(repo.rows.get('p1')).toMatchObject({ modelName: 'new-model', apiKeyId: 'key-1', name: 'Workhorse' })
    expect(idMaps.connectionProfiles.get('p1')).toBe('p1')
  })

  it('updates tags, templates and projects in place', async () => {
    const tags = memoryRepo([{ id: 'tg', name: 'Old' }])
    const templates = memoryRepo([{ id: 't1', name: 'Mine', isBuiltIn: false }])
    const projects = memoryRepo([{ id: 'pr1', name: 'Saga', officialMountPointId: 'store-1' }])
    const idMaps = createIdMappingState()
    await importTags('u', [{ id: 'tg', name: 'New' } as never], options('overwrite'), idMaps, { tags } as never, [])
    await importRoleplayTemplates('u', [{ id: 't1', name: 'Renamed', systemPrompt: 's', tags: [] } as never], options('overwrite'), idMaps, { roleplayTemplates: templates } as never, [])
    await importProjects('u', [{ id: 'pr1', name: 'Saga II', officialMountPointId: 'other' } as never], options('overwrite'), idMaps, { projects } as never, [])
    expect(tags.rows.get('tg')).toMatchObject({ name: 'New' })
    expect(templates.rows.get('t1')).toMatchObject({ name: 'Renamed' })
    expect(projects.rows.get('pr1')).toMatchObject({ name: 'Saga II', officialMountPointId: 'store-1' })
    for (const repo of [tags, templates, projects]) {
      expect(repo.delete).not.toHaveBeenCalled()
      expect(repo.create).not.toHaveBeenCalled()
    }
    expect([idMaps.tags.get('tg'), idMaps.roleplayTemplates.get('t1'), idMaps.projects.get('pr1')]).toEqual(['tg', 't1', 'pr1'])
  })

  it('never overwrites a built-in roleplay template', async () => {
    const templates = memoryRepo([{ id: 't1', name: 'Standard', isBuiltIn: true }])
    const idMaps = createIdMappingState()
    const counts = await importRoleplayTemplates('u', [{ id: 't1', name: 'Standard', systemPrompt: 's', tags: [] } as never], options('overwrite'), idMaps, { roleplayTemplates: templates } as never, [])
    expect(templates.update).not.toHaveBeenCalled()
    expect(counts).toEqual({ imported: 0, skipped: 1 })
    expect(idMaps.roleplayTemplates.get('t1')).toBe('t1')
  })
})

describe('#193 — a skipped chat does not take the bundle sidecars again', () => {
  const CHAT_ID = 'chat-already-here'
  let annotationsCreate: jest.Mock
  let chatDocumentsCreate: jest.Mock
  let informsCreate: jest.Mock

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

  beforeEach(() => {
    const existingChat = { id: CHAT_ID, title: 'Already here', participants: [{ id: 'seat-1' }] }
    const chats = repoStub({
      findById: jest.fn(async (id: string) => (id === CHAT_ID ? existingChat : null)),
      getMessages: jest.fn(async () => [{ id: 'm-1' }]),
    })
    const userRepos = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => (prop === 'chats' ? chats : repoStub({ findAll: jest.fn(async () => []) })),
    })
    annotationsCreate = jest.fn(async () => ({ id: 'a' }))
    chatDocumentsCreate = jest.fn(async () => ({ id: 'd' }))
    informsCreate = jest.fn(async () => ({ id: 'i' }))
    const globalRepos = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop: string) => {
        if (prop === 'conversationAnnotations') return repoStub({ create: annotationsCreate })
        if (prop === 'chatDocuments') return repoStub({ create: chatDocumentsCreate })
        if (prop === 'chatInforms') return repoStub({ create: informsCreate })
        return repoStub({ findAll: jest.fn(async () => []) })
      },
    })
    ;(getUserRepositories as jest.Mock).mockReturnValue(userRepos)
    ;(getRepositories as jest.Mock).mockReturnValue(globalRepos)
  })

  it('skips annotations, chat documents and informs of the skipped chat', async () => {
    const result = await executeImport('u', {
      manifest: createMockExportManifest({ exportType: 'chats' }),
      data: {
        chats: [{ id: CHAT_ID, title: 'Already here', participants: [{ id: 'seat-1' }], messages: [{ id: 'm-1' }] }],
        conversationAnnotations: [{ id: 'an-1', chatId: CHAT_ID, messageIndex: 0, characterName: 'A', content: 'x' }],
        chatDocuments: [{ id: 'cd-1', chatId: CHAT_ID, filePath: 'a.md', scope: 'project' }],
        chatInforms: [{ id: 'in-1', chatId: CHAT_ID, batchId: 'b', participantId: 'seat-1', contentMarkdown: 'x', recordMessageId: 'm-1' }],
      },
    } as never, options('skip'))

    expect(result.success).toBe(true)
    expect(result.skipped.chats).toBe(1)
    expect(annotationsCreate).not.toHaveBeenCalled()
    expect(chatDocumentsCreate).not.toHaveBeenCalled()
    expect(informsCreate).not.toHaveBeenCalled()
  })
})
