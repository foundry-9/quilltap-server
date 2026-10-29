/**
 * UUID Remapper Unit Tests
 *
 * Comprehensive tests for UUID remapping during backup restore operations.
 * Tests cover mapping consistency, array handling, field remapping, edge cases,
 * and state management.
 */

import { randomUUID } from 'crypto'
import { UuidRemapper } from '@/lib/backup/uuid-remapper'
import { planWardrobeImagePointerFixes, remapBackupData } from '@/lib/backup/restore/uuid-remap'
import type { BackupData } from '@/lib/backup/types'
import type { Project } from '@/lib/schemas/types'

jest.mock('crypto', () => ({
  // The wardrobe parser derives stable ids with createHash; only randomUUID
  // is under test control.
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    })),
  },
}))

const randomUUIDMock = randomUUID as jest.MockedFunction<typeof randomUUID>

describe('UuidRemapper', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
  })

  describe('remap()', () => {
    it('creates deterministic mappings per input value', () => {
      randomUUIDMock.mockReturnValueOnce('mapped-1').mockReturnValueOnce('mapped-2')

      const remapper = new UuidRemapper()

      expect(remapper.remap('old-1')).toBe('mapped-1')
      expect(remapper.remap('old-1')).toBe('mapped-1')
      expect(remapper.remap('old-2')).toBe('mapped-2')
      expect(remapper.getSize()).toBe(2)
    })

    it('returns the same new UUID for repeated calls with the same old UUID', () => {
      randomUUIDMock.mockReturnValueOnce('new-uuid-abc')

      const remapper = new UuidRemapper()
      const first = remapper.remap('old-uuid')
      const second = remapper.remap('old-uuid')
      const third = remapper.remap('old-uuid')

      expect(first).toBe('new-uuid-abc')
      expect(second).toBe('new-uuid-abc')
      expect(third).toBe('new-uuid-abc')
      expect(randomUUIDMock).toHaveBeenCalledTimes(1)
    })

    it('generates different UUIDs for different inputs', () => {
      randomUUIDMock
        .mockReturnValueOnce('uuid-1')
        .mockReturnValueOnce('uuid-2')
        .mockReturnValueOnce('uuid-3')

      const remapper = new UuidRemapper()
      const a = remapper.remap('a')
      const b = remapper.remap('b')
      const c = remapper.remap('c')

      expect(a).toBe('uuid-1')
      expect(b).toBe('uuid-2')
      expect(c).toBe('uuid-3')
      expect(new Set([a, b, c]).size).toBe(3)
    })

    it('handles empty string as a valid UUID', () => {
      randomUUIDMock.mockReturnValueOnce('empty-uuid')

      const remapper = new UuidRemapper()
      expect(remapper.remap('')).toBe('empty-uuid')
      expect(remapper.remap('')).toBe('empty-uuid')
    })

    it('handles UUIDs with special characters', () => {
      randomUUIDMock.mockReturnValueOnce('special-uuid')

      const remapper = new UuidRemapper()
      const specialId = 'abc-123-xyz_!@#$%'
      expect(remapper.remap(specialId)).toBe('special-uuid')
    })
  })

  describe('remapArray()', () => {
    it('remaps all UUIDs in an array maintaining order', () => {
      randomUUIDMock
        .mockReturnValueOnce('mapped-a')
        .mockReturnValueOnce('mapped-b')
        .mockReturnValueOnce('mapped-c')

      const remapper = new UuidRemapper()
      const result = remapper.remapArray(['a', 'b', 'c'])

      expect(result).toEqual(['mapped-a', 'mapped-b', 'mapped-c'])
    })

    it('handles empty arrays', () => {
      const remapper = new UuidRemapper()
      expect(remapper.remapArray([])).toEqual([])
    })

    it('gracefully handles non-array inputs by returning empty array', () => {
      const remapper = new UuidRemapper()

      expect(remapper.remapArray('not-an-array' as any)).toEqual([])
      expect(remapper.remapArray(null as any)).toEqual([])
      expect(remapper.remapArray(undefined as any)).toEqual([])
      expect(remapper.remapArray(123 as any)).toEqual([])
      expect(remapper.remapArray({ not: 'array' } as any)).toEqual([])
    })

    it('uses existing mappings for UUIDs seen before', () => {
      randomUUIDMock
        .mockReturnValueOnce('mapped-x')
        .mockReturnValueOnce('mapped-y')

      const remapper = new UuidRemapper()
      
      // First remap creates mappings
      remapper.remap('x')
      remapper.remap('y')
      
      // Array remap should reuse those mappings
      const result = remapper.remapArray(['x', 'y', 'x'])
      
      expect(result).toEqual(['mapped-x', 'mapped-y', 'mapped-x'])
      expect(randomUUIDMock).toHaveBeenCalledTimes(2) // Only called twice
    })

    it('handles arrays with duplicate UUIDs', () => {
      randomUUIDMock.mockReturnValueOnce('mapped-dup')

      const remapper = new UuidRemapper()
      const result = remapper.remapArray(['dup', 'dup', 'dup'])

      expect(result).toEqual(['mapped-dup', 'mapped-dup', 'mapped-dup'])
      expect(randomUUIDMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('remapFields()', () => {
    it('remaps selected string fields in shallow copies', () => {
      randomUUIDMock.mockReturnValueOnce('new-id').mockReturnValueOnce('new-image')
      const remapper = new UuidRemapper()

      const original = { id: 'old', defaultImageId: 'old-img', name: 'Original' }
      const remapped = remapper.remapFields(original, ['id', 'defaultImageId'])

      expect(remapped).toEqual({ id: 'new-id', defaultImageId: 'new-image', name: 'Original' })
      expect(original).toEqual({ id: 'old', defaultImageId: 'old-img', name: 'Original' })
    })

    it('does not modify the original object', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()

      const original = { id: 'old-id', data: 'test' }
      const remapped = remapper.remapFields(original, ['id'])

      expect(original.id).toBe('old-id')
      expect(remapped.id).toBe('new-id')
      expect(original).not.toBe(remapped)
    })

    it('ignores fields that do not exist in the object', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()

      const obj = { id: 'old-id', name: 'Test' }
      const remapped = remapper.remapFields(obj, ['id', 'nonexistent', 'alsoMissing'])

      expect(remapped).toEqual({ id: 'new-id', name: 'Test' })
    })

    it('ignores fields that are not strings', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()

      const obj = { id: 'old-id', count: 42, flag: true, arr: [1, 2, 3] }
      const remapped = remapper.remapFields(obj, ['id', 'count', 'flag', 'arr'])

      expect(remapped.id).toBe('new-id')
      expect(remapped.count).toBe(42)
      expect(remapped.flag).toBe(true)
      expect(remapped.arr).toEqual([1, 2, 3])
    })

    it('handles empty field list', () => {
      const remapper = new UuidRemapper()
      const obj = { id: 'old-id', name: 'Test' }
      const remapped = remapper.remapFields(obj, [])

      expect(remapped).toEqual(obj)
      expect(remapped).not.toBe(obj) // Still creates a shallow copy
    })

    it('gracefully handles non-object inputs', () => {
      const remapper = new UuidRemapper()

      expect(remapper.remapFields(null as any, ['id'])).toBe(null)
      expect(remapper.remapFields(undefined as any, ['id'])).toBe(undefined)
      expect(remapper.remapFields('string' as any, ['id'])).toBe('string')
      expect(remapper.remapFields(123 as any, ['id'])).toBe(123)
    })

    it('gracefully handles non-array field parameter', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()

      const obj = { id: 'old-id', name: 'Test' }
      const remapped = remapper.remapFields(obj, 'not-array' as any)

      expect(remapped).toEqual(obj)
      expect(randomUUIDMock).not.toHaveBeenCalled()
    })

    it('remaps null field values without error', () => {
      const remapper = new UuidRemapper()
      const obj = { id: null as any, name: 'Test' }
      const remapped = remapper.remapFields(obj, ['id'])

      expect(remapped.id).toBe(null)
      expect(randomUUIDMock).not.toHaveBeenCalled()
    })
  })

  describe('remapArrayFields()', () => {
    it('remaps array fields without touching unrelated properties', () => {
      randomUUIDMock.mockReturnValueOnce('tag-1').mockReturnValueOnce('tag-2')
      const remapper = new UuidRemapper()

      const data = { tags: ['t1', 't2'], other: ['keep'] }
      const remapped = remapper.remapArrayFields(data, ['tags'])

      expect(remapped.tags).toEqual(['tag-1', 'tag-2'])
      expect(remapped.other).toEqual(['keep'])
    })

    it('does not modify the original object', () => {
      randomUUIDMock.mockReturnValueOnce('new-1')
      const remapper = new UuidRemapper()

      const original = { ids: ['old-1'], data: 'test' }
      const remapped = remapper.remapArrayFields(original, ['ids'])

      expect(original.ids).toEqual(['old-1'])
      expect(remapped.ids).toEqual(['new-1'])
    })

    it('handles multiple array fields', () => {
      randomUUIDMock
        .mockReturnValueOnce('tag-1')
        .mockReturnValueOnce('tag-2')
        .mockReturnValueOnce('char-1')
      
      const remapper = new UuidRemapper()
      const obj = { tags: ['t1', 't2'], characterIds: ['c1'], name: 'Test' }
      const remapped = remapper.remapArrayFields(obj, ['tags', 'characterIds'])

      expect(remapped.tags).toEqual(['tag-1', 'tag-2'])
      expect(remapped.characterIds).toEqual(['char-1'])
      expect(remapped.name).toBe('Test')
    })

    it('ignores fields that are not arrays', () => {
      const remapper = new UuidRemapper()
      const obj = { tags: ['t1'], notArray: 'string', alsoNotArray: 42 }
      
      randomUUIDMock.mockReturnValueOnce('tag-1')
      const remapped = remapper.remapArrayFields(obj, ['tags', 'notArray', 'alsoNotArray'])

      expect(remapped.tags).toEqual(['tag-1'])
      expect(remapped.notArray).toBe('string')
      expect(remapped.alsoNotArray).toBe(42)
    })

    it('ignores fields that do not exist', () => {
      randomUUIDMock.mockReturnValueOnce('tag-1')
      const remapper = new UuidRemapper()

      const obj = { tags: ['t1'] }
      const remapped = remapper.remapArrayFields(obj, ['tags', 'nonexistent'])

      expect(remapped).toEqual({ tags: ['tag-1'] })
    })

    it('handles empty array fields', () => {
      const remapper = new UuidRemapper()
      const obj = { tags: [], ids: [] }
      const remapped = remapper.remapArrayFields(obj, ['tags', 'ids'])

      expect(remapped.tags).toEqual([])
      expect(remapped.ids).toEqual([])
    })

    it('gracefully handles non-object inputs', () => {
      const remapper = new UuidRemapper()

      expect(remapper.remapArrayFields(null as any, ['tags'])).toBe(null)
      expect(remapper.remapArrayFields(undefined as any, ['tags'])).toBe(undefined)
      expect(remapper.remapArrayFields('string' as any, ['tags'])).toBe('string')
    })

    it('gracefully handles non-array field parameter', () => {
      const remapper = new UuidRemapper()
      const obj = { tags: ['t1'] }
      const remapped = remapper.remapArrayFields(obj, 'not-array' as any)

      expect(remapped).toEqual(obj)
    })
  })

  describe('getMapping()', () => {
    it('exposes internal mapping state', () => {
      randomUUIDMock.mockReturnValueOnce('mapped-id')
      const remapper = new UuidRemapper()

      remapper.remap('old-id')
      expect(remapper.getMapping()).toEqual({ 'old-id': 'mapped-id' })
    })

    it('returns empty object when no mappings exist', () => {
      const remapper = new UuidRemapper()
      expect(remapper.getMapping()).toEqual({})
    })

    it('returns all mappings', () => {
      randomUUIDMock
        .mockReturnValueOnce('new-1')
        .mockReturnValueOnce('new-2')
        .mockReturnValueOnce('new-3')

      const remapper = new UuidRemapper()
      remapper.remap('old-1')
      remapper.remap('old-2')
      remapper.remap('old-3')

      const mapping = remapper.getMapping()
      expect(mapping).toEqual({
        'old-1': 'new-1',
        'old-2': 'new-2',
        'old-3': 'new-3',
      })
    })

    it('returns a plain object not a Map', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()
      remapper.remap('old-id')

      const mapping = remapper.getMapping()
      expect(mapping).toBeInstanceOf(Object)
      expect(mapping).not.toBeInstanceOf(Map)
    })
  })

  describe('clear()', () => {
    it('clears internal mapping state', () => {
      randomUUIDMock.mockReturnValueOnce('mapped-id')
      const remapper = new UuidRemapper()

      remapper.remap('old-id')
      expect(remapper.getMapping()).toEqual({ 'old-id': 'mapped-id' })

      remapper.clear()

      expect(remapper.getSize()).toBe(0)
      expect(remapper.getMapping()).toEqual({})
    })

    it('allows reuse after clearing', () => {
      randomUUIDMock
        .mockReturnValueOnce('first-uuid')
        .mockReturnValueOnce('second-uuid')

      const remapper = new UuidRemapper()
      
      remapper.remap('id')
      expect(remapper.getMapping()).toEqual({ id: 'first-uuid' })

      remapper.clear()
      
      remapper.remap('id')
      expect(remapper.getMapping()).toEqual({ id: 'second-uuid' })
    })

    it('handles clearing an already empty mapping', () => {
      const remapper = new UuidRemapper()
      expect(remapper.getSize()).toBe(0)
      
      remapper.clear()
      
      expect(remapper.getSize()).toBe(0)
    })
  })

  describe('getSize()', () => {
    it('returns the number of mapped UUIDs', () => {
      randomUUIDMock
        .mockReturnValueOnce('new-1')
        .mockReturnValueOnce('new-2')

      const remapper = new UuidRemapper()
      expect(remapper.getSize()).toBe(0)

      remapper.remap('old-1')
      expect(remapper.getSize()).toBe(1)

      remapper.remap('old-2')
      expect(remapper.getSize()).toBe(2)

      remapper.remap('old-1') // Duplicate doesn't increase size
      expect(remapper.getSize()).toBe(2)
    })

    it('returns 0 for new remapper', () => {
      const remapper = new UuidRemapper()
      expect(remapper.getSize()).toBe(0)
    })

    it('returns 0 after clear', () => {
      randomUUIDMock.mockReturnValueOnce('new-id')
      const remapper = new UuidRemapper()
      
      remapper.remap('old-id')
      expect(remapper.getSize()).toBe(1)
      
      remapper.clear()
      expect(remapper.getSize()).toBe(0)
    })
  })

})

