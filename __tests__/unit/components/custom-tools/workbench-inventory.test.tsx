/**
 * Pascal's Workbench — the Inventory surfaces (inventory-tools-and-pascal
 * §5.8): the side-effects card's "Change the inventory" kind with its
 * reference chips, the outcome table's Inventory subjects with the state
 * select, and the Proving Bench's mock inventory riding the preview body.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import OutcomesSection from '@/components/custom-tools/OutcomesSection'
import ProvingBench from '@/components/custom-tools/ProvingBench'
import SideEffectsSection from '@/components/custom-tools/SideEffectsSection'
import { draftFromDefinition, validateDraft, type ToolDraft, type WardrobeVantage } from '@/lib/pascal/tool-draft'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const STAMP = '2026-01-01T00:00:00.000Z'
const VIV = 'char-viv'
const VANTAGE: WardrobeVantage = { kind: 'character', characterId: VIV }

function object(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, kind: 'item', name, title: null, equippedByDefault: false, maxEquipped: 1, canCopy: false, isArchetype: false,
    parentId: null, itemIds: [], metadata: {}, folder: '', archivedAt: null, createdAt: STAMP, updatedAt: STAMP,
    origin: { scope: 'character', id: VIV, name: 'Vivienne' }, ...extra,
  }
}

const POOL = [
  object('sword', 'sword', { title: 'Excalibur' }),
  object('bow', 'magic bow', { isArchetype: true, origin: { scope: 'project', id: 'p1', name: 'Saga' } }),
]

function load(doc: Record<string, unknown>): ToolDraft {
  const draft = draftFromDefinition({ name: 'loot', description: 'Loot.', outcomes: [{ when: true, message: '-', state: 'info' }], ...doc })
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

const realFetch = global.fetch
beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ items: POOL }) })) as unknown as typeof fetch
})
afterAll(() => {
  global.fetch = realFetch
})

describe('SideEffectsSection — Change the inventory', () => {
  it('offers the kind, and renders a resolved reference as a chip', async () => {
    const draft = load({ effects: [{ inventory: { action: 'equip', items: ['excalibur'] } }] })
    renderWithQuery(
      <SideEffectsSection draft={draft} issues={validateDraft(draft)} onChange={() => {}} vantage={VANTAGE} onVantageChange={() => {}} />
    )
    const kind = screen.getByLabelText('Effect kind') as HTMLSelectElement
    expect(Array.from(kind.options).map((o) => o.textContent)).toContain('Change the inventory')
    const chip = await screen.findByTestId('inventory-reference-chip')
    expect(within(chip).getByText('Excalibur (sword)')).toBeInTheDocument()
  })

  it('warns when equip names an archetype, and shows the equip switch on pick up', async () => {
    const draft = load({ effects: [{ inventory: { action: 'equip', items: ['magic bow'] } }] })
    const { unmount } = renderWithQuery(
      <SideEffectsSection draft={draft} issues={validateDraft(draft)} onChange={() => {}} vantage={VANTAGE} onVantageChange={() => {}} />
    )
    expect(await screen.findByText(/An archetype is picked up, not equipped/)).toBeInTheDocument()
    unmount()
    const pickUp = load({ effects: [{ inventory: { action: 'pick_up', items: ['magic bow'] } }] })
    renderWithQuery(
      <SideEffectsSection draft={pickUp} issues={validateDraft(pickUp)} onChange={() => {}} vantage={VANTAGE} onVantageChange={() => {}} />
    )
    expect(screen.getByLabelText('equip it at once')).toBeChecked()
  })
})

describe('OutcomesSection — Inventory subjects', () => {
  it('renders a state chip with the four-way select and = / ≠ only', () => {
    const draft = load({
      outcomes: [
        { when: { inventory: { sword: { eq: 'carried' } } }, message: 'x', state: 'success' },
        { when: true, message: '-', state: 'info' },
      ],
    })
    render(<OutcomesSection draft={draft} issues={[]} onChange={() => {}} />)
    expect((screen.getByLabelText('Condition subject') as HTMLSelectElement).value).toBe('inventory')
    expect(screen.getByLabelText('Inventory object reference')).toHaveValue('sword')
    const state = screen.getByLabelText('Inventory state') as HTMLSelectElement
    expect(state.value).toBe('carried')
    expect(Array.from(state.options).map((o) => o.value)).toEqual(['equipped', 'carried', 'reachable', 'absent'])
    expect(Array.from((screen.getByLabelText('Comparator') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['eq', 'neq'])
  })
})

describe('ProvingBench — Mock inventory', () => {
  it('sends the mock rows with a preview roll', async () => {
    const draft = load({
      outcomes: [
        { when: { inventory: { sword: { eq: 'equipped' } } }, message: 'armed', state: 'success' },
        { when: true, message: '-', state: 'info' },
      ],
    })
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tool: 'loot', params: {}, rollForm: 'range', raw: 0.5, value: 0.5, state: 'success', outcomeIndex: 0,
        message: 'armed', diceBreakdown: '', visibility: 'public',
      }),
    }))
    global.fetch = fetchSpy as unknown as typeof fetch
    renderWithQuery(<ProvingBench draft={draft} valid />)
    expect(screen.getByText(/No mock inventory/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /add object/ }))
    fireEvent.change(screen.getByLabelText('Mock object reference'), { target: { value: 'sword' } })
    fireEvent.click(screen.getByRole('button', { name: /Roll/ }))
    await screen.findByText('armed')
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ inventory: [{ ref: 'sword', state: 'equipped' }] })
  })
})
