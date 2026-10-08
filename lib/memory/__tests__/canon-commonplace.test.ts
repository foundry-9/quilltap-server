/**
 * Commonplace canon feedback (memory-consolidation-and-tiers.md §C6): the
 * digest mirror files and their place in the extractor's canon block.
 */

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
  loadCanonForObserverAboutSubject,
  loadCanonForSelfWithCommonplace,
  renderOtherCanonBlock,
  renderSelfCanonBlock,
  CANON_BLOCK_TOKEN_CAP,
  NO_CANON_FALLBACK,
} from '../cheap-llm-tasks/canon'
import {
  commonplaceFileToCanonText,
  commonplacePathFor,
  renderCommonplaceFile,
  COMMONPLACE_FILE_TOKEN_BUDGET,
} from '../commonplace-file'
import { characterIdsFromMemoryWrites } from '../consolidation-triggers'
import { estimateTokens } from '@/lib/tokens/token-counter'

const mockRead = readVaultTextFile as jest.MockedFunction<typeof readVaultTextFile>

const LAURA = { id: 'laura-1', name: 'Laura', identity: 'A cartographer.', description: null }
const OBSERVER = { characterId: 'friday-1', mountPointId: 'mp-1' }

function digestFile(subjectId: string, lines: string[]): string {
  return renderCommonplaceFile({
    subjectCharacterId: subjectId,
    subjectName: 'Laura',
    isSelf: false,
    digests: lines.map((content, i) => ({ content, kind: 'semantic', occurredAt: null, reinforcedImportance: 1 - i * 0.01 })),
    updatedAt: '2026-10-08T00:00:00.000Z',
  }).content
}

beforeEach(() => {
  mockRead.mockReset()
})