describe('remapBackupData() - project FK remapping', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  // Minimal BackupData with all required arrays empty; callers override only
  // the slices a test exercises. remapBackupData does no Zod validation, so
  // partial fixtures cast through `unknown` are sufficient.
  const emptyBackup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
  })

  it("remaps a Log line's chat and character with the rows they name, keeping a null character", () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      characters: [{ id: 'char-old', name: 'Friday' }] as unknown as BackupData['characters'],
      chats: [{ id: 'chat-old', participants: [], messages: [], tags: [] }] as unknown as BackupData['chats'],
      logEntries: [
        { id: 'entry-1', message: 'Wrote it down.', chatId: 'chat-old', characterId: 'char-old', createdAt: 'a', updatedAt: 'a' },
        { id: 'entry-2', message: 'The operator, unseated.', chatId: 'chat-old', characterId: null, createdAt: 'b', updatedAt: 'b' },
      ],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const [seated, unseated] = result.logEntries ?? []

    expect(seated.id).not.toBe('entry-1')
    expect(seated.chatId).toBe(result.chats[0].id)
    expect(seated.characterId).toBe(result.characters[0].id)
    expect(seated.message).toBe('Wrote it down.')
    expect(unseated.chatId).toBe(result.chats[0].id)
    expect(unseated.characterId).toBeNull()
  })

  it('remaps every store pointer in lockstep with the store row it names (bug 185)', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      characters: [{ id: 'char-old', name: 'Friday', characterDocumentMountPointId: 'vault-old' }] as unknown as BackupData['characters'],
      projects: [{ id: 'proj-old', officialMountPointId: 'pstore-old' }] as unknown as Project[],
      groups: [{ id: 'group-old', officialMountPointId: 'gstore-old' }] as unknown as BackupData['groups'],
      docMountPoints: [{ id: 'vault-old' }, { id: 'pstore-old' }, { id: 'gstore-old' }] as unknown as BackupData['docMountPoints'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const [vault, projectStore, groupStore] = (result.docMountPoints ?? []).map((mp) => mp.id)

    expect(vault).not.toBe('vault-old')
    expect(result.characters[0].characterDocumentMountPointId).toBe(vault)
    expect(result.projects[0].officialMountPointId).toBe(projectStore)
    expect(result.groups?.[0].officialMountPointId).toBe(groupStore)
  })

  it("re-points a chat's scenario source at its store's new id", () => {
    const remapper = new UuidRemapper()
    const storeId = '11111111-1111-4111-8111-111111111111'
    const data: BackupData = {
      ...emptyBackup(),
      projects: [{ id: 'proj-old', officialMountPointId: storeId }] as unknown as Project[],
      docMountPoints: [{ id: storeId }] as unknown as BackupData['docMountPoints'],
      chats: [
        {
          id: 'chat-old',
          participants: [],
          messages: [],
          scenarioSource: { mountPointId: storeId, path: 'Scenarios/tea.md', bodySha256: 'a'.repeat(64) },
          scenarioNotes: 'Rain.',
        },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.chats[0].scenarioSource).toEqual({
      mountPointId: result.docMountPoints?.[0].id,
      path: 'Scenarios/tea.md',
      bodySha256: 'a'.repeat(64),
    })
    expect(result.chats[0].scenarioSource?.mountPointId).not.toBe(storeId)
    expect(result.chats[0].scenarioNotes).toBe('Rain.')
  })

  it('re-points the turn rotation, turn queue and whisper audiences at the renamed seats', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      chats: [
        {
          id: 'chat-old',
          participants: [{ id: 'seat-a' }, { id: 'seat-b' }],
          turnQueue: JSON.stringify(['seat-b']),
          spokenThisCycleParticipantIds: JSON.stringify(['seat-a']),
          cycleOrderParticipantIds: JSON.stringify(['seat-b', 'seat-a']),
          messages: [{ id: 'msg-old', participantId: 'seat-a', targetParticipantIds: ['seat-b'] }],
        },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const chat = result.chats[0] as unknown as Record<string, string>
    const [seatA, seatB] = result.chats[0].participants.map((p) => p.id)

    expect(seatA).not.toBe('seat-a')
    expect(JSON.parse(chat.turnQueue)).toEqual([seatB])
    expect(JSON.parse(chat.spokenThisCycleParticipantIds)).toEqual([seatA])
    expect(JSON.parse(chat.cycleOrderParticipantIds)).toEqual([seatB, seatA])
    expect(result.chats[0].messages[0].targetParticipantIds).toEqual([seatB])
  })

  it('leaves a malformed or absent turn-rotation value as it found it', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      chats: [
        { id: 'chat-old', participants: [], messages: [], cycleOrderParticipantIds: 'not json' },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const chat = result.chats[0] as unknown as Record<string, unknown>

    expect(chat.cycleOrderParticipantIds).toBe('not json')
    expect(chat).not.toHaveProperty('turnQueue')
  })

  it('remaps project.defaultImageProfileId to the same new id as its image profile', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      imageProfiles: [{ id: 'img-old' }] as unknown as BackupData['imageProfiles'],
      projects: [{ id: 'proj-old', defaultImageProfileId: 'img-old' }] as unknown as Project[],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    const newImageProfileId = remapper.getMapping()['img-old']
    expect(newImageProfileId).toBeDefined()
    expect(result.imageProfiles[0].id).toBe(newImageProfileId)
    // The bug being guarded: a dangling defaultImageProfileId on import.
    // It must follow the image profile it references, not survive verbatim.
    expect(result.projects[0].defaultImageProfileId).toBe(newImageProfileId)
    expect(result.projects[0].defaultImageProfileId).not.toBe('img-old')
    expect(result.projects[0].id).toBe(remapper.getMapping()['proj-old'])
  })

  it('also remaps project.defaultRoleplayTemplateId (sibling FK in the same field list)', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      roleplayTemplates: [{ id: 'tmpl-old' }] as unknown as BackupData['roleplayTemplates'],
      projects: [{ id: 'proj-old', defaultRoleplayTemplateId: 'tmpl-old' }] as unknown as Project[],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    const newTemplateId = remapper.getMapping()['tmpl-old']
    expect(newTemplateId).toBeDefined()
    expect(result.projects[0].defaultRoleplayTemplateId).toBe(newTemplateId)
  })

  it('leaves a null defaultImageProfileId untouched', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      projects: [{ id: 'proj-old', defaultImageProfileId: null }] as unknown as Project[],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.projects[0].defaultImageProfileId).toBeNull()
  })

  it('remaps connectionProfile.fallbackProfileId to the same new id as its understudy', () => {
    // The understudy is a row in the *same* table, so remapping `id` without
    // remapping `fallbackProfileId` would leave every restored chain pointing
    // at a uuid the new account does not have.
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      connectionProfiles: [
        { id: 'prof-a', fallbackProfileId: 'prof-b' },
        { id: 'prof-b', fallbackProfileId: null },
      ] as unknown as BackupData['connectionProfiles'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    const newB = remapper.getMapping()['prof-b']
    expect(newB).toBeDefined()
    expect(result.connectionProfiles[1].id).toBe(newB)
    expect(result.connectionProfiles[0].fallbackProfileId).toBe(newB)
    expect(result.connectionProfiles[0].fallbackProfileId).not.toBe('prof-b')
  })

  it('remaps a forward reference — the understudy appearing later in the array', () => {
    // The remapper is lazy and consistent, so the order profiles appear in the
    // archive must not matter.
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      connectionProfiles: [
        { id: 'prof-a', fallbackProfileId: 'prof-z' },
        { id: 'prof-z', fallbackProfileId: null },
      ] as unknown as BackupData['connectionProfiles'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.connectionProfiles[0].fallbackProfileId).toBe(result.connectionProfiles[1].id)
  })

  it('leaves a null fallbackProfileId untouched', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      connectionProfiles: [
        { id: 'prof-a', fallbackProfileId: null },
      ] as unknown as BackupData['connectionProfiles'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.connectionProfiles[0].fallbackProfileId).toBeNull()
  })
})

