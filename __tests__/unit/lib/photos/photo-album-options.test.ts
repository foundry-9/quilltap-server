/**
 * @jest-environment node
 */
/**
 * listAllPhotoAlbumOptions — every store a wardrobe picture may be filed in.
 */

import { listAllPhotoAlbumOptions } from '@/lib/photos/photo-album-options'
import { getGeneralMountPointId } from '@/lib/instance-settings'
import { getArchivedCharacterVaultMountPointIds } from '@/lib/mount-index/character-vault'

jest.mock('@/lib/logger', () => {
  const base: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  base.child = jest.fn(() => base)
  return { logger: base }
})

jest.mock('@/lib/instance-settings', () => ({
  getGeneralMountPointId: jest.fn(),
}))

jest.mock('@/lib/mount-index/character-vault', () => ({
  getArchivedCharacterVaultMountPointIds: jest.fn(),
}))

const mockGeneralId = getGeneralMountPointId as jest.Mock
const mockArchived = getArchivedCharacterVaultMountPointIds as jest.Mock

function repos(mountPoints: Array<{ id: string; name: string; storeType?: string }>) {
  return {
    docMountPoints: { findEnabled: jest.fn(async () => mountPoints) },
    characters: {
      findAllRaw: jest.fn(async () => [
        { id: 'char-ada', name: 'Ada', controlledBy: 'user', characterDocumentMountPointId: 'mp-ada' },
        { id: 'char-bea', name: 'Bea', controlledBy: 'llm', characterDocumentMountPointId: 'mp-bea' },
        {
          id: 'char-old',
          name: 'Old',
          controlledBy: 'llm',
          characterDocumentMountPointId: 'mp-old',
          archivedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    },
    projects: { findAll: jest.fn(async () => [{ id: 'proj-1', officialMountPointId: 'mp-project' }]) },
  } as never
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGeneralId.mockResolvedValue('mp-general')
  mockArchived.mockResolvedValue(['mp-old'])
})

describe('listAllPhotoAlbumOptions', () => {
  it('classifies every enabled store, skips archived vaults, and defaults to General', async () => {
    const options = await listAllPhotoAlbumOptions(
      repos([
        { id: 'mp-notes', name: 'Notes', storeType: 'documents' },
        { id: 'mp-general', name: 'Quilltap General', storeType: 'documents' },
        { id: 'mp-bea', name: 'Bea Character Vault', storeType: 'character' },
        { id: 'mp-old', name: 'Old Character Vault', storeType: 'character' },
        { id: 'mp-project', name: 'Thornfield', storeType: 'documents' },
        { id: 'mp-ada', name: 'Ada Character Vault', storeType: 'character' },
      ]),
    )

    expect(options).toEqual([
      { mountPointId: 'mp-ada', name: 'Ada', kind: 'character', characterId: 'char-ada', isUserCharacter: true },
      { mountPointId: 'mp-bea', name: 'Bea', kind: 'character', characterId: 'char-bea', isUserCharacter: false },
      { mountPointId: 'mp-project', name: 'Thornfield', kind: 'project' },
      { mountPointId: 'mp-notes', name: 'Notes', kind: 'document-store' },
      { mountPointId: 'mp-general', name: 'Quilltap General', kind: 'general', isDefault: true },
    ])
  })

  it('defaults to the first option when there is no General store', async () => {
    mockGeneralId.mockResolvedValue(null)
    const options = await listAllPhotoAlbumOptions(repos([{ id: 'mp-notes', name: 'Notes' }]))
    expect(options).toEqual([{ mountPointId: 'mp-notes', name: 'Notes', kind: 'document-store', isDefault: true }])
  })
})
