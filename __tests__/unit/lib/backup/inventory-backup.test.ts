/**
 * @jest-environment node
 *
 * The Inventory through a new-account restore (inventory.md, "Export and
 * restore"). Objects are JSON files in vaults, so their ids — and the
 * `parentId` / kit `itemIds` that name each other — travel verbatim inside
 * the documents. What the remap must still get right is everything *outside*
 * the files that names them:
 *
 *   - a chat's `equippedInventory` is keyed by character, and the character
 *     is renamed — its object ids are not;
 *   - an object's picture is a `files` row whose `linkedTo` names the object;
 *   - an object's `imageFileId` names a `files` row whose id *is* renamed, so
 *     the restore repoints it once the vaults have landed.
 *
 * The bundle carries an archetype, an instance of it, a kit holding the
 * instance, and a chat in which the character carries the instance.
 */

import { UuidRemapper } from '@/lib/backup/uuid-remapper'
import { planInventoryImagePointerFixes, remapBackupData } from '@/lib/backup/restore/uuid-remap'
import { parseInventoryItemFile } from '@/lib/database/repositories/vault-overlay/inventory-readers'
import { resolveItem } from '@/lib/inventory/resolve'
import type { BackupData } from '@/lib/backup/types'
import type { InventoryRecord } from '@/lib/schemas/inventory.types'

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({ debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: jest.fn() })),
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}))

const ARCHETYPE_ID = 'a1111111-1111-4111-8111-111111111111'
const INSTANCE_ID = 'b2222222-2222-4222-8222-222222222222'
const KIT_ID = 'c3333333-3333-4333-8333-333333333333'
const PICTURE_ID = 'd4444444-4444-4444-8444-444444444444'
const CHARACTER_ID = 'e5555555-5555-4555-8555-555555555555'
const CHAT_ID = 'f6666666-6666-4666-8666-666666666666'
const STAMP = '2026-10-01T00:00:00.000Z'

const archetype = {
  id: ARCHETYPE_ID,
  kind: 'item',
  isArchetype: true,
  name: 'Magic bow',
  description: 'A longbow of pale ash that hums when strung.',
  createdAt: STAMP,
  updatedAt: STAMP,
}
const instance = {
  id: INSTANCE_ID,
  kind: 'item',
  parentId: ARCHETYPE_ID,
  title: "Vivienne's bow",
  imageFileId: PICTURE_ID,
  createdAt: STAMP,
  updatedAt: STAMP,
}
const kit = {
  id: KIT_ID,
  kind: 'kit',
  name: 'Archery kit',
  itemIds: [INSTANCE_ID],
  createdAt: STAMP,
  updatedAt: STAMP,
}

const docs = [
  { path: 'Inventory/Magic bow.json', json: archetype },
  { path: 'Inventory/Weapons/Vivienne-s bow.json', json: instance },
  { path: 'Inventory/Archery kit.json', json: kit },
]

const backup = (): BackupData => ({
  manifest: {} as BackupData['manifest'],
  characters: [{ id: CHARACTER_ID, name: 'Vivienne', characterDocumentMountPointId: 'vault-old' }] as unknown as BackupData['characters'],
  chats: [
    {
      id: CHAT_ID,
      title: 'The tourney',
      participants: [{ id: 'seat-old', type: 'CHARACTER', characterId: CHARACTER_ID }],
      messages: [],
      equippedInventory: { [CHARACTER_ID]: [INSTANCE_ID] },
    },
  ] as unknown as BackupData['chats'],
  tags: [],
  connectionProfiles: [],
  imageProfiles: [],
  embeddingProfiles: [],
  memories: [],
  files: [{ id: PICTURE_ID, linkedTo: [INSTANCE_ID, CHAT_ID], tags: [INSTANCE_ID] }] as unknown as BackupData['files'],
  promptTemplates: [],
  roleplayTemplates: [],
  providerModels: [],
  projects: [],
  llmLogs: [],
  docMountFileLinks: docs.map((d, i) => ({
    id: `link-${i}`,
    mountPointId: 'vault-old',
    fileId: `docfile-${i}`,
    relativePath: d.path,
  })) as unknown as BackupData['docMountFileLinks'],
  docMountDocuments: docs.map((d, i) => ({
    id: `doc-${i}`,
    fileId: `docfile-${i}`,
    content: `${JSON.stringify(d.json, null, 2)}\n`,
  })) as unknown as BackupData['docMountDocuments'],
})

/** The restored objects, read back the way the vault reader reads them. */
function restoredRecords(result: BackupData): InventoryRecord[] {
  const pathByFileId = new Map((result.docMountFileLinks ?? []).map((l) => [l.fileId, l.relativePath]))
  return (result.docMountDocuments ?? [])
    .map((doc) => parseInventoryItemFile({ relativePath: pathByFileId.get(doc.fileId) as string, content: doc.content }))
    .filter((r): r is InventoryRecord => r !== null)
}

describe('Inventory in a new-account restore', () => {
  it('keeps the archetype, instance and kit pointing at each other', () => {
    const result = remapBackupData(backup(), 'target-user', new UuidRemapper())
    const records = restoredRecords(result)
    const byId = new Map(records.map((r) => [r.id, r]))

    expect(records.map((r) => r.id).sort()).toEqual([ARCHETYPE_ID, INSTANCE_ID, KIT_ID].sort())
    expect(byId.get(KIT_ID)?.itemIds).toEqual([INSTANCE_ID])

    const resolved = resolveItem(byId.get(INSTANCE_ID) as InventoryRecord, (id) => byId.get(id))
    expect(resolved.parentMissing).toBeFalsy()
    expect(resolved.description).toBe(archetype.description)
    expect(resolved.title).toBe(instance.title)
    expect(resolved.folder).toBe('Weapons')
  })

  it("re-keys the chat's carried set to the character's new id, keeping the object ids", () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const newCharacterId = remapper.getMapping()[CHARACTER_ID]

    expect(newCharacterId).toBeDefined()
    expect(newCharacterId).not.toBe(CHARACTER_ID)
    expect(result.chats[0].participants[0].characterId).toBe(newCharacterId)
    expect(result.chats[0].equippedInventory).toEqual({ [newCharacterId]: [INSTANCE_ID] })
  })

  it("keeps a picture's link to its object while remapping its other links", () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const mapping = remapper.getMapping()
    const picture = result.files[0]

    expect(picture.id).toBe(mapping[PICTURE_ID])
    expect(picture.linkedTo).toEqual([INSTANCE_ID, mapping[CHAT_ID]])
    expect(picture.tags).toEqual([INSTANCE_ID])
  })

  it("plans the object's picture pointer onto the file's new id, against the remapped vault", () => {
    const remapper = new UuidRemapper()
    const original = backup()
    const fixes = planInventoryImagePointerFixes(original, remapper)
    const result = remapBackupData(original, 'target-user', remapper)

    expect(fixes).toEqual([
      {
        mountPointId: remapper.getMapping()['vault-old'],
        sourceMountPointId: 'vault-old',
        itemId: INSTANCE_ID,
        imageFileId: result.files[0].id,
      },
    ])
  })

  it('plans nothing for a pointer naming a file the backup does not carry', () => {
    const data = backup()
    data.files = []
    expect(planInventoryImagePointerFixes(data, new UuidRemapper())).toEqual([])
  })

  it('leaves a chat with nothing carried as it was', () => {
    const data = backup()
    ;(data.chats[0] as unknown as { equippedInventory: unknown }).equippedInventory = null
    const result = remapBackupData(data, 'target-user', new UuidRemapper())
    expect(result.chats[0].equippedInventory).toBeNull()
  })
})
