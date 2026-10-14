/**
 * Wear ledger — the Wardrobe dialog's staged edits carry the outfits they put
 * on (docs/developer/features/complete/wardrobe-wear-ledger.md §3.3).
 *
 * The dialog dissolves a bundle to its leaves before staging, so the slot map
 * it flushes cannot say an outfit was worn. The bundle ids accumulate per
 * character beside the staged slots and travel as `wornBundleIds` on the
 * `set_all` — from the Live tab's Done flush and from the Outfit Builder's
 * Try on — and a gesture replayed onto a late snapshot keeps its claim.
 */

import { WardrobeControlDialog } from '@/components/wardrobe/wardrobe-control-dialog'
import { WardrobeDialogProvider, useWardrobeDialog } from '@/components/providers/wardrobe-dialog-provider'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import React, { useEffect } from 'react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))
jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))
// The composer is stubbed down to what it paints, so the staged slots can be
// read straight out of the DOM.
jest.mock('@/components/wardrobe/outfit-composer', () => ({
  OutfitComposer: ({ slots }: { slots: Record<string, string[]> }) => (
    <div data-testid="live-slots">{JSON.stringify(slots)}</div>
  ),
}))
jest.mock('@/components/wardrobe/wardrobe-item-editor', () => ({
  WardrobeItemEditor: () => null,
}))
jest.mock('@/components/wardrobe/import-from-image-modal', () => ({
  ImportFromImageModal: () => null,
}))
jest.mock('@/components/wardrobe/WardrobeTransferDialog', () => ({
  WardrobeTransferDialog: () => null,
}))

const CHAT_ID = 'chat-1'
const CHARACTER_ID = 'alice'

const ITEMS = [
  {
    id: 'shirt',
    title: 'Linen Shirt',
    types: ['top'],
    isDefault: false,
    componentItemIds: [],
    replace: false,
    characterId: CHARACTER_ID,
  },
  {
    id: 'hat',
    title: 'Straw Hat',
    types: ['accessories'],
    isDefault: false,
    componentItemIds: [],
    replace: false,
    characterId: CHARACTER_ID,
  },
  {
    id: 'boots',
    title: 'Walking Boots',
    types: ['footwear'],
    isDefault: false,
    componentItemIds: [],
    replace: false,
    characterId: CHARACTER_ID,
  },
  {
    id: 'rambler',
    title: 'Country Rambler',
    types: ['accessories', 'footwear'],
    isDefault: false,
    componentItemIds: ['hat', 'boots'],
    replace: false,
    characterId: CHARACTER_ID,
  },
]

/** The worn snapshot the outfit read eventually publishes. */
const WORN = { top: ['shirt'], bottom: [], footwear: [], accessories: [], hair: [] }

/** Resolver for the held-open `?action=outfit` response. */
let releaseOutfit: (() => void) | null = null
/** Bodies of every `?action=equip` POST the dialog fired. */
let equipCalls: Array<Record<string, unknown>> = []

/** Minimal Response stand-in — `fetchJson` reads ok/status/text(). */
const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

function routeFetch(deferOutfit: boolean): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('action=outfit')) {
      if (deferOutfit) {
        await new Promise<void>((resolve) => {
          releaseOutfit = resolve
        })
      }
      return jsonResponse({ equippedOutfit: { [CHARACTER_ID]: WORN } })
    }
    if (url.includes('action=equip')) {
      equipCalls.push(JSON.parse(String(init?.body ?? '{}')))
      return jsonResponse({ equippedSlots: WORN })
    }
    if (url.endsWith('/api/v1/characters')) {
      return jsonResponse({ characters: [{ id: CHARACTER_ID, name: 'Alice' }] })
    }
    if (url.includes('/wardrobe')) {
      // Every tier of the character's list (own vault, ?scope=group); the
      // General call answers empty so the merge stays deterministic.
      return jsonResponse({ wardrobeItems: url.endsWith('/api/v1/wardrobe') ? [] : ITEMS })
    }
    if (url.includes('/api/v1/image-profiles')) {
      return jsonResponse({ profiles: [] })
    }
    if (url.includes(`/api/v1/chats/${CHAT_ID}`)) {
      return jsonResponse({ chat: { id: CHAT_ID, projectId: null } })
    }
    return jsonResponse({})
  }) as unknown as typeof fetch
}