describe('remapBackupData() - group FK remapping', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  const emptyBackup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
  })

  it('remaps group membership so groupId/characterId follow the rows they reference', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      characters: [{ id: 'char-old' }] as unknown as BackupData['characters'],
      groups: [{ id: 'group-old', name: 'The Conspirators' }] as unknown as BackupData['groups'],
      groupCharacterMembers: [
        { id: 'member-old', groupId: 'group-old', characterId: 'char-old' },
      ] as unknown as BackupData['groupCharacterMembers'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    const newGroupId = remapper.getMapping()['group-old']
    const newCharacterId = remapper.getMapping()['char-old']
    expect(newGroupId).toBeDefined()
    expect(newCharacterId).toBeDefined()
    // The whole point of the fix: membership must point at the remapped group
    // and character, not survive with stale ids that reference nothing.
    expect(result.groups?.[0].id).toBe(newGroupId)
    expect(result.characters[0].id).toBe(newCharacterId)
    expect(result.groupCharacterMembers?.[0].groupId).toBe(newGroupId)
    expect(result.groupCharacterMembers?.[0].characterId).toBe(newCharacterId)
    expect(result.groupCharacterMembers?.[0].id).toBe(remapper.getMapping()['member-old'])
  })

  it('remaps a group↔store link so groupId/mountPointId stay consistent', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      groups: [{ id: 'group-old', name: 'The Conspirators' }] as unknown as BackupData['groups'],
      docMountPoints: [{ id: 'mount-old' }] as unknown as BackupData['docMountPoints'],
      groupDocMountLinks: [
        { id: 'link-old', groupId: 'group-old', mountPointId: 'mount-old' },
      ] as unknown as BackupData['groupDocMountLinks'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    const newGroupId = remapper.getMapping()['group-old']
    const newMountId = remapper.getMapping()['mount-old']
    expect(result.docMountPoints?.[0].id).toBe(newMountId)
    expect(result.groupDocMountLinks?.[0].groupId).toBe(newGroupId)
    expect(result.groupDocMountLinks?.[0].mountPointId).toBe(newMountId)
    expect(result.groupDocMountLinks?.[0].groupId).not.toBe('group-old')
  })
})

