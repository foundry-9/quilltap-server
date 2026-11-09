/**
 * OutfitSelector — shows the server's mode, reports only what the operator
 * changed.
 *
 * The casting defaults carry each seat's outfit mode (`defaultOutfitMode`, the
 * one rule). The selector opens each seat on it and leaves an untouched seat
 * out of what it reports, so the server applies that same rule. A seat whose
 * wardrobe has no usable default shows `Compose outfit` — display only.
 *
 * Uses global jest (not @jest/globals) so the bare jest.mock factories hoist.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { OutfitSelector } from '../outfit-selector'

let mockWardrobeItems: unknown[] = []
jest.mock('@/lib/hooks/use-character-wardrobe-items', () => ({
  useCharacterWardrobeItems: (characterId: string | null) => ({
    items: characterId ? mockWardrobeItems : [],
    loading: false,
    fetched: Boolean(characterId),
  }),
}))
jest.mock('@/lib/hooks/use-pronoun-guidance-filter', () => ({
  usePronounGuidanceFilter: () => ({ offer: (items: unknown[]) => items }),
}))
jest.mock('../outfit-composer', () => ({ OutfitComposer: () => null }))
jest.mock('../PronounAwareToggle', () => ({ PronounAwareToggle: () => null }))
jest.mock('../hooks/useComposerHandlers', () => ({ useComposerHandlers: () => ({}) }))
jest.mock('@/components/ui/icon', () => ({ Icon: () => null }))

const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(label) }) as HTMLInputElement

beforeEach(() => {
  mockWardrobeItems = []
})

describe('OutfitSelector — server modes', () => {
  it("opens on the server's mode and reports nothing until the operator changes it", () => {
    const onSelectionsChange = jest.fn()
    render(
      <OutfitSelector
        characters={[{ id: 'a', name: 'Alice' }]}
        defaultModes={{ a: 'llm_choose' }}
        onSelectionsChange={onSelectionsChange}
      />,
    )
    expect(radio('Let character choose').checked).toBe(true)
    expect(onSelectionsChange).toHaveBeenLastCalledWith([])

    fireEvent.click(radio('Start undressed'))
    expect(onSelectionsChange).toHaveBeenLastCalledWith([{ characterId: 'a', mode: 'none' }])
  })

  it('follows a changed server mode for an untouched seat', () => {
    const props = { characters: [{ id: 'a', name: 'Alice' }], onSelectionsChange: jest.fn() }
    const { rerender } = render(<OutfitSelector {...props} defaultModes={{ a: 'llm_choose' }} />)
    rerender(<OutfitSelector {...props} defaultModes={{ a: 'none' }} />)
    expect(radio('Start undressed').checked).toBe(true)
  })

  it('shows Compose for a default seat with no usable default outfit, without reporting it', () => {
    const onSelectionsChange = jest.fn()
    render(
      <OutfitSelector
        characters={[{ id: 'a', name: 'Alice' }]}
        defaultModes={{ a: 'default' }}
        onSelectionsChange={onSelectionsChange}
      />,
    )
    expect(radio('Compose outfit').checked).toBe(true)
    expect(onSelectionsChange).toHaveBeenLastCalledWith([])
  })

  it('falls back to "Same as last" with a source chat and no server modes (a merge)', () => {
    render(
      <OutfitSelector characters={[{ id: 'a', name: 'Alice' }]} sourceChatId="src" onSelectionsChange={jest.fn()} />,
    )
    expect(radio('Same as last conversation').checked).toBe(true)
  })
})
