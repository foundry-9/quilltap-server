/**
 * applyImportSelection — the preview's ticks, applied to a bundle (#267).
 */

import { applyImportSelection } from '@/lib/import/quilltap-import/selection'
import type { AnyExportData } from '@/lib/import/quilltap-import/types'

const bundle = (): AnyExportData =>
  ({
    characters: [
      { id: 'c1', name: 'Ada', characterDocumentMountPointId: 'v1' },
      { id: 'c2', name: 'Bea', characterDocumentMountPointId: 'v2' },
    ],
    memories: [
      { id: 'm1', characterId: 'c1' },
      { id: 'm2', characterId: 'c2' },
    ],
    mountPoints: [{ id: 'v1' }, { id: 'v2' }],
    documents: [
      { mountPointId: 'v1', relativePath: 'a.md' },
      { mountPointId: 'v2', relativePath: 'b.md' },
    ],
    blobs: [{ mountPointId: 'v2', relativePath: 'p.webp' }],
    instanceSettings: [{ key: 'one' }, { key: 'two' }],
  }) as unknown as AnyExportData

describe('applyImportSelection', () => {
  it('returns the data untouched with no selection', () => {
    const data = bundle()
    expect(applyImportSelection(data, undefined)).toBe(data)
    expect(applyImportSelection(data, {})).toBe(data)
  })

  it('a left-out character takes its memories and its vault with it', () => {
    const out = applyImportSelection(bundle(), { characters: ['c1'] })
    expect(out.characters!.map((c) => c.id)).toEqual(['c1'])
    expect(out.memories!.map((m) => m.id)).toEqual(['m1'])
    expect(out.mountPoints!.map((m) => m.id)).toEqual(['v1'])
    expect(out.documents!.map((d) => d.mountPointId)).toEqual(['v1'])
    expect(out.blobs).toEqual([])
  })

  it('an empty list keeps none of that kind; an absent kind is kept whole', () => {
    const out = applyImportSelection(bundle(), { instanceSettings: [] })
    expect(out.instanceSettings).toEqual([])
    expect(out.characters).toHaveLength(2)
  })

  it('instance settings are selected by key', () => {
    const out = applyImportSelection(bundle(), { instanceSettings: ['two'] })
    expect(out.instanceSettings!.map((s) => s.key)).toEqual(['two'])
  })

  it('document stores are selected under the preview kind name', () => {
    const out = applyImportSelection(bundle(), { documentStores: ['v2'] })
    expect(out.mountPoints!.map((m) => m.id)).toEqual(['v2'])
    expect(out.documents!.map((d) => d.mountPointId)).toEqual(['v2'])
  })
})