describe('remapBackupData() - wardrobe wear ledger', () => {
  // Real UUID-shaped ids: the wardrobe parser only honours a frontmatter id of
  // that shape. The remapper itself is mocked to mint `remapped-N`.
  const FRONTMATTER_ITEM = '11111111-1111-4111-8111-111111111111'
  const OLD_MOUNT = '22222222-2222-4222-8222-222222222222'

  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  const emptyBackup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
  })

  function ledgerRow(itemId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: 'row-old',
      itemId,
      wearerCharacterId: 'char-old',
      wearCount: 4,
      firstWornAt: '2026-01-01T00:00:00.000Z',
      lastWornAt: '2026-02-01T00:00:00.000Z',
      lastWornChatId: 'chat-old',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('keeps a frontmatter item id (document content is not rewritten) and remaps the FKs', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      characters: [{ id: 'char-old' }] as unknown as BackupData['characters'],
      docMountFileLinks: [
        { id: 'link-1', fileId: 'file-1', mountPointId: OLD_MOUNT, relativePath: 'Wardrobe/Coat.md' },
      ] as unknown as BackupData['docMountFileLinks'],
      docMountDocuments: [
        { id: 'doc-1', fileId: 'file-1', content: `---\nid: ${FRONTMATTER_ITEM}\ntitle: Coat\ntypes: [top]\n---\n` },
      ] as unknown as BackupData['docMountDocuments'],
      wardrobeWear: [ledgerRow(FRONTMATTER_ITEM)] as unknown as BackupData['wardrobeWear'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const mapping = remapper.getMapping()
    const row = result.wardrobeWear![0]

    expect(row.itemId).toBe(FRONTMATTER_ITEM)
    expect(row.id).toBe(mapping['row-old'])
    expect(row.wearerCharacterId).toBe(mapping['char-old'])
    expect(row.wearerCharacterId).toBe(result.characters[0].id)
    expect(row.lastWornChatId).toBe(mapping['chat-old'])
    expect(row.wearCount).toBe(4)
  })

  it('recomputes a path-derived item id against the remapped mount point', () => {
    const remapper = new UuidRemapper()
    const content = '---\ntitle: Hat\ntypes: [accessories]\n---\n'
    const { wardrobeItemIdForDocument } = jest.requireActual(
      '@/lib/database/repositories/vault-overlay/parsers'
    ) as typeof import('@/lib/database/repositories/vault-overlay/parsers')
    const oldItemId = wardrobeItemIdForDocument({ mountPointId: OLD_MOUNT, relativePath: 'Wardrobe/Hat.md', content })
    const data: BackupData = {
      ...emptyBackup(),
      docMountPoints: [{ id: OLD_MOUNT }] as unknown as BackupData['docMountPoints'],
      docMountFileLinks: [
        { id: 'link-1', fileId: 'file-1', mountPointId: OLD_MOUNT, relativePath: 'Wardrobe/Hat.md' },
      ] as unknown as BackupData['docMountFileLinks'],
      docMountDocuments: [{ id: 'doc-1', fileId: 'file-1', content }] as unknown as BackupData['docMountDocuments'],
      wardrobeWear: [ledgerRow(oldItemId, { wearerCharacterId: null, lastWornChatId: null })] as unknown as BackupData['wardrobeWear'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const newMountId = result.docMountPoints![0].id
    const expected = wardrobeItemIdForDocument({ mountPointId: newMountId, relativePath: 'Wardrobe/Hat.md', content })

    expect(result.wardrobeWear![0].itemId).toBe(expected)
    expect(result.wardrobeWear![0].itemId).not.toBe(oldItemId)
    expect(result.wardrobeWear![0].wearerCharacterId).toBeNull()
    expect(result.wardrobeWear![0].lastWornChatId).toBeNull()
  })

  it('follows a legacy wardrobe_items row through the remapper', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      wardrobeItems: [{ id: 'legacy-item', characterId: 'char-old', componentItemIds: [] }] as unknown as BackupData['wardrobeItems'],
      wardrobeWear: [ledgerRow('legacy-item')] as unknown as BackupData['wardrobeWear'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.wardrobeWear![0].itemId).toBe(result.wardrobeItems![0].id)
    expect(result.wardrobeWear![0].itemId).not.toBe('legacy-item')
  })
})

