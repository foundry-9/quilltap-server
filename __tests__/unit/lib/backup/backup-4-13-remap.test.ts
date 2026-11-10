/**
 * @jest-environment node
 *
 * 4.13 additions through a new-account restore that live outside their own
 * tables:
 *
 *   - `chatSettings.cheapLLMSettings.outfitSelectionProfileId` — the Green
 *     Room's opening-outfit profile, a connection-profile id nested in JSON,
 *     must follow the profile's new id;
 *   - Atlas entries — Markdown files in a store whose frontmatter `id`
 *     travels verbatim, so a picture's `files.linkedTo` keeps naming the
 *     entry, while the entry's `imageFileId` names a `files` row whose id IS
 *     renamed, so the restore plans a pointer fix once the vaults have landed.
 */

import { UuidRemapper } from '@/lib/backup/uuid-remapper'
import { planAtlasImagePointerFixes, remapBackupData } from '@/lib/backup/restore/uuid-remap'
import type { BackupData } from '@/lib/backup/types'

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({ debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn(), child: jest.fn() })),
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}))

const PROFILE_ID = 'a1111111-1111-4111-8111-111111111111'
const OUTFIT_PROFILE_ID = 'b2222222-2222-4222-8222-222222222222'
const ENTRY_ID = 'c3333333-3333-4333-8333-333333333333'
const PICTURE_ID = 'd4444444-4444-4444-8444-444444444444'
const SETTINGS_ID = 'e5555555-5555-4555-8555-555555555555'
const STAMP = '2026-11-01T00:00:00.000Z'

const ATLAS_ENTRY = [
  '---',
  `id: ${ENTRY_ID}`,
  'name: The Lighthouse',
  'aliases:',
  '  - the old light',
  'graphicPrompt: a white stone lighthouse on a black rock',
  `imageFileId: ${PICTURE_ID}`,
  `createdAt: ${STAMP}`,
  `updatedAt: ${STAMP}`,
  '---',
  'The keeper left in the spring and nobody has lit it since.',
  '',
].join('\n')

function backup(): BackupData {
  return {
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [],
    tags: [],
    connectionProfiles: [
      { id: PROFILE_ID, name: 'Main', provider: 'OPENAI' },
      { id: OUTFIT_PROFILE_ID, name: 'Dresser', provider: 'OPENAI' },
    ] as unknown as BackupData['connectionProfiles'],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [{ id: PICTURE_ID, linkedTo: [ENTRY_ID], tags: [ENTRY_ID] }] as unknown as BackupData['files'],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
    chatSettings: [
      {
        id: SETTINGS_ID,
        userId: 'old-user',
        cheapLLMSettings: {
          strategy: 'USER_DEFINED',
          userDefinedProfileId: PROFILE_ID,
          defaultCheapProfileId: null,
          outfitSelectionProfileId: OUTFIT_PROFILE_ID,
        },
      },
    ] as unknown as BackupData['chatSettings'],
    docMountFileLinks: [
      { id: 'link-1', mountPointId: 'store-old', fileId: 'docfile-1', relativePath: 'Atlas/Places/The Lighthouse.md' },
    ] as unknown as BackupData['docMountFileLinks'],
    docMountDocuments: [
      { id: 'doc-1', fileId: 'docfile-1', content: ATLAS_ENTRY },
    ] as unknown as BackupData['docMountDocuments'],
  } as unknown as BackupData
}

describe('chat settings — outfitSelectionProfileId in a new-account restore', () => {
  it("follows the profile's new id", () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const mapping = remapper.getMapping()
    const cheap = (result.chatSettings?.[0] as unknown as { cheapLLMSettings: Record<string, unknown> })
      .cheapLLMSettings

    expect(mapping[OUTFIT_PROFILE_ID]).toBeDefined()
    expect(cheap.outfitSelectionProfileId).toBe(mapping[OUTFIT_PROFILE_ID])
    expect(cheap.outfitSelectionProfileId).toBe(result.connectionProfiles[1].id)
    expect(cheap.userDefinedProfileId).toBe(result.connectionProfiles[0].id)
  })

  it('leaves an unset choice (the cheap LLM) unset', () => {
    const data = backup()
    ;(data.chatSettings![0] as unknown as { cheapLLMSettings: Record<string, unknown> })
      .cheapLLMSettings.outfitSelectionProfileId = null
    const result = remapBackupData(data, 'target-user', new UuidRemapper())
    const cheap = (result.chatSettings?.[0] as unknown as { cheapLLMSettings: Record<string, unknown> })
      .cheapLLMSettings

    expect(cheap.outfitSelectionProfileId).toBeNull()
  })
})

describe('Atlas entries in a new-account restore', () => {
  it('carries the entry file verbatim, id and all', () => {
    const result = remapBackupData(backup(), 'target-user', new UuidRemapper())
    expect(result.docMountDocuments?.[0].content).toBe(ATLAS_ENTRY)
    expect(result.docMountFileLinks?.[0].relativePath).toBe('Atlas/Places/The Lighthouse.md')
  })

  it("keeps a picture's link to its entry while renaming the picture", () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const picture = result.files[0]

    expect(picture.id).toBe(remapper.getMapping()[PICTURE_ID])
    expect(picture.linkedTo).toEqual([ENTRY_ID])
    expect(picture.tags).toEqual([ENTRY_ID])
  })

  it("plans the entry's picture pointer onto the file's new id, against the remapped store", () => {
    const remapper = new UuidRemapper()
    const original = backup()
    const fixes = planAtlasImagePointerFixes(original, remapper)
    const result = remapBackupData(original, 'target-user', remapper)

    expect(fixes).toEqual([
      {
        mountPointId: remapper.getMapping()['store-old'],
        sourceMountPointId: 'store-old',
        itemId: ENTRY_ID,
        imageFileId: result.files[0].id,
      },
    ])
  })

  it('plans nothing for a pointer naming a file the backup does not carry', () => {
    const data = backup()
    data.files = []
    expect(planAtlasImagePointerFixes(data, new UuidRemapper())).toEqual([])
  })

  it('ignores a picture kept under Atlas/images/', () => {
    const data = backup()
    ;(data.docMountFileLinks![0] as { relativePath: string }).relativePath = 'Atlas/images/The Lighthouse.md'
    expect(planAtlasImagePointerFixes(data, new UuidRemapper())).toEqual([])
  })
})
