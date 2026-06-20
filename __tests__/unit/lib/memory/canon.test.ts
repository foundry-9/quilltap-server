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
  renderSelfCanonBlock,
  renderOtherCanonBlock,
  loadCanonForSelf,
  loadCanonForObserverAboutSubject,
  NO_CANON_FALLBACK,
} from '@/lib/memory/cheap-llm-tasks/canon'

const mockReadVaultTextFile = readVaultTextFile as jest.MockedFunction<typeof readVaultTextFile>

describe('renderSelfCanonBlock', () => {
  it('emits all four fields, labelled, manifesto-first', () => {
    const out = renderSelfCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      manifesto: 'I serve the Estate.',
      personality: 'Dry, precise, loyal.',
      description: 'Speaks in clipped sentences.',
      identity: 'Operator of the Estate.',
    })
    expect(out).toBe(
      'ALREADY ESTABLISHED about Friday\n' +
        '[MANIFESTO] I serve the Estate.\n' +
        '[PERSONALITY] Dry, precise, loyal.\n' +
        '[DESCRIPTION] Speaks in clipped sentences.\n' +
        '[IDENTITY] Operator of the Estate.',
    )
  })

  it('omits empty fields but preserves order of the present ones', () => {
    const out = renderSelfCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      manifesto: 'I serve the Estate.',
      personality: null,
      description: '   ',
      identity: 'Operator of the Estate.',
    })
    expect(out).toBe(
      'ALREADY ESTABLISHED about Friday\n' +
        '[MANIFESTO] I serve the Estate.\n' +
        '[IDENTITY] Operator of the Estate.',
    )
  })

  it('trims each field before emitting', () => {
    const out = renderSelfCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      manifesto: '\n\n  I serve.  \n',
      personality: null,
      description: null,
      identity: null,
    })
    expect(out).toBe('ALREADY ESTABLISHED about Friday\n[MANIFESTO] I serve.')
  })

  it('substitutes the fallback line when every field is empty', () => {
    const out = renderSelfCanonBlock({
      characterId: 'c1',
      characterName: 'Friday',
      manifesto: null,
      personality: '',
      description: '   \n  ',
      identity: null,
    })
    expect(out).toBe(`ALREADY ESTABLISHED about Friday\n${NO_CANON_FALLBACK}`)
  })
})

describe('renderOtherCanonBlock', () => {
  it('emits the raw body (no field label) when the source is the vault', () => {
    const out = renderOtherCanonBlock({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'Charlie is wary of strangers.',
      source: 'vault',
    })
    expect(out).toBe('ALREADY ESTABLISHED about Charlie\nCharlie is wary of strangers.')
  })

  it('labels the identity fallback', () => {
    const out = renderOtherCanonBlock({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'The estate principal.',
      source: 'identity',
    })
    expect(out).toBe('ALREADY ESTABLISHED about Charlie\n[IDENTITY] The estate principal.')
  })

  it('labels the description fallback', () => {
    const out = renderOtherCanonBlock({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'Gestures broadly when excited.',
      source: 'description',
    })
    expect(out).toBe('ALREADY ESTABLISHED about Charlie\n[DESCRIPTION] Gestures broadly when excited.')
  })

  it('substitutes the fallback line when nothing is on file', () => {
    const out = renderOtherCanonBlock({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: null,
      source: 'none',
    })
    expect(out).toBe(`ALREADY ESTABLISHED about Charlie\n${NO_CANON_FALLBACK}`)
  })
})

describe('loadCanonForSelf', () => {
  it('threads every vantage-point field through, no vault lookup', () => {
    mockReadVaultTextFile.mockClear()
    const result = loadCanonForSelf({
      id: 'c1',
      name: 'Friday',
      manifesto: 'I serve.',
      personality: 'Dry.',
      description: 'Clipped.',
      identity: 'Operator.',
    })
    expect(result).toEqual({
      characterId: 'c1',
      characterName: 'Friday',
      manifesto: 'I serve.',
      personality: 'Dry.',
      description: 'Clipped.',
      identity: 'Operator.',
    })
    expect(mockReadVaultTextFile).not.toHaveBeenCalled()
  })

  it('preserves null fields', () => {
    const result = loadCanonForSelf({
      id: 'c1',
      name: 'Friday',
      manifesto: null,
      personality: null,
      description: null,
      identity: null,
    })
    expect(result.manifesto).toBeNull()
    expect(result.personality).toBeNull()
    expect(result.description).toBeNull()
    expect(result.identity).toBeNull()
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
      { id: 'charlie', name: 'Charlie', identity: 'Generic identity.', description: 'Generic description.' },
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
      { id: 'b', name: 'Mr/Mrs "Smith":?<>', identity: null, description: null },
    )
    expect(mockReadVaultTextFile).toHaveBeenCalledWith('mp-amy', 'Others/Mr_Mrs _Smith_____.md', 'amy')
  })

  it('falls back to identity when vault returns null', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: 'The estate principal.', description: 'A big man.' },
    )
    expect(result).toEqual({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'The estate principal.',
      source: 'identity',
    })
  })

  it('falls back to description ONLY when identity is empty', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: '   ', description: 'Gestures broadly when excited.' },
    )
    expect(result).toEqual({
      characterId: 'charlie',
      characterName: 'Charlie',
      body: 'Gestures broadly when excited.',
      source: 'description',
    })
  })

  it('prefers identity over description when both are present', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: 'The principal.', description: 'A big man.' },
    )
    expect(result.source).toBe('identity')
    expect(result.body).toBe('The principal.')
  })

  it('returns source=none when vault, identity, and description are all absent', async () => {
    mockReadVaultTextFile.mockResolvedValueOnce(null)
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: 'mp-amy' },
      { id: 'charlie', name: 'Charlie', identity: null, description: null },
    )
    expect(result.source).toBe('none')
    expect(result.body).toBeNull()
  })

  it('skips the vault lookup entirely when observer has no mountPointId', async () => {
    const result = await loadCanonForObserverAboutSubject(
      { characterId: 'amy', mountPointId: null },
      { id: 'charlie', name: 'Charlie', identity: 'The estate principal.', description: null },
    )
    expect(mockReadVaultTextFile).not.toHaveBeenCalled()
    expect(result.source).toBe('identity')
    expect(result.body).toBe('The estate principal.')
  })
})