describe('wardrobe item pictures in a new-account restore', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  const ITEM_ID = '11111111-1111-4111-8111-111111111111'

  // A vault holding one garment whose frontmatter names its current picture,
  // and that picture's files row (linked to the item, and to a chat).
  const backup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [
      { id: 'file-old', linkedTo: [ITEM_ID, 'chat-old'], tags: [ITEM_ID] },
    ] as unknown as BackupData['files'],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
    docMountFileLinks: [
      { id: 'link-1', mountPointId: 'mount-old', fileId: 'docfile-1', relativePath: 'Wardrobe/Coat.md' },
    ] as unknown as BackupData['docMountFileLinks'],
    docMountDocuments: [
      {
        id: 'doc-1',
        fileId: 'docfile-1',
        content: `---\nid: ${ITEM_ID}\ntitle: Coat\ntypes:\n  - top\nimageFileId: file-old\n---\nA coat.`,
      },
    ] as unknown as BackupData['docMountDocuments'],
  })

  it("keeps a picture row's item link on the item's (unchanged) id, remapping only other links", () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const file = result.files[0]
    const mapping = remapper.getMapping()

    expect(file.id).toBe(mapping['file-old'])
    expect(file.linkedTo).toEqual([ITEM_ID, mapping['chat-old']])
    expect(file.tags).toEqual([ITEM_ID])
  })

  it("plans the frontmatter pointer onto the picture's new file id, against the remapped mount", () => {
    const remapper = new UuidRemapper()
    const original = backup()
    const fixes = planWardrobeImagePointerFixes(original, remapper)
    const result = remapBackupData(original, 'target-user', remapper)

    expect(fixes).toEqual([
      {
        mountPointId: remapper.getMapping()['mount-old'],
        sourceMountPointId: 'mount-old',
        itemId: ITEM_ID,
        imageFileId: result.files[0].id,
      },
    ])
  })

  it('plans nothing for a pointer naming a file the backup does not carry', () => {
    const data = backup()
    data.files = []
    expect(planWardrobeImagePointerFixes(data, new UuidRemapper())).toEqual([])
  })
})

