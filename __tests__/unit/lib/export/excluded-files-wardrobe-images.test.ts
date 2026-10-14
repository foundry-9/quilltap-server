/**
 * A wardrobe item's picture is an ordinary IMAGE `files` row with no folder
 * path; the one export-exclusion predicate must let it through, or the
 * picture metadata would vanish from every `.qtap` bundle.
 */

import { describe, expect, it } from '@jest/globals'
import { isFileExcludedFromExport } from '@/lib/export/excluded-files'

describe('isFileExcludedFromExport — wardrobe pictures', () => {
  it('does not exclude an IMAGE-category wardrobe image row', () => {
    expect(isFileExcludedFromExport({ category: 'IMAGE', folderPath: null })).toBe(false)
  })

  it('still excludes backups and archives', () => {
    expect(isFileExcludedFromExport({ category: 'BACKUP', folderPath: null })).toBe(true)
    expect(isFileExcludedFromExport({ category: 'IMAGE', folderPath: '/archives' })).toBe(true)
  })
})
