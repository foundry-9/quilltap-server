/**
 * Scenario display order — `lib/scenarios/sort.ts` and the list builders that use it.
 *
 * Pinned here: title first, filename second, a leading "The" ignored in both,
 * case-insensitive; the store-tier list builder (`buildScenarioList`) returns
 * that order while default-conflict resolution keeps its alphabetical-filename
 * rule; and a character vault's scenario array comes back in the same order.
 */

jest.mock('@/lib/logger', () => {
  const stub = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  stub.child.mockReturnValue(stub)
  return { logger: stub }
})
jest.mock('@/lib/repositories/factory')
jest.mock('@/lib/mount-index/database-store', () => ({ writeDatabaseDocument: jest.fn() }))

import { compareScenarios, scenarioSortKey, sortScenarios } from '@/lib/scenarios/sort'
import { buildScenarioList, parseScenarioDoc } from '@/lib/mount-index/scenarios-common'
import { parseScenarioFilesSorted } from '@/lib/database/repositories/vault-overlay/parsers'
import type { DocMountDocumentWithLink } from '@/lib/database/repositories/doc-mount-documents.repository'

function doc(fileName: string, content: string): DocMountDocumentWithLink {
  return {
    id: `doc-${fileName}`,
    mountPointId: 'mount-001',
    relativePath: `Scenarios/${fileName}`,
    fileName,
    content,
    lastModified: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as DocMountDocumentWithLink
}

const titled = (name: string, extra = '') => `---\nname: ${name}\n${extra}---\nBody of ${name}.`

describe('scenarioSortKey', () => {
  it('drops a leading "The", whatever its case', () => {
    expect(scenarioSortKey('The Gilded Cage')).toBe('Gilded Cage')
    expect(scenarioSortKey('the gilded cage')).toBe('gilded cage')
    expect(scenarioSortKey('  THE   Gilded Cage ')).toBe('Gilded Cage')
  })

  it('leaves "The" inside a word or mid-title alone', () => {
    expect(scenarioSortKey('Theatre Night')).toBe('Theatre Night')
    expect(scenarioSortKey('the-attic')).toBe('attic')
    expect(scenarioSortKey('Into the Woods')).toBe('Into the Woods')
  })

  it('keeps a title that is only "The"', () => {
    expect(scenarioSortKey('The')).toBe('The')
  })
})

describe('compareScenarios', () => {
  const titles = (items: Array<{ title: string; filename: string }>) =>
    sortScenarios(items, (s) => s).map((s) => `${s.title}|${s.filename}`)

  it('sorts by title with the leading article ignored, case-insensitively', () => {
    expect(
      titles([
        { title: 'The Zeppelin', filename: 'a' },
        { title: 'banquet', filename: 'b' },
        { title: 'The Ballroom', filename: 'c' },
        { title: 'Casino', filename: 'd' },
      ]),
    ).toEqual(['The Ballroom|c', 'banquet|b', 'Casino|d', 'The Zeppelin|a'])
  })

  it('breaks a title tie on the filename, article ignored there too', () => {
    expect(
      titles([
        { title: 'Arrival', filename: 'the-zoo' },
        { title: 'Arrival', filename: 'meadow' },
        { title: 'The Arrival', filename: 'the-attic' },
      ]),
    ).toEqual(['The Arrival|the-attic', 'Arrival|meadow', 'Arrival|the-zoo'])
  })

  it('is a total order — identical keys fall back to the raw title, then the path', () => {
    expect(compareScenarios({ title: 'Gala', filename: 'g', path: 'a' }, { title: 'Gala', filename: 'g', path: 'b' })).toBeLessThan(0)
    expect(compareScenarios({ title: 'Gala', filename: 'g' }, { title: 'Gala', filename: 'g' })).toBe(0)
  })
})

describe('buildScenarioList — display order', () => {
  it('returns scenarios in title order, not path order', () => {
    const { scenarios } = buildScenarioList(
      [
        doc('a.md', titled('The Zeppelin')),
        doc('b.md', titled('Casino')),
        doc('c.md', titled('The Ballroom')),
        doc('untitled-dock.md', 'Body only.'),
      ],
      parseScenarioDoc,
    )
    expect(scenarios.map((s) => s.name)).toEqual(['The Ballroom', 'Casino', 'untitled-dock', 'The Zeppelin'])
  })

  it('still resolves a default conflict by alphabetically-first filename', () => {
    const { scenarios, warnings } = buildScenarioList(
      [doc('a.md', titled('Zebra', 'isDefault: true\n')), doc('b.md', titled('Aardvark', 'isDefault: true\n'))],
      parseScenarioDoc,
    )
    expect(scenarios.map((s) => s.name)).toEqual(['Aardvark', 'Zebra'])
    expect(scenarios.find((s) => s.isDefault)?.filename).toBe('a')
    expect(warnings).toHaveLength(1)
  })
})

describe('parseScenarioFilesSorted — a character vault', () => {
  it('orders the vault array by title, then filename', () => {
    const scenarios = parseScenarioFilesSorted(
      [
        doc('1.md', titled('The Parlour')),
        doc('2.md', '# Attic\n\nDusty.'),
        doc('3-the-cellar.md', 'Damp.'),
      ],
      'char-1',
    )
    expect(scenarios.map((s) => s.title)).toEqual(['3-the-cellar', 'Attic', 'The Parlour'])
  })
})
