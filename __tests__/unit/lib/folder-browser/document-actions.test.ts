/**
 * The pure half of the document-store browser: which viewer a file opens in
 * (`previewKindOf`, and `getPreviewType` as its caller) and which ⋮ actions a
 * row is granted (`documentFileActions` / `documentFolderActions`,
 * `canLinkBetween`).
 */

import { mimeTypeForName, previewKindOf } from '@/lib/folder-browser/preview-kind'
import {
  canLinkBetween,
  documentFileActions,
  documentFolderActions,
  documentPreviewKind,
  type BrowserStore,
} from '@/lib/folder-browser/document-actions'
import { getPreviewType } from '@/components/files/FilePreview/types'

const ALL = { canWrite: true, canDelete: true, canCreateFolder: true, canMoveIn: true, canMoveOut: true }
const NONE = { canWrite: false, canDelete: false, canCreateFolder: false, canMoveIn: false, canMoveOut: false }

const db = (id: string, capabilities = ALL): BrowserStore => ({ id, mountType: 'database', capabilities })
const fsStore = (id: string, capabilities = ALL): BrowserStore => ({ id, mountType: 'filesystem', capabilities })

describe('previewKindOf', () => {
  it('prefers the MIME type, then the stored type, then the extension', () => {
    expect(previewKindOf({ mimeType: 'image/webp', name: 'x.txt' })).toBe('image')
    expect(previewKindOf({ fileType: 'docx', name: 'report' })).toBe('docx')
    expect(previewKindOf({ fileType: 'blob', name: 'scan.PDF' })).toBe('pdf')
    expect(previewKindOf({ fileType: 'markdown', name: 'notes' })).toBe('markdown')
    expect(previewKindOf({ name: 'data.json' })).toBe('text')
    expect(previewKindOf({ name: 'archive.zip' })).toBe('unsupported')
  })

  it('ignores an octet-stream MIME type and falls back to plain-text detection', () => {
    expect(previewKindOf({ mimeType: 'application/octet-stream', name: 'photo.png' })).toBe('image')
    expect(previewKindOf({ mimeType: 'application/zip', isPlainText: true })).toBe('text')
  })

  it('maps names to MIME types', () => {
    expect(mimeTypeForName('a/b/c.MD')).toBe('text/markdown')
    expect(mimeTypeForName('noext')).toBe('application/octet-stream')
  })

  it('keeps getPreviewType to the viewers the file modal has', () => {
    expect(getPreviewType('text/markdown')).toBe('text')
    expect(getPreviewType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('unsupported')
    expect(getPreviewType('application/pdf')).toBe('pdf')
    expect(getPreviewType('', true)).toBe('text')
  })

  it('judges a store row by its original MIME type, stored type and name', () => {
    expect(documentPreviewKind({ relativePath: 'a.bin', fileName: 'a.bin', fileType: 'blob', originalMimeType: 'image/png' })).toBe('image')
  })
})

describe('canLinkBetween', () => {
  it('links database stores to any database store', () => {
    expect(canLinkBetween(db('a'), db('b'))).toBe(true)
  })

  it('links filesystem files only within their own store', () => {
    expect(canLinkBetween(fsStore('a'), fsStore('a'))).toBe(true)
    expect(canLinkBetween(fsStore('a'), fsStore('b'))).toBe(false)
  })

  it('never links across storage kinds, or into a store that cannot take it', () => {
    expect(canLinkBetween(db('a'), fsStore('b'))).toBe(false)
    expect(canLinkBetween(db('a'), db('b', NONE))).toBe(false)
  })
})

describe('documentFileActions', () => {
  const file = { relativePath: 'notes.md', fileName: 'notes.md', fileType: 'markdown', source: 'database' as const, linkCount: 1, linkGroupId: null }

  it('offers the full menu on a writable store', () => {
    expect(documentFileActions(db('a'), file, { linkTargets: true })).toEqual([
      'open', 'rename', 'move', 'copy', 'link', 'download', 'delete',
    ])
  })

  it('offers only viewing on a store that allows nothing', () => {
    expect(documentFileActions(db('a', NONE), file, { linkTargets: true })).toEqual(['open', 'download'])
  })

  it('adds the link entries for a hard-linked file and the description for a blob', () => {
    const linked = { ...file, fileType: 'pdf', linkCount: 2, linkGroupId: 'g' }
    const actions = documentFileActions(db('a'), linked, { linkTargets: false })
    expect(actions).toEqual(expect.arrayContaining(['show-links', 'unlink', 'describe']))
    expect(actions).not.toContain('link')
  })

  it('offers the Workbench for a root tool definition', () => {
    expect(documentFileActions(db('a'), { ...file, relativePath: 'Tools/dice.tool.json' }, { linkTargets: false })).toContain('workbench')
  })

  it('gates folder actions on the store', () => {
    expect(documentFolderActions(db('a'))).toEqual(['rename', 'move', 'copy', 'delete'])
    expect(documentFolderActions(db('a', NONE))).toEqual([])
  })
})
