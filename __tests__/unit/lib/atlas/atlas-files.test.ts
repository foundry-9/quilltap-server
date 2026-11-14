/**
 * @jest-environment node
 *
 * The Atlas's files (atlas spec §5.1–5.2): one Markdown file per entry,
 * frontmatter for the fields and the body for the knowledge; a note and a
 * duplicate-id file survive every write; unknown keys are dropped.
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
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }))

import { GENERAL_MP, pathsIn, putDoc, resetStore, state } from '@/__tests__/helpers/inventory-fake-store'
import { parseAtlasEntryFile, scanAtlasFolder } from '@/lib/atlas/vault-readers'
import { createAtlasInMount, serializeAtlasRecord, updateAtlasManyInMount } from '@/lib/atlas/vault-writes'
import { isAtlasEntryDocumentPath } from '@/lib/atlas/folders'
import type { AtlasRecord } from '@/lib/schemas/atlas.types'

const ID = 'a1111111-1111-4111-8111-111111111111'
const STAMP = '2026-11-10T00:00:00.000Z'
const mount = { mountPointId: GENERAL_MP, scope: 'general' as const, characterId: null }

const record = (fields: Partial<AtlasRecord> = {}): AtlasRecord => ({
  id: ID,
  name: 'Convertible',
  aliases: ['lander', 'car'],
  graphicPrompt: "A 1930's roadster, silver.",
  knowledge: '## History\n\nBought in *Monaco*.\n\n- fast\n- loud',
  imageFileId: null,
  metadata: { era: 'jazz' },
  folder: '',
  archivedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  ...fields,
})

beforeEach(() => resetStore())

describe('paths', () => {
  it('takes .md files under Atlas/ at any depth, never under images/', () => {
    expect(isAtlasEntryDocumentPath('Atlas/Convertible.md')).toBe(true)
    expect(isAtlasEntryDocumentPath('Atlas/Vehicles/Cars/Convertible.md')).toBe(true)
    expect(isAtlasEntryDocumentPath('atlas/x.md')).toBe(true)
    expect(isAtlasEntryDocumentPath('Atlas/images/abc/pic.md')).toBe(false)
    expect(isAtlasEntryDocumentPath('Atlas/Convertible.json')).toBe(false)
    expect(isAtlasEntryDocumentPath('Notes/Convertible.md')).toBe(false)
  })
})

describe('round trip', () => {
  it('serialises frontmatter in schema order and the knowledge as the body, verbatim', () => {
    const text = serializeAtlasRecord(record())
    expect(text.startsWith('---\nid: ')).toBe(true)
    expect(text).toContain('\n---\n\n## History\n\nBought in *Monaco*.')
    expect(text).not.toContain('knowledge:')
    expect(text).not.toContain('folder:')
    const back = parseAtlasEntryFile({ relativePath: 'Atlas/Vehicles/Convertible.md', content: text })
    expect(back).toMatchObject({ ...record(), folder: 'Vehicles', fileStem: 'Convertible' })
  })

  it('reads an empty body as no knowledge', () => {
    const text = serializeAtlasRecord(record({ knowledge: null }))
    expect(parseAtlasEntryFile({ relativePath: 'Atlas/C.md', content: text })?.knowledge).toBeNull()
  })

  it('drops unknown frontmatter keys and ignores a folder key (the path wins)', () => {
    const text = `---\nid: ${ID}\nname: Convertible\ncolour: silver\nfolder: Elsewhere\n---\nBody.\n`
    const parsed = parseAtlasEntryFile({ relativePath: 'Atlas/Here/C.md', content: text })
    expect(parsed).not.toBeNull()
    expect((parsed as unknown as Record<string, unknown>).colour).toBeUndefined()
    expect(parsed?.folder).toBe('Here')
    expect(parsed?.knowledge).toBe('Body.')
  })

  it('normalises aliases on read: trimmed, de-duplicated, never the name', () => {
    const text = `---\nid: ${ID}\nname: Convertible\naliases: [' car ', 'Car', 'convertible', '']\n---\n`
    expect(parseAtlasEntryFile({ relativePath: 'Atlas/C.md', content: text })?.aliases).toEqual(['car'])
  })

  it('treats a file with no UUID id as a note', () => {
    expect(parseAtlasEntryFile({ relativePath: 'Atlas/README.md', content: '# Notes on the world\n' })).toBeNull()
    expect(parseAtlasEntryFile({ relativePath: 'Atlas/N.md', content: '---\nid: nope\nname: X\n---\n' })).toBeNull()
  })
})

describe('writes', () => {
  it('a note and a duplicate-id file survive a write', async () => {
    putDoc(GENERAL_MP, 'Atlas/README.md', '# A note kept beside the entries\n')
    await createAtlasInMount(mount, record())
    putDoc(GENERAL_MP, 'Atlas/Copy of Convertible.md', serializeAtlasRecord(record({ name: 'Convertible copy' })))
    await updateAtlasManyInMount(mount, [{ id: ID, patch: { graphicPrompt: 'Gold, now.' } }])

    expect(pathsIn(GENERAL_MP)).toEqual(['Atlas/Convertible.md', 'Atlas/Copy of Convertible.md', 'Atlas/README.md'])
    const scan = await scanAtlasFolder(GENERAL_MP)
    expect(scan.records).toHaveLength(1)
    expect(scan.records[0].graphicPrompt).toBe('Gold, now.')
    expect(scan.duplicatePaths.has('Atlas/Copy of Convertible.md')).toBe(true)
  })

  it('files an entry under its folder and renames the file with its name', async () => {
    await createAtlasInMount(mount, record({ folder: 'Vehicles' }))
    await updateAtlasManyInMount(mount, [{ id: ID, patch: { name: 'Roadster' } }])
    expect(pathsIn(GENERAL_MP)).toEqual(['Atlas/Vehicles/Roadster.md'])
    expect(state.docs.get(`${GENERAL_MP}::Atlas/Vehicles/Roadster.md`)).toContain('name: Roadster')
  })
})
