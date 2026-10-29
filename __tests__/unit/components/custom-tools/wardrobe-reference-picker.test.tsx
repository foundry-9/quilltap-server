/**
 * Pascal's Workbench — picking garments for a wardrobe effect
 * (pascal-wardrobe-effect-picker §3, §5).
 *
 *  - `WardrobeReferencePicker`: outfits and garments sectioned, search, the
 *    slot filter, the archived default per action, title-vs-id picks, and the
 *    none / empty vantage states.
 *  - `SideEffectsSection`: a resolved reference renders as a chip, a templated
 *    one keeps its input, an unresolved one shows an advisory (never a draft
 *    error), the slot-coverage advisory, and the vantage never reaches the file.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { WardrobeReferencePicker } from '@/components/wardrobe/wardrobe-reference-picker'
import SideEffectsSection from '@/components/custom-tools/SideEffectsSection'
import {
  draftFromDefinition,
  serializeDraft,
  validateDraft,
  type ToolDraft,
  type WardrobeVantage,
} from '@/lib/pascal/tool-draft'
import type { CustomToolDestinations } from '@/lib/pascal/workbench'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeOrigin } from '@/lib/wardrobe/wardrobe-container'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const STAMP = '2026-01-01T00:00:00.000Z'
const IMOGEN = 'char-imogen'
const OWN: WardrobeOrigin = { scope: 'character', id: IMOGEN, name: 'Imogen' }
const GENERAL: WardrobeOrigin = { scope: 'general', id: null, name: 'Quilltap General' }

function item(id: string, title: string, types: WardrobeItem['types'], extra: Partial<WardrobeItem> = {}) {
  return {
    id,
    characterId: IMOGEN,
    title,
    types,
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  }
}

const OWN_ITEMS = [
  { ...item('shirt', 'Linen Shirt', ['top']), origin: OWN },
  { ...item('dress', 'Sundress', ['top', 'bottom']), origin: OWN },
  { ...item('coat', 'Old Coat', ['top'], { archivedAt: STAMP }), origin: OWN },
  { ...item('ensemble', 'Garden Party', ['top', 'bottom'], { componentItemIds: ['shirt', 'boots'] }), origin: OWN },
]
const GENERAL_ITEMS = [{ ...item('boots', 'Riding Boots', ['footwear'], { characterId: null }), origin: GENERAL }]

const destinations: CustomToolDestinations = {
  general: { mountPointId: 'mp-general', mountName: 'General', existingToolNames: [] },
  characters: [{ characterId: IMOGEN, characterName: 'Imogen', mountPointId: 'mp-imogen', mountName: 'Imogen', existingToolNames: [] }],
  groups: [],
  projects: [],
  other: [],
}

const CHARACTER: WardrobeVantage = { kind: 'character', characterId: IMOGEN }
const realFetch = global.fetch
let wardrobe: { own: unknown[]; general: unknown[] }

beforeEach(() => {
  wardrobe = { own: OWN_ITEMS, general: GENERAL_ITEMS }
  // `jest.setup.ts` replaces jest-fetch-mock's function, so stub fetch here.
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    let wardrobeItems: unknown[] = []
    if (url.startsWith(`/api/v1/characters/${IMOGEN}/wardrobe`)) {
      wardrobeItems = url.includes('scope=group') ? [] : wardrobe.own
    } else if (url.startsWith('/api/v1/wardrobe')) {
      wardrobeItems = wardrobe.general
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ wardrobeItems }) }
  }) as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = realFetch
})

function renderPicker(props: Partial<React.ComponentProps<typeof WardrobeReferencePicker>> = {}) {
  const onPick = jest.fn()
  const onClose = jest.fn()
  const onReferenceChange = jest.fn()
  const utils = renderWithQuery(
    <WardrobeReferencePicker
      isOpen
      onClose={onClose}
      vantage={CHARACTER}
      characterName="Imogen"
      reference="title"
      onReferenceChange={onReferenceChange}
      onPick={onPick}
      {...props}
    />,
  )
  return { ...utils, onPick, onClose, onReferenceChange }
}

const optionTitles = () => screen.queryAllByTestId('wardrobe-reference-option').map((el) => el.getAttribute('aria-label'))

describe('WardrobeReferencePicker', () => {
  it('sections outfits apart from garments, grouped by slot', async () => {
    renderPicker()
    const outfits = await screen.findByRole('region', { name: 'Outfits' })
    expect(within(outfits).getByText('Garden Party')).toBeInTheDocument()
    const garments = screen.getByRole('region', { name: 'Garments' })
    expect(within(garments).getByRole('heading', { name: 'Tops' })).toBeInTheDocument()
    expect(within(garments).getByRole('heading', { name: 'Footwear' })).toBeInTheDocument()
    expect(within(garments).queryByText('Garden Party')).toBeNull()
    // Shared garments carry their origin and reach.
    expect(within(garments).getByText('Shared · Quilltap General')).toBeInTheDocument()
    expect(within(garments).getByText(/Reach: everyone/)).toBeInTheDocument()
  })

  it('filters by title', async () => {
    renderPicker()
    await screen.findByText('Riding Boots')
    fireEvent.change(screen.getByLabelText('Search the wardrobe'), { target: { value: 'boot' } })
    expect(optionTitles()).toEqual(['Pick Riding Boots'])
  })

  it('hides garments that do not cover the named slot', async () => {
    renderPicker({ slot: 'footwear' })
    await screen.findByText('Riding Boots')
    expect(screen.queryByText('Linen Shirt')).toBeNull()
    fireEvent.click(screen.getByLabelText('Covers Footwear only'))
    expect(screen.getByText('Linen Shirt')).toBeInTheDocument()
  })

  it('hides archived items for wear and shows them for take_off', async () => {
    const wear = renderPicker({ action: 'wear' })
    await screen.findByText('Linen Shirt')
    expect(screen.queryByText('Old Coat')).toBeNull()
    wear.unmount()
    renderPicker({ action: 'take_off' })
    expect(await screen.findByText('Old Coat')).toBeInTheDocument()
  })

  it('picks by title, and by id when asked', async () => {
    const titled = renderPicker()
    fireEvent.click(await screen.findByLabelText('Pick Sundress'))
    expect(titled.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dress' }), { reference: 'title' })
    expect(titled.onClose).toHaveBeenCalled()
    titled.unmount()

    const byId = renderPicker({ reference: 'id' })
    fireEvent.click(await screen.findByLabelText('Pick Sundress'))
    expect(byId.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'dress' }), { reference: 'id' })
  })

  it('says nothing but the prompt for the none vantage', () => {
    renderPicker({ vantage: { kind: 'none' }, headerControl: <p>choose a wardrobe</p> })
    expect(screen.getByText('choose a wardrobe')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search the wardrobe')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows the empty state for a wardrobe with nothing in it', async () => {
    wardrobe = { own: [], general: [] }
    renderPicker()
    expect(await screen.findByText(/Nothing hangs here yet/)).toBeInTheDocument()
  })
})

function wardrobeDraft(wardrobeGesture: Record<string, unknown>): ToolDraft {
  const draft = draftFromDefinition({
    name: 'dresser',
    description: 'x',
    parameters: { garment: { type: 'string', default: 'Boots' } },
    outcomes: [{ when: true, message: 'done', state: 'info' }],
    effects: [{ wardrobe: wardrobeGesture }],
  })
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

function renderSection(draft: ToolDraft, vantage: WardrobeVantage = CHARACTER) {
  const onChange = jest.fn()
  renderWithQuery(
    <SideEffectsSection
      draft={draft}
      issues={validateDraft(draft)}
      onChange={onChange}
      vantage={vantage}
      onVantageChange={jest.fn()}
      destinations={destinations}
    />,
  )
  return { onChange }
}

describe('SideEffectsSection — wardrobe references', () => {
  it('renders a resolved reference as a chip with its slots and origin', async () => {
    renderSection(wardrobeDraft({ action: 'wear', items: ['riding boots'] }))
    const chip = await screen.findByTestId('wardrobe-reference-chip')
    expect(within(chip).getByText('Riding Boots')).toBeInTheDocument()
    expect(within(chip).getByText('Footwear')).toBeInTheDocument()
    expect(within(chip).getByText('Shared · Quilltap General')).toBeInTheDocument()
    expect(within(chip).getByText('everyone')).toBeInTheDocument()
    expect(screen.getByText(/Browsing/)).toHaveTextContent('Imogen’s')
  })

  it('names a character-owned garment as theirs', async () => {
    renderSection(wardrobeDraft({ action: 'wear', items: ['Linen Shirt'] }))
    const chip = await screen.findByTestId('wardrobe-reference-chip')
    expect(within(chip).getByText('Imogen’s own')).toBeInTheDocument()
    expect(within(chip).getByText('Imogen only')).toBeInTheDocument()
  })

  it('keeps a templated reference as text, chosen at run time', async () => {
    renderSection(wardrobeDraft({ action: 'wear', items: ['{{params.garment}}'] }))
    expect(screen.getByLabelText('Item 1')).toHaveValue('{{params.garment}}')
    expect(screen.getByText('chosen at run time')).toBeInTheDocument()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('wardrobe-reference-unresolved')).toBeNull()
  })

  it('advises on an unresolved reference without making it a draft error', async () => {
    const draft = wardrobeDraft({ action: 'wear', items: ['Cloak of Nite'] })
    renderSection(draft)
    expect(await screen.findByTestId('wardrobe-reference-unresolved')).toHaveTextContent('not in Imogen’s reach')
    expect(validateDraft(draft).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('warns when an archived garment is to be worn', async () => {
    renderSection(wardrobeDraft({ action: 'wear', items: ['Old Coat'] }))
    expect(await screen.findByText(/is archived and cannot be worn/)).toBeInTheDocument()
  })

  it('flags slots the chosen items do not cover under add_to_slot', async () => {
    renderSection(wardrobeDraft({ action: 'wear', items: ['Sundress'], mode: 'add_to_slot', slot: 'footwear' }))
    expect(await screen.findByTestId('wardrobe-slot-advisory')).toHaveTextContent(
      '“Sundress” covers Top, Bottom — not Footwear',
    )
    expect(screen.getByRole('option', { name: 'Footwear (not covered)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Top' })).toBeInTheDocument()
  })

  it('switches a chip between title and id', async () => {
    const { onChange } = renderSection(wardrobeDraft({ action: 'wear', items: ['Sundress'] }))
    fireEvent.click(await screen.findByLabelText('Reference by id instead'))
    const next = onChange.mock.calls[0][0] as ToolDraft
    expect(next.effects[0].wardrobe.items).toEqual(['dress'])
  })

  it('fills a reference from the picker, and the vantage never reaches the file', async () => {
    const loaded = wardrobeDraft({ action: 'wear', items: ['placeholder'] })
    const draft = {
      ...loaded,
      effects: loaded.effects.map((effect) => ({ ...effect, wardrobe: { ...effect.wardrobe, items: [''] } })),
    }
    const { onChange } = renderSection(draft)
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }))
    fireEvent.click(await screen.findByLabelText('Pick Riding Boots'))
    const next = onChange.mock.calls[0][0] as ToolDraft
    expect(next.effects[0].wardrobe.items).toEqual(['Riding Boots'])
    const saved = JSON.parse(serializeDraft(next))
    expect(saved.effects).toEqual([{ wardrobe: { action: 'wear', items: ['Riding Boots'] } }])
    expect(serializeDraft(next)).not.toContain(IMOGEN)
  })

  it('serializes byte-identically whatever the vantage', async () => {
    const draft = wardrobeDraft({ action: 'wear', items: ['Sundress'] })
    const before = serializeDraft(draft)
    renderSection(draft)
    await screen.findByTestId('wardrobe-reference-chip')
    expect(serializeDraft(draft)).toBe(before)
  })
})
