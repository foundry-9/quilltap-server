/**
 * The post-copy reindex decision must fire ONLY for a cross-storage byte-copy
 * of an extractable type (the fs→db .pdf/.docx gap), and skip link/rename
 * strategies and non-extractable types — so a one-file drag never triggers a
 * mount-wide rebuild or a redundant job.
 */

import { reindexAfterCopy } from '@/components/files/svar/reindex-after-copy'

const DEST = 'dest-mount'

describe('reindexAfterCopy', () => {
  it('targets the dest path for a byte-copied .pdf', () => {
    expect(reindexAfterCopy({ strategy: 'byte-copy', destMountPointId: DEST, destPath: 'docs/report.pdf' }))
      .toEqual({ mountId: DEST, path: 'docs/report.pdf' })
  })

  it('targets a byte-copied .docx (case-insensitive ext)', () => {
    expect(reindexAfterCopy({ strategy: 'byte-copy', destMountPointId: DEST, destPath: 'A/Contract.DOCX' }))
      .toEqual({ mountId: DEST, path: 'A/Contract.DOCX' })
  })

  it('skips non-extractable types even on a byte-copy', () => {
    expect(reindexAfterCopy({ strategy: 'byte-copy', destMountPointId: DEST, destPath: 'img/photo.png' })).toBeNull()
    expect(reindexAfterCopy({ strategy: 'byte-copy', destMountPointId: DEST, destPath: 'notes.md' })).toBeNull()
  })

  it.each(['db-link', 'fs-link', 'rename'])('skips the %s strategy (nothing to re-extract)', (strategy) => {
    expect(reindexAfterCopy({ strategy, destMountPointId: DEST, destPath: 'docs/report.pdf' })).toBeNull()
  })
})
