/**
 * @jest-environment node
 *
 * Brahma Console attachments — the pure naming and placement rules.
 */

import {
  freeAttachmentName,
  pastedAttachmentName,
  isDirectlyUnderBrahma,
  sanitizeAttachmentName,
  collectAttachmentIds,
} from '../attachments'

describe('freeAttachmentName', () => {
  it('keeps a free name', () => {
    expect(freeAttachmentName('notes.md', new Set(['other.md']))).toBe('notes.md')
  })

  it('bumps with -2, -3, compared case-insensitively', () => {
    expect(freeAttachmentName('Notes.md', new Set(['notes.md']))).toBe('Notes-2.md')
    expect(freeAttachmentName('notes.md', new Set(['notes.md', 'NOTES-2.md']))).toBe('notes-3.md')
  })

  it('counts the transcoded spelling as taken too', () => {
    expect(freeAttachmentName('photo.png', new Set(['photo.webp']), '.webp')).toBe('photo-2.png')
  })

  it('handles a name with no extension', () => {
    expect(freeAttachmentName('README', new Set(['readme']))).toBe('README-2')
  })
})

describe('pastedAttachmentName', () => {
  it('stamps the instance calendar', () => {
    const ms = Date.UTC(2026, 10, 12, 23, 5, 9)
    expect(pastedAttachmentName(ms, 'UTC', 'png')).toBe('pasted-20261112-230509.png')
    expect(pastedAttachmentName(ms, 'Asia/Tokyo', '.webp')).toBe('pasted-20261113-080509.webp')
  })
})

describe('sanitizeAttachmentName', () => {
  it('reduces a name to one safe segment', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeAttachmentName('a\\b\\.hidden')).toBe('hidden')
    expect(sanitizeAttachmentName('...')).toBe('unnamed')
  })
})

describe('isDirectlyUnderBrahma', () => {
  it('accepts a file directly in Brahma/', () => {
    expect(isDirectlyUnderBrahma('Brahma/photo.webp')).toBe(true)
    expect(isDirectlyUnderBrahma('brahma/photo.webp')).toBe(true)
  })

  it('refuses anything moved elsewhere', () => {
    expect(isDirectlyUnderBrahma('Brahma/kept/photo.webp')).toBe(false)
    expect(isDirectlyUnderBrahma('Elsewhere/photo.webp')).toBe(false)
    expect(isDirectlyUnderBrahma('Brahma/')).toBe(false)
    expect(isDirectlyUnderBrahmaSafe('BrahmaX/photo.webp')).toBe(false)
  })
})

function isDirectlyUnderBrahmaSafe(p: string) {
  return isDirectlyUnderBrahma(p)
}

describe('collectAttachmentIds', () => {
  it('collects message attachments in order, de-duplicated', () => {
    expect(collectAttachmentIds([
      { type: 'message', attachments: ['a', 'b'] },
      { type: 'context-summary', attachments: ['x'] },
      { type: 'message', attachments: ['b', 'c'] },
      { type: 'message', attachments: null },
    ])).toEqual(['a', 'b', 'c'])
  })
})
