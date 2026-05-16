/**
 * Per-writer dual-voicing checks for the Staff opaque-anywhere feature.
 *
 * For every Staff writer (Host, Aurora, Prospero, Librarian, Lantern,
 * Concierge, Ariel) the persona-voiced `buildXxxContent` body should name the
 * persona ("The Host", "Aurora", "Prospero", …) while the sibling
 * `buildXxxOpaqueContent` body must NOT — and both should still surface the
 * underlying fact (character name, file path, time, etc.) so the LLM context
 * is functionally equivalent.
 *
 * See `lib/services/chat-message/context-builder.service.ts` for the swap
 * site that consumes these bodies.
 */

import { describe, it, expect, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn().mockRejectedValue(new Error('no vault')),
}))

import {
  buildAddContent,
  buildAddOpaqueContent,
  buildRemoveContent,
  buildRemoveOpaqueContent,
  buildStatusChangeContent,
  buildStatusChangeOpaqueContent,
  buildScenarioContent,
  buildScenarioOpaqueContent,
  buildUserCharacterContent,
  buildUserCharacterOpaqueContent,
  buildMultiCharacterRosterContent,
  buildMultiCharacterRosterOpaqueContent,
  buildSilentModeEntryContent,
  buildSilentModeEntryOpaqueContent,
  buildSilentModeExitContent,
  buildSilentModeExitOpaqueContent,
  buildJoinScenarioContent,
  buildJoinScenarioOpaqueContent,
  buildOffSceneCharactersContent,
  buildOffSceneCharactersOpaqueContent,
  buildTimestampContent,
  buildTimestampOpaqueContent,
} from '@/lib/services/host-notifications/writer'
import {
  buildOpeningOutfitContent,
  buildOpeningOutfitOpaqueContent,
  buildOutfitChangeContent,
  buildOutfitChangeOpaqueContent,
} from '@/lib/services/aurora-notifications/writer'
import {
  buildConnectionProfileChangeContent,
  buildConnectionProfileChangeOpaqueContent,
  buildProjectContextContent,
  buildProjectContextOpaqueContent,
  buildGeneralContextContent,
  buildGeneralContextOpaqueContent,
} from '@/lib/services/prospero-notifications/writer'
import {
  buildOpenContent,
  buildOpenOpaqueContent,
  buildRenameContent,
  buildRenameOpaqueContent,
  buildSaveContent,
  buildSaveOpaqueContent,
  buildDeleteContent,
  buildDeleteOpaqueContent,
  buildFolderCreatedContent,
  buildFolderCreatedOpaqueContent,
  buildFolderDeletedContent,
  buildFolderDeletedOpaqueContent,
  buildAttachContent,
  buildAttachOpaqueContent,
  buildUploadContent,
  buildUploadOpaqueContent,
  buildSummaryContent,
  buildSummaryOpaqueContent,
} from '@/lib/services/librarian-notifications/writer'
import { buildDangerContent, buildDangerOpaqueContent } from '@/lib/services/concierge-notifications/writer'
import type { Character } from '@/lib/schemas/character.types'

const PERSONA_NAMES = [
  'The Host',
  'the Host',
  'Aurora',
  'Prospero',
  'The Librarian',
  'the Librarian',
  'The Lantern',
  'the Lantern',
  'The Concierge',
  'the Concierge',
  'Ariel',
] as const