describe('remapBackupData() - consolidation references', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  const emptyBackup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
  })

  it('remaps supersededById and consolidatedFrom in lockstep with the memory ids', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      memories: [
        { id: 'digest-old', characterId: 'c', source: 'CONSOLIDATED', tier: 'hot', consolidatedFrom: ['m1-old', 'm2-old'], supersededById: null },
        { id: 'm1-old', characterId: 'c', tier: 'cold', supersededById: 'digest-old', consolidatedFrom: [] },
        { id: 'm2-old', characterId: 'c', tier: 'cold', supersededById: 'digest-old', consolidatedFrom: [] },
      ] as unknown as BackupData['memories'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const map = remapper.getMapping()
    const [digest, m1, m2] = result.memories

    expect(digest.id).toBe(map['digest-old'])
    expect(digest.consolidatedFrom).toEqual([map['m1-old'], map['m2-old']])
    expect(digest.supersededById).toBeNull()
    expect(m1.supersededById).toBe(map['digest-old'])
    expect(m2.supersededById).toBe(map['digest-old'])
    expect(m1.id).toBe(map['m1-old'])
  })

  it('leaves a pre-tier memory without consolidation fields untouched', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      memories: [{ id: 'old', characterId: 'c' }] as unknown as BackupData['memories'],
    }

    const result = remapBackupData(data, 'target-user', remapper)

    expect(result.memories[0]).not.toHaveProperty('supersededById')
    expect(result.memories[0]).not.toHaveProperty('consolidatedFrom')
  })

  it('remaps a chat\'s otherExtractionWatermarkMessageId to the new id of its message', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      chats: [
        {
          id: 'chat-old',
          participants: [],
          tags: [],
          otherExtractionWatermarkMessageId: 'msg-old',
          messages: [{ id: 'msg-old', type: 'message' }],
        },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const chat = result.chats[0] as unknown as { otherExtractionWatermarkMessageId: string; messages: Array<{ id: string }> }

    expect(chat.messages[0].id).toBe(remapper.getMapping()['msg-old'])
    expect(chat.otherExtractionWatermarkMessageId).toBe(chat.messages[0].id)
  })

  it('remaps a chat\'s episodeExtractionWatermarkMessageId to the new id of its message', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      chats: [
        {
          id: 'chat-old',
          participants: [],
          tags: [],
          episodeExtractionWatermarkMessageId: 'msg-old',
          messages: [{ id: 'msg-old', type: 'message' }],
        },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const chat = result.chats[0] as unknown as { episodeExtractionWatermarkMessageId: string; messages: Array<{ id: string }> }

    expect(chat.messages[0].id).toBe(remapper.getMapping()['msg-old'])
    expect(chat.episodeExtractionWatermarkMessageId).toBe(chat.messages[0].id)
  })

  it('remaps a chat\'s turnExtractionWatermarkMessageId to the new id of its message (bug 245)', () => {
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...emptyBackup(),
      chats: [
        {
          id: 'chat-old',
          participants: [],
          tags: [],
          turnExtractionWatermarkMessageId: 'msg-old',
          messages: [{ id: 'msg-old', type: 'message' }],
        },
      ] as unknown as BackupData['chats'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const chat = result.chats[0] as unknown as { turnExtractionWatermarkMessageId: string; messages: Array<{ id: string }> }

    expect(chat.messages[0].id).toBe(remapper.getMapping()['msg-old'])
    expect(chat.turnExtractionWatermarkMessageId).toBe(chat.messages[0].id)
  })
})

