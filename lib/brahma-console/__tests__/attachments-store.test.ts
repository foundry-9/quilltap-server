/**
 * @jest-environment node
 *
 * Brahma Console attachments — storing under Brahma/ in Quilltap General
 * (free names, the store-file chokepoint), and deleting only what still sits
 * directly under Brahma/ (a moved file is the operator's and is kept).
 */

jest.mock('@/lib/mount-index/reach', () => ({ resolveOwnerStore: jest.fn() }))
jest.mock('@/lib/mount-index/store-file', () => ({ storeMountFile: jest.fn() }))
jest.mock('@/lib/instance-settings', () => ({ getGeneralMountPointId: jest.fn() }))
jest.mock('@/lib/documents/core', () => ({ deleteDocument: jest.fn() }))
jest.mock('@/lib/documents/operator-doc-actions', () => ({
  STANDALONE_ACCESS_CONTEXT: { characterIds: [] },
  resolveOperatorDocPath: jest.fn(async (_c: unknown, p: { scope: string; mountPoint?: string; filePath: string }) => ({ scope: p.scope, mountPointName: p.mountPoint, relativePath: p.filePath })),
}))
jest.mock('@/lib/doc-edit/uri-producers', () => ({ docStoreUriFor: jest.fn() }))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { storeConsoleAttachment, discardConsoleAttachment, deleteConsoleAttachmentsForChat } from '../attachments'
import { resolveOwnerStore } from '@/lib/mount-index/reach'
import { storeMountFile } from '@/lib/mount-index/store-file'
import { getGeneralMountPointId } from '@/lib/instance-settings'
import { deleteDocument } from '@/lib/documents/core'
import { resolveOperatorDocPath } from '@/lib/documents/operator-doc-actions'
import { getRepositories } from '@/lib/repositories/factory'

const GENERAL = 'general-mp'

const links: Record<string, { id: string; mountPointId: string; relativePath: string; fileName: string }> = {
  inBrahma: { id: 'inBrahma', mountPointId: GENERAL, relativePath: 'Brahma/a.webp', fileName: 'a.webp' },
  moved: { id: 'moved', mountPointId: GENERAL, relativePath: 'Keepers/b.pdf', fileName: 'b.pdf' },
  otherStore: { id: 'otherStore', mountPointId: 'elsewhere', relativePath: 'Brahma/c.md', fileName: 'c.md' },
}

function makeRepos() {
  return {
    docMountPoints: {
      findById: jest.fn(async (id: string) => (id === GENERAL ? { id: GENERAL, name: 'Quilltap General' } : null)),
    },
    docMountFileLinks: {
      findByIdWithContent: jest.fn(async (id: string) => links[id] ?? null),
      listForBrowser: jest.fn(async () => [
        { relativePath: 'Brahma/notes.md' },
        { relativePath: 'Brahma/photo.webp' },
        { relativePath: 'Brahma/deeper/notes-2.md' },
      ]),
    },
    chats: {
      getMessages: jest.fn(async () => [
        { type: 'message', attachments: ['inBrahma', 'moved'] },
        { type: 'message', attachments: ['otherStore', 'gone', 'inBrahma'] },
      ]),
    },
  }
}

let repos: ReturnType<typeof makeRepos>

beforeEach(() => {
  jest.clearAllMocks()
  repos = makeRepos()
  jest.mocked(getRepositories).mockReturnValue(repos as never)
  jest.mocked(getGeneralMountPointId).mockResolvedValue(GENERAL)
  jest.mocked(resolveOwnerStore).mockResolvedValue({ scope: 'general', mountPointId: GENERAL, owner: { id: null, name: 'Quilltap General' } })
  jest.mocked(deleteDocument).mockResolvedValue('deleted')
  jest.mocked(storeMountFile).mockImplementation(async (input) => ({
    mountPointId: input.mountPointId,
    relativePath: input.relativePath.replace(/\.png$/, '.webp'),
    kind: 'blob',
    fileType: 'image',
    sha256: 'x',
    sizeBytes: input.data.length,
    storedMimeType: input.relativePath.endsWith('.png') ? 'image/webp' : (input.originalMimeType ?? 'application/octet-stream'),
    mtime: 1,
    linkId: 'new-link',
    fileId: 'f',
  }) as never)
})