function expectNoPersonaNames(body: string, allowAriel = false): void {
  for (const name of PERSONA_NAMES) {
    if (allowAriel && name === 'Ariel') continue
    expect(body).not.toContain(name)
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

describe('Host opaque builders', () => {
  const character = {
    id: 'char-1',
    name: 'Beatrice',
    avatarUrl: null,
    description: 'A skeptical librarian.',
    characterDocumentMountPointId: null,
  } as unknown as Character

  it('add: persona names the Host; opaque does not, but keeps the character name', async () => {
    const persona = await buildAddContent(character)
    const opaque = await buildAddOpaqueContent(character)
    expect(persona).toContain('The Host welcomes Beatrice')
    expect(opaque).toContain('Beatrice has joined the scene')
    expectNoPersonaNames(opaque)
  })

  it('remove', () => {
    expect(buildRemoveContent('Beatrice')).toContain('The Host bids Beatrice adieu')
    const opaque = buildRemoveOpaqueContent('Beatrice')
    expect(opaque).toContain('Beatrice has left the scene')
    expectNoPersonaNames(opaque)
  })

  it('status change', () => {
    expect(buildStatusChangeContent('Beatrice', 'active', 'silent')).toContain('The Host notes')
    const opaque = buildStatusChangeOpaqueContent('Beatrice', 'active', 'silent')
    expect(opaque).toContain('Beatrice is now')
    expectNoPersonaNames(opaque)
  })

  it('scenario', () => {
    expect(buildScenarioContent('A foggy harbour.')).toContain('The Host sets the scene')
    const opaque = buildScenarioOpaqueContent('A foggy harbour.')
    expect(opaque).toContain('A foggy harbour.')
    expectNoPersonaNames(opaque)
  })

  it('user character', () => {
    expect(buildUserCharacterContent('Charles', 'a writer')).toContain('The Host introduces')
    const opaque = buildUserCharacterOpaqueContent('Charles', 'a writer')
    expect(opaque).toContain("Charles is the user's voice")
    expect(opaque).toContain('a writer')
    expectNoPersonaNames(opaque)
  })

  it('roster (empty)', () => {
    expect(buildMultiCharacterRosterContent('Beatrice', [])).toContain('The Host notes')
    const opaque = buildMultiCharacterRosterOpaqueContent('Beatrice', [])
    expect(opaque).toContain('Beatrice stands alone')
    expectNoPersonaNames(opaque)
  })

  it('silent mode entry/exit', () => {
    expect(buildSilentModeEntryContent('Beatrice')).toContain('The Host whispers')
    const enter = buildSilentModeEntryOpaqueContent('Beatrice')
    expect(enter).toContain('SILENT mode')
    expectNoPersonaNames(enter)

    expect(buildSilentModeExitContent('Beatrice')).toContain('The Host whispers')
    const exit = buildSilentModeExitOpaqueContent('Beatrice')
    expect(exit).toContain('Silence is lifted')
    expectNoPersonaNames(exit)
  })

  it('join scenario', () => {
    expect(buildJoinScenarioContent('Beatrice', 'arrived by carriage')).toContain('The Host whispers')
    const opaque = buildJoinScenarioOpaqueContent('Beatrice', 'arrived by carriage')
    expect(opaque).toContain('arrived by carriage')
    expectNoPersonaNames(opaque)
  })

  it('off-scene characters', () => {
    const cards = [{ id: 'a', name: 'Reginald', description: 'A retired colonel.' }]
    expect(buildOffSceneCharactersContent(cards)).toContain('The Host begs leave to introduce')
    const opaque = buildOffSceneCharactersOpaqueContent(cards)
    expect(opaque).toContain('Reginald')
    expect(opaque).toContain('A retired colonel.')
    expectNoPersonaNames(opaque)
  })

  it('timestamp', () => {
    expect(buildTimestampContent('3:42 PM')).toContain('The Host marks the time')
    const opaque = buildTimestampOpaqueContent('3:42 PM')
    expect(opaque).toContain('3:42 PM')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Aurora
// ---------------------------------------------------------------------------

describe('Aurora opaque builders', () => {
  const outfit = {
    top: ['a linen blouse'],
    bottom: ['a wool skirt'],
    footwear: ['low boots'],
    accessories: [],
  }
  const params = { characterName: 'Beatrice', outfit }

  it('opening outfit', () => {
    expect(buildOpeningOutfitContent(params)).toContain('Aurora regards Beatrice')
    const opaque = buildOpeningOutfitOpaqueContent(params)
    expect(opaque).toContain("Beatrice's current attire")
    expectNoPersonaNames(opaque)
  })

  it('outfit change', () => {
    expect(buildOutfitChangeContent(params)).toContain('Aurora marks an alteration')
    const opaque = buildOutfitChangeOpaqueContent(params)
    expect(opaque).toContain('Beatrice is now wearing')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Prospero
// ---------------------------------------------------------------------------

describe('Prospero opaque builders', () => {
  it('connection-profile change', () => {
    expect(buildConnectionProfileChangeContent('Beatrice', 'old', 'new')).toContain('Prospero notes')
    const opaque = buildConnectionProfileChangeOpaqueContent('Beatrice', 'old', 'new')
    expect(opaque).toContain("Beatrice's assigned model has changed to new")
    expect(opaque).toContain('previously old')
    expectNoPersonaNames(opaque)
  })

  it('project context', () => {
    const project = { name: 'Foggy Tale', description: 'A novel.', instructions: null, documentStores: [] }
    expect(buildProjectContextContent(project)).toContain('Prospero opens his ledger')
    const opaque = buildProjectContextOpaqueContent(project)
    expect(opaque).toContain('Foggy Tale')
    expect(opaque).toContain('A novel.')
    expectNoPersonaNames(opaque)
  })

  it('general context', () => {
    const general = { mountPointId: 'm-1', name: 'Quilltap General', mountType: 'database' as const }
    expect(buildGeneralContextContent(general)).toContain('Prospero would have you remember')
    const opaque = buildGeneralContextOpaqueContent(general)
    expect(opaque).toContain('Quilltap General')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Librarian
// ---------------------------------------------------------------------------

describe('Librarian opaque builders', () => {
  const openParams = {
    chatId: 'c-1',
    displayTitle: 'Notes',
    filePath: 'Notes.md',
    scope: 'project' as const,
    mountPoint: null,
    isNew: false,
    origin: { kind: 'opened-by-user' as const },
  }
  const renameParams = {
    chatId: 'c-1',
    oldDisplayTitle: 'Old',
    newDisplayTitle: 'New',
    oldFilePath: 'old.md',
    newFilePath: 'new.md',
    scope: 'project' as const,
    mountPoint: null,
  }
  const deleteParams = {
    chatId: 'c-1',
    displayTitle: 'Notes',
    filePath: 'Notes.md',
    scope: 'project' as const,
    mountPoint: null,
    origin: { kind: 'by-user' as const },
  }
  const folderCreatedParams = {
    chatId: 'c-1',
    folderPath: 'drafts/',
    scope: 'project' as const,
    mountPoint: null,
    origin: { kind: 'by-user' as const },
  }
  const folderDeletedParams = {
    ...folderCreatedParams,
  }
  const attachParams = {
    chatId: 'c-1',
    displayTitle: 'Photo',
    filePath: 'photo.png',
    mountPoint: null,
    mountFileId: 'mf-1',
    mimeType: 'image/png',
    description: 'A sepia portrait.',
  }
  const uploadParams = {
    chatId: 'c-1',
    uploads: [{ fileId: 'f-1', filename: 'pic.png' }],
  }

  it('open', () => {
    expect(buildOpenContent(openParams)).toContain('The Librarian has set out')
    const opaque = buildOpenOpaqueContent(openParams)
    expect(opaque).toContain('Document opened: "Notes"')
    expectNoPersonaNames(opaque)
  })

  it('rename', () => {
    expect(buildRenameContent(renameParams)).toContain('The Librarian has rechristened')
    const opaque = buildRenameOpaqueContent(renameParams)
    expect(opaque).toContain('Document renamed')
    expect(opaque).toContain('Old')
    expect(opaque).toContain('New')
    expectNoPersonaNames(opaque)
  })

  it('save', () => {
    const diff = 'I\'ve made changes to "Notes":\n\n```diff\n+ line\n```'
    expect(buildSaveContent(diff)).toContain('The Librarian has filed')
    const opaque = buildSaveOpaqueContent(diff)
    expect(opaque).toContain('The following changes were filed')
    expect(opaque).toContain('+ line')
    expectNoPersonaNames(opaque)
  })

  it('delete', () => {
    expect(buildDeleteContent(deleteParams)).toContain('The Librarian has removed')
    const opaque = buildDeleteOpaqueContent(deleteParams)
    expect(opaque).toContain('Document removed: "Notes"')
    expectNoPersonaNames(opaque)
  })

  it('folder created/deleted', () => {
    expect(buildFolderCreatedContent(folderCreatedParams)).toContain('The Librarian has set aside')
    const created = buildFolderCreatedOpaqueContent(folderCreatedParams)
    expect(created).toContain('Folder created: "drafts/"')
    expectNoPersonaNames(created)

    expect(buildFolderDeletedContent(folderDeletedParams)).toContain('The Librarian has dismantled')
    const deleted = buildFolderDeletedOpaqueContent(folderDeletedParams)
    expect(deleted).toContain('Folder removed: "drafts/"')
    expectNoPersonaNames(deleted)
  })

  it('attach', () => {
    expect(buildAttachContent(attachParams)).toContain('The user has bid the Librarian')
    const opaque = buildAttachOpaqueContent(attachParams)
    expect(opaque).toContain('Image attached: "Photo"')
    expect(opaque).toContain('A sepia portrait.')
    expectNoPersonaNames(opaque)
  })

  it('upload', () => {
    expect(buildUploadContent(uploadParams)).toContain('The Librarian has catalogued')
    const opaque = buildUploadOpaqueContent(uploadParams)
    expect(opaque).toContain('The user has uploaded')
    expect(opaque).toContain('pic.png')
    expectNoPersonaNames(opaque)
  })

  it('summary', () => {
    expect(buildSummaryContent('It was a foggy night.')).toContain('The Librarian deposits')
    const opaque = buildSummaryOpaqueContent('It was a foggy night.')
    expect(opaque).toContain('Précis of the conversation')
    expect(opaque).toContain('It was a foggy night.')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Concierge
// ---------------------------------------------------------------------------

describe('Concierge opaque builder', () => {
  it('danger advisory', () => {
    expect(buildDangerContent()).toContain('The Concierge')
    const opaque = buildDangerOpaqueContent()
    expect(opaque).toContain('Content advisory')
    expectNoPersonaNames(opaque)
  })
})
