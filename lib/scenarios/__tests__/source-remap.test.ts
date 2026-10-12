/**
 * Carrying a chat's scenario source across an import or restore: the pointer
 * follows its store's new id, and a source whose store did not come across is
 * dropped rather than left dangling.
 */

import { readScenarioSource, remapScenarioSource } from '@/lib/scenarios/source-remap'

const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'
const source = { mountPointId: OLD, path: 'Scenarios/tea.md', bodySha256: 'b'.repeat(64) }

describe('remapScenarioSource', () => {
  it('re-points the source at the mapped mount', () => {
    expect(remapScenarioSource(source, (id) => (id === OLD ? NEW : null))).toEqual({ ...source, mountPointId: NEW })
  })

  it('drops a source whose mount did not come across', () => {
    expect(remapScenarioSource(source, () => null)).toBeNull()
  })

  it('reads a JSON string from a raw row', () => {
    expect(remapScenarioSource(JSON.stringify(source), () => NEW)).toEqual({ ...source, mountPointId: NEW })
  })
})

describe('readScenarioSource', () => {
  it.each([null, undefined, '', 'not json', { mountPointId: OLD }, { ...source, bodySha256: 'short' }])(
    'reads %p as no source',
    (value) => {
      expect(readScenarioSource(value)).toBeNull()
    },
  )
})
