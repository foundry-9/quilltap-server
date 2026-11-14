/**
 * @jest-environment node
 *
 * Pictures that mention things (atlas spec §5.8): references only for named
 * entries with a graphic prompt, the crafter's block, the append for a path
 * with no crafter, and `{{Name}}` placeholders (characters win).
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/atlas/pool', () => ({ loadCastAtlasView: jest.fn(), loadAtlasViewFor: jest.fn() }))

import {
  appendKnownThings,
  KNOWN_THINGS_LEAD,
  renderKnownThings,
  resolveAtlasImageReferences,
  resolveAtlasPlaceholders,
} from '@/lib/atlas/image-reference'

const origin = { scope: 'general' as const, id: null, name: 'Quilltap General' }
const e = (name: string, aliases: string[], graphicPrompt: string | null) =>
  ({ id: name, name, aliases, graphicPrompt, knowledge: null, imageFileId: null, metadata: {}, folder: '', archivedAt: null, createdAt: 'x', updatedAt: 'x', origin, mountPointId: 'm' })
const view = { entries: [e('Convertible', ['lander', 'car'], "A 1930's roadster, silver."), e('Lighthouse', [], 'A white tower.'), e('Orchard', [], null)], shadowedCount: 0 }

it('resolves named things with a look, in priority order', () => {
  const things = resolveAtlasImageReferences({ view, texts: ['the convertible parked by the lighthouse'] })
  expect(things.map((t) => t.name)).toEqual(['Convertible', 'Lighthouse'])
  expect(resolveAtlasImageReferences({ view, texts: ['a bowl of fruit in the orchard'] })).toEqual([])
})

it('renders the crafter block and nothing for no things', () => {
  expect(renderKnownThings([])).toBe('')
  expect(renderKnownThings(resolveAtlasImageReferences({ view, texts: ['the car'] }))).toBe(
    `${KNOWN_THINGS_LEAD}\n- Convertible (also: lander, car): A 1930's roadster, silver.`,
  )
})

it('appends looks for a path with no crafter', () => {
  const things = resolveAtlasImageReferences({ view, texts: ['the car at dusk'] })
  expect(appendKnownThings('the car at dusk', things)).toBe("the car at dusk Convertible: A 1930's roadster, silver.")
  expect(appendKnownThings('a bowl of fruit', [])).toBe('a bowl of fruit')
})

it('rewrites an Atlas placeholder to the canonical name; a character placeholder stays', () => {
  const out = resolveAtlasPlaceholders('{{car}} at dusk with {{Agatha}}', view, (name) => name === 'Agatha')
  expect(out).toEqual({ prompt: 'Convertible at dusk with {{Agatha}}', names: ['Convertible'] })
  expect(resolveAtlasPlaceholders('{{Convertible}}', view, () => true).names).toEqual([])
})
