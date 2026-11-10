/**
 * @jest-environment node
 *
 * Atlas matching (atlas spec §5.3): case-insensitive whole words, Unicode
 * letter bounds, longest term first, name beats alias, tier order, excluded
 * terms. Also the `caseInsensitive` option on the shared name matcher, whose
 * default stays case-sensitive.
 */

import { buildAtlasMatcher, findNamedEntries, firstAtlasMention, personTerms } from '@/lib/atlas/match'
import { buildNameMatcher, firstNameMatch } from '@/lib/chat/name-mentions'

const entry = (id: string, name: string, aliases: string[] = []) => ({ id, name, aliases })
const convertible = entry('conv', 'Convertible', ['lander', 'car', 'dinghy'])

describe('buildNameMatcher', () => {
  it('stays case-sensitive by default', () => {
    expect(firstNameMatch('the doc said', buildNameMatcher(['Doc'])!)).toBeNull()
  })
  it('folds case when asked', () => {
    expect(firstNameMatch('the doc said', buildNameMatcher(['Doc'], { caseInsensitive: true })!)?.text).toBe('doc')
  })
})

describe('findNamedEntries', () => {
  const matcher = buildAtlasMatcher([convertible])

  it('matches whole words in any case', () => {
    expect(findNamedEntries(['Is the car still outside?'], matcher).map((h) => h.text)).toEqual(['car'])
    expect(findNamedEntries(['CAR! Now!'], matcher).map((h) => h.text)).toEqual(['CAR'])
  })

  it('does not stem: "cars" and "carpet" match nothing', () => {
    expect(findNamedEntries(['The cars were lined up on the carpet.'], matcher)).toEqual([])
  })

  it('respects Unicode letter bounds', () => {
    expect(findNamedEntries(['Écart'], buildAtlasMatcher([entry('e', 'Car')]))).toEqual([])
    expect(findNamedEntries(['un café crème'], buildAtlasMatcher([entry('c', 'café')])).map((h) => h.text)).toEqual(['café'])
  })

  it('prefers the longest term', () => {
    const m = buildAtlasMatcher([entry('house', 'House'), entry('lh', 'Lighthouse', ['light house'])])
    expect(findNamedEntries(['by the light house'], m).map((h) => h.entry.id)).toEqual(['lh'])
  })

  it('lets a canonical name beat an alias, then tier order', () => {
    const named = entry('named', 'Car')
    const aliased = entry('aliased', 'Convertible', ['car'])
    expect(findNamedEntries(['the car'], buildAtlasMatcher([aliased, named]))[0].entry.id).toBe('named')
    const stronger = entry('strong', 'Boat', ['dinghy'])
    const weaker = entry('weak', 'Raft', ['dinghy'])
    expect(findNamedEntries(['a dinghy'], buildAtlasMatcher([stronger, weaker]))[0].entry.id).toBe('strong')
  })

  it('reports each entry once, with the text index it was first found in', () => {
    const hits = findNamedEntries(['nothing here', 'the lander', 'the Convertible again'], matcher)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ text: 'lander', textIndex: 1 })
  })

  it('drops excluded terms (people)', () => {
    const m = buildAtlasMatcher([convertible], { excludeTerms: personTerms([{ name: 'Car', aliases: ['Dinghy'] }]) })
    expect(findNamedEntries(['Car took the dinghy'], m)).toEqual([])
    expect(findNamedEntries(['the lander'], m)).toHaveLength(1)
  })

  it('returns null for a matcher with no terms', () => {
    expect(buildAtlasMatcher([])).toBeNull()
    expect(findNamedEntries(['x'], null)).toEqual([])
    expect(firstAtlasMention('the car', null)).toBeNull()
  })
})