describe('storeConsoleAttachment', () => {
  it('provisions Brahma/ in General and picks a free flat name', async () => {
    const out = await storeConsoleAttachment({ bytes: Buffer.from('hi'), filename: 'notes.md', mimeType: 'text/markdown', userId: 'u1', repos: repos as never })
    expect(jest.mocked(resolveOwnerStore).mock.calls[0][4]).toMatchObject({ ensure: { folder: 'Brahma' } })
    expect(jest.mocked(storeMountFile).mock.calls[0][0]).toMatchObject({ mountPointId: GENERAL, relativePath: 'Brahma/notes-2.md' })
    expect(out).toMatchObject({ id: 'new-link', path: 'Brahma/notes-2.md', filename: 'notes-2.md', isImage: false })
  })

  it('counts the transcoded name as taken, and the stored name follows the stored bytes', async () => {
    const out = await storeConsoleAttachment({ bytes: Buffer.from('png'), filename: 'photo.png', mimeType: 'image/png', userId: 'u1', repos: repos as never })
    expect(jest.mocked(storeMountFile).mock.calls[0][0].relativePath).toBe('Brahma/photo-2.png')
    expect(out).toMatchObject({ path: 'Brahma/photo-2.webp', mimeType: 'image/webp', isImage: true })
    expect(jest.mocked(storeMountFile).mock.calls[0][0].originalFileName).toBe('photo.png')
  })

  it('names a nameless paste on the instance calendar', async () => {
    await storeConsoleAttachment({ bytes: Buffer.from('png'), filename: 'image.png', mimeType: 'image/png', userId: 'u1', repos: repos as never })
    expect(jest.mocked(storeMountFile).mock.calls[0][0].relativePath).toMatch(/^Brahma\/pasted-\d{8}-\d{6}\.png$/)
  })

  it('keeps a hostile filename inside Brahma/', async () => {
    await storeConsoleAttachment({ bytes: Buffer.from('x'), filename: '../../secrets/../x.txt', mimeType: 'text/plain', userId: 'u1', repos: repos as never })
    expect(jest.mocked(storeMountFile).mock.calls[0][0].relativePath).toBe('Brahma/x.txt')
  })
})

describe('discardConsoleAttachment', () => {
  it('deletes a file still directly under Brahma/, resolved by the General store\'s name', async () => {
    await expect(discardConsoleAttachment('inBrahma', repos as never)).resolves.toBe('deleted')
    // Never the doc resolver's `general` scope: that is the legacy on-disk
    // `_general` folder, where the attachment is not.
    expect(jest.mocked(resolveOperatorDocPath).mock.calls[0][1]).toEqual({
      scope: 'document_store',
      mountPoint: 'Quilltap General',
      filePath: 'Brahma/a.webp',
    })
    expect(deleteDocument).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'Brahma/a.webp' }))
  })

  it('keeps a file the operator moved', async () => {
    await expect(discardConsoleAttachment('moved', repos as never)).resolves.toBe('kept-moved')
    await expect(discardConsoleAttachment('otherStore', repos as never)).resolves.toBe('kept-moved')
    expect(deleteDocument).not.toHaveBeenCalled()
  })

  it('answers missing for a link that is gone', async () => {
    await expect(discardConsoleAttachment('gone', repos as never)).resolves.toBe('missing')
  })
})

describe('deleteConsoleAttachmentsForChat', () => {
  it('deletes what is still under Brahma/ and spares the rest', async () => {
    const out = await deleteConsoleAttachmentsForChat(repos as never, 'chat-1')
    expect(out).toEqual({ deleted: 1, kept: 2 })
    expect(deleteDocument).toHaveBeenCalledTimes(1)
  })

  it('never throws when a delete fails', async () => {
    jest.mocked(deleteDocument).mockRejectedValue(new Error('disk on fire'))
    await expect(deleteConsoleAttachmentsForChat(repos as never, 'chat-1')).resolves.toEqual({ deleted: 0, kept: 3 })
  })
})