describe('remapBackupData() - wardrobe items filed in subfolders', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  // A hand-written item with no frontmatter id: its id is derived from its
  // mount and path, so a new-account restore must recompute it against the
  // remapped mount — at any depth under `Wardrobe/`.
  const NESTED_CONTENT = '---\ntitle: Coat\ntypes: [top]\nimageFileId: file-old\n---\n'
  const nestedBackup = (): BackupData => ({
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [{ id: 'file-old' }] as unknown as BackupData['files'],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
    docMountPoints: [{ id: 'mount-old' }] as unknown as BackupData['docMountPoints'],
    docMountDocuments: [{ fileId: 'blob-1', content: NESTED_CONTENT }] as unknown as BackupData['docMountDocuments'],
    docMountFileLinks: [
      { mountPointId: 'mount-old', relativePath: 'Wardrobe/Formal/Evening/Coat.md', fileId: 'blob-1' },
    ] as unknown as BackupData['docMountFileLinks'],
  })

  it('remaps the wear ledger of an item at Wardrobe/Formal/Evening/', () => {
    const { wardrobeItemIdForDocument } = jest.requireActual(
      '@/lib/database/repositories/vault-overlay/parsers'
    ) as typeof import('@/lib/database/repositories/vault-overlay/parsers')
    const oldItemId = wardrobeItemIdForDocument({
      mountPointId: 'mount-old',
      relativePath: 'Wardrobe/Formal/Evening/Coat.md',
      content: NESTED_CONTENT,
    })
    const remapper = new UuidRemapper()
    const data: BackupData = {
      ...nestedBackup(),
      wardrobeWear: [{ id: 'wear-old', itemId: oldItemId, characterId: null, chatId: null }] as unknown as BackupData['wardrobeWear'],
    }

    const result = remapBackupData(data, 'target-user', remapper)
    const newMount = remapper.getMapping()['mount-old']
    const newItemId = wardrobeItemIdForDocument({
      mountPointId: newMount,
      relativePath: 'Wardrobe/Formal/Evening/Coat.md',
      content: NESTED_CONTENT,
    })

    expect(newItemId).not.toBe(oldItemId)
    expect(result.wardrobeWear?.[0].itemId).toBe(newItemId)
  })

  it("plans the picture-pointer fix for a nested item", () => {
    const remapper = new UuidRemapper()
    const fixes = planWardrobeImagePointerFixes(nestedBackup(), remapper)

    expect(fixes).toHaveLength(1)
    expect(fixes[0].sourceMountPointId).toBe('mount-old')
    expect(fixes[0].imageFileId).toBe(remapper.getMapping()['file-old'])
  })
})

describe('remapBackupData() - outfit history', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  it('round-trips a five-entry timeline with its indices, hashes and cursor under remapped ids', () => {
    const { hashEquippedSlots } = require('@/lib/wardrobe/outfit-hash')
    const empty = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }
    const rows = [0, 1, 2, 3, 4].map((entryIndex) => {
      const slots = { ...empty, top: [`item-${entryIndex}`] }
      return {
        id: `hist-${entryIndex}`,
        chatId: 'chat-old',
        characterId: 'char-old',
        entryIndex,
        slots,
        slotsHash: hashEquippedSlots(slots),
        source: entryIndex === 0 ? 'chat-start' : 'character',
        actorCharacterId: entryIndex === 0 ? null : 'char-old',
        isCurrent: entryIndex === 2,
        createdAt: `2026-10-16T0${entryIndex}:00:00.000Z`,
      }
    })
    const remapper = new UuidRemapper()
    const data = {
      manifest: {},
      characters: [{ id: 'char-old', name: 'Bertie' }],
      chats: [{ id: 'chat-old', participants: [], messages: [] }],
      tags: [], connectionProfiles: [], imageProfiles: [], embeddingProfiles: [], memories: [],
      files: [], promptTemplates: [], roleplayTemplates: [], providerModels: [], projects: [], llmLogs: [],
      wardrobeHistory: rows,
    } as unknown as BackupData

    const result = remapBackupData(data, 'target-user', remapper)
    const out = result.wardrobeHistory ?? []

    const newChatId = result.chats[0].id
    const newCharId = result.characters[0].id
    expect(newChatId).not.toBe('chat-old')
    expect(out.map((r) => r.entryIndex)).toEqual([0, 1, 2, 3, 4])
    expect(out.map((r) => r.isCurrent)).toEqual([false, false, true, false, false])
    expect(out.every((r) => r.chatId === newChatId && r.characterId === newCharId)).toBe(true)
    expect(out[0].actorCharacterId).toBeNull()
    expect(out[1].actorCharacterId).toBe(newCharId)
    expect(new Set(out.map((r) => r.id)).size).toBe(5)
    expect(out.some((r) => r.id.startsWith('hist-'))).toBe(false)
    for (const row of out) expect(row.slotsHash).toBe(hashEquippedSlots(row.slots))
    expect(out.map((r) => r.slotsHash)).toEqual(rows.map((r) => r.slotsHash))
  })
})

