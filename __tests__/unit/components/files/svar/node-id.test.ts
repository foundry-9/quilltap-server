/**
 * The node id is the mount-relative path as a SVAR absolute path (the mount id
 * lives in config, not the string — prefixing it orphaned the tree). It must
 * round-trip losslessly, keep a clean top-level basename for SVAR's name
 * derivation, and the relative-path helpers must agree on separators/edges.
 */

import {
  relPathToNodeId,
  nodeIdToRelPath,
  relDirname,
  relBasename,
  relJoin,
  extOf,
  encodeRelPath,
} from '@/components/files/svar/node-id'

describe('node-id round-trip', () => {
  it.each([
    ['Research/dossier.pdf'],
    ['notes.md'],
    ['Research/Figures/map.png'],
    [''], // mount root
  ])('round-trips relativePath %p', (rel) => {
    expect(nodeIdToRelPath(relPathToNodeId(rel))).toBe(rel)
  })

  it('keeps a clean basename for a top-level node (no prefix leak)', () => {
    // SVAR derives the name from the last "/"-segment of the id.
    expect(relPathToNodeId('notes.md').split('/').pop()).toBe('notes.md')
  })

  it('makes top-level items one-segment absolute paths (SVAR root children)', () => {
    expect(relPathToNodeId('Research')).toBe('/Research')
    expect(relPathToNodeId('Research/dossier.pdf')).toBe('/Research/dossier.pdf')
  })

  it('represents the mount root as /', () => {
    expect(relPathToNodeId('')).toBe('/')
    expect(nodeIdToRelPath('/')).toBe('')
  })
})

describe('relative-path helpers', () => {
  it('relDirname', () => {
    expect(relDirname('a/b/c.txt')).toBe('a/b')
    expect(relDirname('top.txt')).toBe('')
    expect(relDirname('a/b/')).toBe('a')
  })
  it('relBasename', () => {
    expect(relBasename('a/b/c.txt')).toBe('c.txt')
    expect(relBasename('top.txt')).toBe('top.txt')
  })
  it('relJoin', () => {
    expect(relJoin('a/b', 'c.txt')).toBe('a/b/c.txt')
    expect(relJoin('', 'c.txt')).toBe('c.txt')
    expect(relJoin('a/', 'c.txt')).toBe('a/c.txt')
  })
  it('extOf is lower-cased, dotless, and ignores leading-dot names', () => {
    expect(extOf('a/b/Report.PDF')).toBe('pdf')
    expect(extOf('archive.tar.gz')).toBe('gz')
    expect(extOf('README')).toBe('')
    expect(extOf('.gitignore')).toBe('')
  })
  it('encodeRelPath percent-encodes each segment but keeps slashes', () => {
    expect(encodeRelPath('My Folder/a+b & c.md')).toBe('My%20Folder/a%2Bb%20%26%20c.md')
    expect(encodeRelPath('/leading/slash.md')).toBe('leading/slash.md')
  })
})
