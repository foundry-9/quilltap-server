/**
 * The listing→tree mapper must key nodes by the canonical scheme, carry
 * size/mtime, and — crucially — synthesize any missing ancestor folders so a
 * nested file is never orphaned when the listing didn't enumerate every
 * intermediate directory.
 */

import { listingToTree } from '@/components/files/svar/listing-to-tree'
import type { MountListing } from '@/components/files/svar/listing-to-tree'
import type { DocMountFileLinkWithContent } from '@/lib/schemas/mount-index.types'

const MOUNT = 'mount-x'

function file(relativePath: string, over: Partial<DocMountFileLinkWithContent> = {}): DocMountFileLinkWithContent {
  return {
    id: 'l-' + relativePath,
    fileId: 'f-' + relativePath,
    mountPointId: MOUNT,
    // mountPointId is part of the record but NOT the node id (mount-relative paths)
    relativePath,
    fileName: relativePath.split('/').pop()!,
    description: '',
    conversionStatus: 'converted',
    extractionStatus: 'converted',
    chunkCount: 0,
    lastModified: '2026-06-01T12:00:00.000Z',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    sha256: 'a'.repeat(64),
    fileSizeBytes: 1234,
    fileType: 'markdown',
    source: 'database',
    ...over,
  } as DocMountFileLinkWithContent
}

describe('listingToTree', () => {
  it('keys nodes by the mount-relative path and carries size + date', () => {
    const listing: MountListing = { files: [file('notes.md')], folders: [] }
    const nodes = listingToTree(listing)
    expect(nodes).toContainEqual({
      id: `/notes.md`,
      type: 'file',
      size: 1234,
      date: new Date('2026-06-01T12:00:00.000Z'),
    })
  })

  it('synthesizes missing ancestor folders for a deep file', () => {
    // Listing has the file but NOT its intermediate folders.
    const listing: MountListing = { files: [file('a/b/c/deep.md')], folders: [] }
    const ids = listingToTree(listing).map((n) => n.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        `/a`,
        `/a/b`,
        `/a/b/c`,
        `/a/b/c/deep.md`,
      ])
    )
  })

  it('includes explicitly-listed empty folders (and their ancestors)', () => {
    const listing: MountListing = { files: [], folders: ['x/y'] }
    const folderIds = listingToTree(listing)
      .filter((n) => n.type === 'folder')
      .map((n) => n.id)
    expect(folderIds).toEqual(expect.arrayContaining([`/x`, `/x/y`]))
  })

  it('emits folders shallowest-first so SVAR sees parents before children', () => {
    const listing: MountListing = { files: [file('a/b/c/deep.md')], folders: [] }
    const folders = listingToTree(listing).filter((n) => n.type === 'folder')
    const depths = folders.map((n) => n.id.split('/').length)
    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('leaves date undefined for an unparseable mtime', () => {
    const listing: MountListing = { files: [file('bad.md', { lastModified: 'not-a-date' as never })], folders: [] }
    const node = listingToTree(listing).find((n) => n.id.endsWith('bad.md'))!
    expect(node.date).toBeUndefined()
  })
})