describe('remapBackupData() - chat equipped outfit (bug 252)', () => {
  // Real UUID-shaped ids: the wardrobe parser only honours a frontmatter id of
  // that shape. Mount-derived ids are recomputed against the remapped mount.
  const FRONTMATTER_ITEM = '33333333-3333-4333-8333-333333333333'
  const OLD_MOUNT = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  const empty = { top: [], bottom: [], footwear: [], accessories: [], hair: [] }

  function backup(equippedOutfit: unknown, extra: Partial<BackupData> = {}): BackupData {
    return {
      manifest: {},
      characters: [{ id: 'char-a', name: 'Bertie' }, { id: 'char-b', name: 'Jeeves' }],
      chats: [{ id: 'chat-old', participants: [], messages: [], equippedOutfit }],
      tags: [], connectionProfiles: [], imageProfiles: [], embeddingProfiles: [], memories: [],
      files: [], promptTemplates: [], roleplayTemplates: [], providerModels: [], projects: [], llmLogs: [],
      ...extra,
    } as unknown as BackupData
  }

  it('re-keys every character to its new id', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({
        'char-a': { ...empty, top: ['item-unknown'] },
        'char-b': { ...empty, footwear: ['item-other'] },
      }),
      'target-user',
      remapper
    )

    const [charA, charB] = result.characters.map((c) => c.id)
    expect(charA).not.toBe('char-a')
    const outfit = result.chats[0].equippedOutfit as Record<string, Record<string, string[]>>
    expect(Object.keys(outfit).sort()).toEqual([charA, charB].sort())
    expect(outfit['char-a']).toBeUndefined()
    // An item id the backup carries no document for passes through.
    expect(outfit[charA].top).toEqual(['item-unknown'])
    expect(outfit[charB].footwear).toEqual(['item-other'])
    expect(outfit[charA].bottom).toEqual([])
  })

  it('moves slot item ids with the wardrobe item remap', () => {
    const remapper = new UuidRemapper()
    const { wardrobeItemIdForDocument } = require('@/lib/database/repositories/vault-overlay/parsers')
    const derivedContent = '---\ntitle: Spats\ntypes: [footwear]\n---\n'
    const oldDerived = wardrobeItemIdForDocument({
      mountPointId: OLD_MOUNT,
      relativePath: 'Wardrobe/Spats.md',
      content: derivedContent,
    })
    const data = backup(
      { 'char-a': { ...empty, top: [FRONTMATTER_ITEM], footwear: [oldDerived] } },
      {
        docMountFileLinks: [
          { id: 'link-1', fileId: 'file-1', mountPointId: OLD_MOUNT, relativePath: 'Wardrobe/Coat.md' },
          { id: 'link-2', fileId: 'file-2', mountPointId: OLD_MOUNT, relativePath: 'Wardrobe/Spats.md' },
        ] as unknown as BackupData['docMountFileLinks'],
        docMountDocuments: [
          { id: 'doc-1', fileId: 'file-1', content: `---\nid: ${FRONTMATTER_ITEM}\ntitle: Coat\ntypes: [top]\n---\n` },
          { id: 'doc-2', fileId: 'file-2', content: derivedContent },
        ] as unknown as BackupData['docMountDocuments'],
      }
    )

    const result = remapBackupData(data, 'target-user', remapper)
    const charA = result.characters[0].id
    const outfit = result.chats[0].equippedOutfit as Record<string, Record<string, string[]>>
    const newDerived = wardrobeItemIdForDocument({
      mountPointId: remapper.remap(OLD_MOUNT),
      relativePath: 'Wardrobe/Spats.md',
      content: derivedContent,
    })

    expect(newDerived).not.toBe(oldDerived)
    expect(outfit[charA].top).toEqual([FRONTMATTER_ITEM])
    expect(outfit[charA].footwear).toEqual([newDerived])
  })

  it('agrees with the outfit history on the character and item ids', () => {
    const { hashEquippedSlots } = require('@/lib/wardrobe/outfit-hash')
    const slots = { ...empty, top: ['item-1'] }
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({ 'char-a': slots }, {
        wardrobeHistory: [{
          id: 'hist-0', chatId: 'chat-old', characterId: 'char-a', entryIndex: 0, slots,
          slotsHash: hashEquippedSlots(slots), source: 'chat-start', actorCharacterId: null,
          isCurrent: true, createdAt: '2026-10-16T00:00:00.000Z',
        }],
      } as unknown as Partial<BackupData>),
      'target-user',
      remapper
    )

    const history = result.wardrobeHistory![0]
    const outfit = result.chats[0].equippedOutfit as Record<string, unknown>
    expect(outfit[history.characterId]).toEqual(history.slots)
  })

  it('leaves a chat with no outfit alone', () => {
    const remapper = new UuidRemapper()
    expect(remapBackupData(backup(null), 'target-user', remapper).chats[0].equippedOutfit).toBeNull()
    expect(remapBackupData(backup(undefined), 'target-user', new UuidRemapper()).chats[0].equippedOutfit)
      .toBeUndefined()
  })
})

describe('remapBackupData() - other character-keyed chat columns (bug 252)', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
    let counter = 0
    randomUUIDMock.mockImplementation(() => `remapped-${counter++}` as ReturnType<typeof randomUUID>)
  })

  function backup(chat: Record<string, unknown>): BackupData {
    return {
      manifest: {},
      characters: [{ id: 'char-a', name: 'Bertie' }],
      chats: [{ id: 'chat-old', participants: [], messages: [{ id: 'msg-old', type: 'message' }], ...chat }],
      tags: [], connectionProfiles: [], imageProfiles: [], embeddingProfiles: [], memories: [],
      files: [{ id: 'file-old' }], promptTemplates: [], roleplayTemplates: [], providerModels: [], projects: [],
      llmLogs: [],
    } as unknown as BackupData
  }

  it('re-keys outfit avatars and follows the picture to its new file id', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({ characterAvatars: { 'char-a': { imageId: 'file-old', generatedAt: 't', afterMessageCount: 2 } } }),
      'target-user',
      remapper
    )
    const charA = result.characters[0].id
    const fileId = result.files[0].id
    expect(fileId).not.toBe('file-old')
    expect(result.chats[0].characterAvatars).toEqual({
      [charA]: { imageId: fileId, generatedAt: 't', afterMessageCount: 2 },
    })
  })

  it('re-keys Courier checkpoints and follows the message to its new id', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({ courierCheckpoints: { 'char-a': { lastResolvedMessageId: 'msg-old', resolvedAt: 't' } } }),
      'target-user',
      remapper
    )
    const charA = result.characters[0].id
    const messageId = result.chats[0].messages[0].id
    expect(messageId).not.toBe('msg-old')
    expect(result.chats[0].courierCheckpoints).toEqual({
      [charA]: { lastResolvedMessageId: messageId, resolvedAt: 't' },
    })
  })

  it('drops an entry for a character the backup does not carry instead of minting an id', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({ equippedOutfit: { 'char-a': { top: ['x'] }, 'char-deleted': { top: ['y'] } } }),
      'target-user',
      remapper
    )
    expect(Object.keys(result.chats[0].equippedOutfit as object)).toEqual([result.characters[0].id])
  })

  it('re-keys queued outfit notices', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(
      backup({ pendingOutfitNotifications: { 'char-a': { text: 'changed' } } }),
      'target-user',
      remapper
    )
    expect(result.chats[0].pendingOutfitNotifications).toEqual({ [result.characters[0].id]: { text: 'changed' } })
  })
})
