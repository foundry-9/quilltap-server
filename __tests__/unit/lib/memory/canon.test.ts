/**
 * Unit tests for the canon block loader.
 * Tests lib/memory/cheap-llm-tasks/canon.ts
 */

import { describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  })
  return { logger: makeLogger() }
})

jest.mock('@/lib/database/repositories/character-properties-overlay', () => ({
  readVaultTextFile: jest.fn(),
}))

import { readVaultTextFile } from '@/lib/database/repositories/character-properties-overlay'
import {
  renderCanonBlock,
  loadCanonForSelf,
  loadCanonForObserverAboutSubject,
  NO_CANON_FALLBACK,
} from '@/lib/memory/cheap-llm-tasks/canon'

const mockReadVaultTextFile = readVaultTextFile as jest.MockedFunction<typeof readVaultTextFile>

describe('renderCanonBlock', () => {
  it('emits the heading with the body when body is present', () => {
    const out = renderCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      body: 'Friday is the operator of this instance.',
      source: 'identity',
    })
    expect(out).toBe('ALREADY ESTABLISHED about Friday\nFriday is the operator of this instance.')
  })

  it('substitutes the fallback line when body is null', () => {
    const out = renderCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      body: null,
      source: 'none',
    })
    expect(out).toBe(`ALREADY ESTABLISHED about Friday\n${NO_CANON_FALLBACK}`)
  })

  it('substitutes the fallback line when body is whitespace-only', () => {
    const out = renderCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      body: '   \n  \t\n  ',
      source: 'identity',
    })
    expect(out).toBe(`ALREADY ESTABLISHED about Friday\n${NO_CANON_FALLBACK}`)
  })

  it('trims the body before emitting', () => {
    const out = renderCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      body: '\n\n  Friday is the operator.  \n\n',
      source: 'identity',
    })
    expect(out).toBe('ALREADY ESTABLISHED about Friday\nFriday is the operator.')
  })
})

describe('loadCanonForSelf', () => {
  it('returns the identity verbatim when present', () => {
    const result = loadCanonForSelf({
      id: 'c1',
      name: 'Friday',
      identity: 'Operator of the Estate.',
    })
    expect(result).toEqual({
      characterId: 'c1',
      characterName: 'Friday',
      body: 'Operator of the Estate.',
      source: 'identity',
    })
  })

  it('returns source=none when identity is null', () => {
    const result = loadCanonForSelf({ id: 'c1', name: 'Friday', identity: null })
    expect(result.source).toBe('none')
    expect(result.body).toBeNull()
  })

  it('returns source=none when identity is empty', () => {
    const result = loadCanonForSelf({ id: 'c1', name: 'Friday', identity: '' })
    expect(result.source).toBe('none')
    expect(result.body).toBeNull()
  })

  it('returns source=none when identity is whitespace-only', () => {
    const result = loadCanonForSelf({ id: 'c1', name: 'Friday', identity: '  \n\t  ' })
    expect(result.source).toBe('none')
    expect(result.body).toBeNull()
  })

  it('does not consult the vault', async () => {
    mockReadVaultTextFile.mockClear()
    loadCanonForSelf({ id: 'c1', name: 'Friday', identity: 'x' })
    expect(mockReadVaultTextFile).not.toHaveBeenCalled()
  })
})

describe('loadCanonForObserverAboutSubject', () => {
  beforeEach(() => {
    mockReadVaultTextFile.mockReset()
  })

  it('returns vault content when Others/<sanitized-name>.md exists', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce('Charlie is wary of strangers.')
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: 'Generic identity.' },
    )
    expect(mockReadVaultTextFile).toHaveBeenCalledWith('mp-amy', 'Others/Charlie.md', 'amy')
    expect(result).toEqual({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'Charlie is wary of strangers.',
      source: 'vault',
    })
  })

  it('sanitizes subject names with filesystem-unsafe characters', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'b', name: 'Mr/Mrs "Smith":?<>', identity: null },
    )
    expect(mockReadVaultTextFile).toHaveBeenCalledWith('mp-amy', 'Others/Mr_Mrs _Smith_____.md', 'amy')
  })

  it('falls back to identity when vault returns null', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: 'The estate principal.' },
    )
    expect(result).toEqual({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'The estate principal.',
      source: 'identity',
    })
  })

  it('falls back to identity when vault returns empty string', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce('   \n  ')
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: 'The estate principal.' },
    )
    expect(result.source).toBe('identity')
    expect(result.body).toBe('The estate principal.')
  })

  it('returns source=none when both vault and identity are absent', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: null },
    )
    expect(result.source).toBe('none')
    expect(result.body).toBeNull()
  })

  it('skips the vault lookup entirely when observer has no mountPointId', async () => {
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: null },
      { id: 'charlie', name: 'Charlie', identity: 'The estate principal.' },
    )
    expect(mockReadVaultTextFile).not.toHaveBeenCalled()
    expect(result.source).toBe('identity')
    expect(result.body).toBe('The estate principal.')
  })
})