describe('commonplace file paths and rendering', () => {
  it('maps subjects to Commonplace/<name>.md and the self bucket to Commonplace/Self.md', () => {
    expect(commonplacePathFor('self')).toBe('Commonplace/Self.md')
    expect(commonplacePathFor({ id: 'laura-1', name: 'Laura' })).toBe('Commonplace/Laura.md')
    expect(commonplacePathFor({ id: 'abcdef12-0000', name: 'Self' })).toBe('Commonplace/Self (abcdef12).md')
  })

  it('renders frontmatter, highest importance first, and episode dates', () => {
    const { content } = renderCommonplaceFile({
      subjectCharacterId: 'laura-1',
      subjectName: 'Laura',
      isSelf: false,
      digests: [
        { content: 'Minor note.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.3 },
        { content: 'Visited the lighthouse.', kind: 'episodic', occurredAt: '2026-07-14T09:00:00.000Z', reinforcedImportance: 0.9 },
      ],
      updatedAt: '2026-10-08T00:00:00.000Z',
    })
    expect(content).toContain('type: commonplace-digest')
    expect(content).toContain('subjectCharacterId: "laura-1"')
    expect(content).toContain('updatedAt: "2026-10-08T00:00:00.000Z"')
    expect(content.indexOf('[2026-07-14] Visited the lighthouse.')).toBeLessThan(content.indexOf('Minor note.'))
  })

  it('stops before the body passes the token budget', () => {
    const long = 'x'.repeat(400)
    const result = renderCommonplaceFile({
      subjectCharacterId: 's',
      subjectName: 'S',
      isSelf: true,
      digests: Array.from({ length: 100 }, () => ({ content: long, kind: 'semantic' as const, occurredAt: null, reinforcedImportance: 0.5 })),
      updatedAt: '2026-10-08T00:00:00.000Z',
    })
    expect(result.entriesDropped).toBeGreaterThan(0)
    const body = commonplaceFileToCanonText(result.content) ?? ''
    expect(estimateTokens(body)).toBeLessThanOrEqual(COMMONPLACE_FILE_TOKEN_BUDGET)
  })

  it('reads a file back as canon text without frontmatter or heading', () => {
    expect(commonplaceFileToCanonText(digestFile('laura-1', ['Laura keeps the charts.']))).toBe('- Laura keeps the charts.')
    expect(commonplaceFileToCanonText(null)).toBeNull()
  })
})

describe('OTHER canon order: hand-written first, then the Commonplace digest', () => {
  it('reads Others/<name>.md, then Commonplace/<name>.md, and renders them in that order', async () => {
    mockRead.mockImplementation(async (_mp, path) => {
      if (path === 'Others/Laura.md') return 'Laura is my oldest friend.'
      if (path === 'Commonplace/Laura.md') return digestFile('laura-1', ['Laura prefers tea now.'])
      return null
    })
    const canon = await loadCanonForObserverAboutSubject(OBSERVER, LAURA)
    expect(mockRead.mock.calls.map((c) => c[1])).toEqual(['Others/Laura.md', 'Commonplace/Laura.md'])
    const block = renderOtherCanonBlock(canon)
    expect(block).toBe(
      'ALREADY ESTABLISHED about Laura\nLaura is my oldest friend.\n[FROM THE COMMONPLACE BOOK]\n- Laura prefers tea now.',
    )
  })

  it('puts the digest after the identity fallback when there is no hand-written note', async () => {
    mockRead.mockImplementation(async (_mp, path) =>
      path === 'Commonplace/Laura.md' ? digestFile('laura-1', ['Laura prefers tea now.']) : null,
    )
    const block = renderOtherCanonBlock(await loadCanonForObserverAboutSubject(OBSERVER, LAURA))
    expect(block.indexOf('[IDENTITY] A cartographer.')).toBeLessThan(block.indexOf('[FROM THE COMMONPLACE BOOK]'))
  })

  it('lets the digest stand alone instead of the no-canon fallback', async () => {
    mockRead.mockImplementation(async (_mp, path) =>
      path === 'Commonplace/Laura.md' ? digestFile('laura-1', ['Laura prefers tea now.']) : null,
    )
    const block = renderOtherCanonBlock(
      await loadCanonForObserverAboutSubject(OBSERVER, { ...LAURA, identity: null }),
    )
    expect(block).not.toContain(NO_CANON_FALLBACK)
    expect(block).toContain('- Laura prefers tea now.')
  })

  it('renders byte-for-byte as before when there is no digest file', async () => {
    mockRead.mockResolvedValue(null)
    const canon = await loadCanonForObserverAboutSubject(OBSERVER, LAURA)
    expect(canon.commonplace).toBeUndefined()
    expect(renderOtherCanonBlock(canon)).toBe('ALREADY ESTABLISHED about Laura\n[IDENTITY] A cartographer.')
  })

  it('skips the digest when asked (the consolidation call)', async () => {
    mockRead.mockResolvedValue(null)
    await loadCanonForObserverAboutSubject(OBSERVER, LAURA, { includeCommonplace: false })
    expect(mockRead.mock.calls.map((c) => c[1])).toEqual(['Others/Laura.md'])
  })

  it('caps the combined block by trimming the digest, never the hand-written note', async () => {
    const hand = 'h'.repeat(6000)
    const lines = Array.from({ length: 200 }, (_, i) => `Fact number ${i} about Laura and the charts she keeps.`)
    mockRead.mockImplementation(async (_mp, path) => {
      if (path === 'Others/Laura.md') return hand
      if (path === 'Commonplace/Laura.md') return `---\ntype: commonplace-digest\n---\n# Laura\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`
      return null
    })
    const block = renderOtherCanonBlock(await loadCanonForObserverAboutSubject(OBSERVER, LAURA))
    expect(block).toContain(hand)
    expect(estimateTokens(block)).toBeLessThanOrEqual(CANON_BLOCK_TOKEN_CAP + 5)
    expect(block).toContain('Fact number 0')
    expect(block).not.toContain('Fact number 199')
  })
})

describe('SELF canon: card fields, then Commonplace/Self.md', () => {
  it('appends the self digest after the card fields', async () => {
    mockRead.mockImplementation(async (_mp, path) =>
      path === 'Commonplace/Self.md'
        ? renderCommonplaceFile({
            subjectCharacterId: 'friday-1',
            subjectName: 'Friday',
            isSelf: true,
            digests: [{ content: 'I keep the household ledgers.', kind: 'semantic', occurredAt: null, reinforcedImportance: 0.8 }],
            updatedAt: '2026-10-08T00:00:00.000Z',
          }).content
        : null,
    )
    const block = renderSelfCanonBlock(
      await loadCanonForSelfWithCommonplace({
        id: 'friday-1',
        name: 'Friday',
        manifesto: 'I serve the Estate.',
        personality: null,
        description: null,
        identity: null,
        mountPointId: 'mp-1',
      }),
    )
    expect(block).toBe(
      'ALREADY ESTABLISHED about Friday\n[MANIFESTO] I serve the Estate.\n[FROM THE COMMONPLACE BOOK]\n- I keep the household ledgers.',
    )
  })

  it('reads nothing without a vault', async () => {
    const canon = await loadCanonForSelfWithCommonplace({
      id: 'friday-1',
      name: 'Friday',
      manifesto: 'I serve.',
      personality: null,
      description: null,
      identity: null,
      mountPointId: null,
    })
    expect(mockRead).not.toHaveBeenCalled()
    expect(renderSelfCanonBlock(canon)).toBe('ALREADY ESTABLISHED about Friday\n[MANIFESTO] I serve.')
  })
})

describe('characterIdsFromMemoryWrites (watermark trigger input)', () => {
  it('collects the holders of every memories.create in a committed batch', () => {
    expect(
      characterIdsFromMemoryWrites([
        { method: 'memories.create', args: [{ characterId: 'a' }] },
        { method: 'memories.create', args: [{ characterId: 'a' }] },
        { method: 'memories.updateForCharacter', args: ['b', 'm', {}] },
        { method: 'memories.create', args: [{ characterId: 'c' }, { id: 'x' }] },
        { method: 'chats.update', args: ['chat', {}] },
      ]),
    ).toEqual(['a', 'c'])
  })
})