/** Opens the dialog on mount with chat context, as the Salon does. */
function Opener(): null {
  const dialog = useWardrobeDialog()
  useEffect(() => {
    dialog.open({ characterId: CHARACTER_ID, chatId: CHAT_ID })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once
  }, [])
  return null
}

function renderDialog(): void {
  // The dialog invalidates the wear-ledger queries after an equip commits.
  renderWithQuery(
    <WardrobeDialogProvider>
      <Opener />
      <WardrobeControlDialog />
    </WardrobeDialogProvider>,
  )
}

/** The primary equip button (Wear / Try on) on a given item's row. */
async function findRowButton(itemTitle: string, name: RegExp): Promise<HTMLElement> {
  const label = await screen.findByTitle(itemTitle)
  const row = label.closest('.qt-card-interactive')
  if (!row) throw new Error(`no row for ${itemTitle}`)
  return within(row as HTMLElement).getByRole('button', { name })
}

/** Switch the list to the Outfits tab, where bundles live. */
function showOutfits(): void {
  fireEvent.click(screen.getByRole('tab', { name: 'Outfits' }))
}

const stagedSlots = (): Record<string, string[]> =>
  JSON.parse(screen.getByTestId('live-slots').textContent ?? '{}')

beforeEach(() => {
  equipCalls = []
  releaseOutfit = null
})

describe('WardrobeControlDialog — staged outfits travel with set_all', () => {
  it('sends the bundle id with the Done flush when an outfit is worn from the list', async () => {
    routeFetch(false)
    renderDialog()
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))

    showOutfits()
    fireEvent.click(await findRowButton('Country Rambler', /Wear/))
    await waitFor(() => expect(stagedSlots().footwear).toEqual(['boots']))

    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(equipCalls).toHaveLength(1))
    expect(equipCalls[0]).toEqual({
      characterId: CHARACTER_ID,
      mode: 'set_all',
      // Leaves only — the bundle never lands in the slots…
      slots: { top: ['shirt'], bottom: [], footwear: ['boots'], accessories: ['hat'], hair: [] },
      // …so its claim rides beside them.
      wornBundleIds: ['rambler'],
    })
  })

  it('sends no wornBundleIds for a plain garment edit', async () => {
    routeFetch(false)
    renderDialog()
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))

    fireEvent.click(await findRowButton('Straw Hat', /Wear/))
    await waitFor(() => expect(stagedSlots().accessories).toEqual(['hat']))

    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(equipCalls).toHaveLength(1))
    expect(equipCalls[0]).not.toHaveProperty('wornBundleIds')
  })

  it('keeps the claim of an outfit worn before the snapshot arrived, rebased with its gesture', async () => {
    routeFetch(true)
    renderDialog()

    showOutfits()
    const wear = await findRowButton('Country Rambler', /Wear/)
    await waitFor(() => expect(releaseOutfit).not.toBeNull())
    fireEvent.click(wear)
    await waitFor(() => expect(stagedSlots().footwear).toEqual(['boots']))

    releaseOutfit?.()
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))

    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(equipCalls).toHaveLength(1))
    expect(equipCalls[0]).toMatchObject({
      mode: 'set_all',
      slots: { top: ['shirt'], footwear: ['boots'], accessories: ['hat'] },
      wornBundleIds: ['rambler'],
    })
  })

  it('sends the bundle id with the Outfit Builder\'s Try on', async () => {
    routeFetch(false)
    renderDialog()
    await waitFor(() => expect(stagedSlots().top).toEqual(['shirt']))

    fireEvent.click(screen.getByRole('button', { name: 'Outfit Builder' }))
    showOutfits()
    fireEvent.click(await findRowButton('Country Rambler', /Try on/))
    await waitFor(() => expect(stagedSlots().footwear).toEqual(['boots']))

    fireEvent.click(
      screen.getByTitle('Replace what the character is wearing with this composition'),
    )
    await waitFor(() => expect(equipCalls).toHaveLength(1))
    expect(equipCalls[0]).toMatchObject({
      characterId: CHARACTER_ID,
      mode: 'set_all',
      slots: { top: ['shirt'], footwear: ['boots'], accessories: ['hat'] },
      wornBundleIds: ['rambler'],
    })
  })
})
