/**
 * The Wardrobe dialog's "Show shared" toggle.
 *
 * The character view lists the merge of the character's own garments with
 * every shared tier above them (group / project / Quilltap General). Those
 * borrowed rows carry an origin chip and can't be edited from here, and when
 * you're dressing a character or building an outfit out of their own clothes
 * they're just noise. The toggle is on by default — hiding is opt-in — and it
 * filters after the merge, since ownership isn't something the fetch can ask
 * the server for.
 */

import { WardrobeControlDialog } from '@/components/wardrobe/wardrobe-control-dialog'
import {
  WardrobeDialogProvider,
  useWardrobeDialog,
} from '@/components/providers/wardrobe-dialog-provider'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))
jest.mock('@/lib/alert', () => ({
  showConfirmation: jest.fn(),
}))
jest.mock('@/components/wardrobe/outfit-composer', () => ({
  OutfitComposer: () => null,
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

const CHARACTER_ID = 'alice'

/** Alice's own garment — full management, no badge. */
const OWN_ITEM = {
  id: 'shirt',
  title: 'Linen Shirt',
  types: ['top'],
  isDefault: false,
  componentItemIds: [],
  replace: false,
  characterId: CHARACTER_ID,
}

/** A Quilltap General archetype merged in from above — chipped `Shared · Quilltap General`. */
const SHARED_ITEM = {
  id: 'watch',
  title: 'Apple Watch',
  types: ['accessories'],
  isDefault: false,
  componentItemIds: [],
  replace: false,
  characterId: null,
}

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

function routeFetch(): void {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/v1/characters')) {
      return jsonResponse({ characters: [{ id: CHARACTER_ID, name: 'Alice' }] })
    }
    if (url.includes('/api/v1/image-profiles')) {
      return jsonResponse({ profiles: [] })
    }
    if (url.includes('/wardrobe')) {
      // The General tier is `/api/v1/wardrobe`; everything else here is one of
      // Alice's own tiers.
      const isGeneral = new URL(url, 'http://x').pathname === '/api/v1/wardrobe'
      return jsonResponse({ wardrobeItems: isGeneral ? [SHARED_ITEM] : [OWN_ITEM] })
    }
    return jsonResponse({})
  }) as unknown as typeof fetch
}

/** Opens the dialog out of chat, as the sidebar button does. */
function Opener(): null {
  const dialog = useWardrobeDialog()
  useEffect(() => {
    dialog.open({ characterId: CHARACTER_ID })
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

const sharedCheckbox = (): HTMLElement => screen.getByLabelText('Show shared')

beforeEach(() => {
  routeFetch()
})

const generalTierRow = (): HTMLElement | null =>
  screen.queryAllByTestId('wardrobe-tier-row').find((row) => row.textContent?.includes('General')) ?? null

describe('WardrobeControlDialog — Show shared', () => {
  it('shows each shared wardrobe as a tier row by default and drops it when unticked, keeping the character’s own', async () => {
    renderDialog()

    // Default on: the closet's root lists Alice's own garment, then one tier
    // row per wardrobe she borrows from; entering it shows its items.
    expect(await screen.findByTitle('Linen Shirt')).toBeInTheDocument()
    await waitFor(() => expect(generalTierRow()).not.toBeNull())
    expect(screen.queryByTitle('Apple Watch')).toBeNull()
    expect(sharedCheckbox()).toBeChecked()

    fireEvent.click(generalTierRow() as HTMLElement)
    expect(await screen.findByTitle('Apple Watch')).toBeInTheDocument()
    expect(screen.queryByTitle('Linen Shirt')).toBeNull()

    // Unticking while inside a shared wardrobe goes back to the closet.
    fireEvent.click(sharedCheckbox())
    await waitFor(() => expect(screen.queryByTitle('Apple Watch')).toBeNull())
    expect(generalTierRow()).toBeNull()
    expect(screen.getByTitle('Linen Shirt')).toBeInTheDocument()

    // And back again — hiding is a view filter, not a fetch.
    fireEvent.click(sharedCheckbox())
    await waitFor(() => expect(generalTierRow()).not.toBeNull())
  })

  it('a search looks in the shared wardrobes too, and honours the toggle', async () => {
    renderDialog()
    await screen.findByTitle('Linen Shirt')

    fireEvent.change(screen.getByLabelText('Search wardrobe by title'), { target: { value: 'watch' } })
    expect(await screen.findByTitle('Apple Watch')).toBeInTheDocument()
    expect(screen.getByText('Searching everywhere')).toBeInTheDocument()

    fireEvent.click(sharedCheckbox())
    await waitFor(() => expect(screen.queryByTitle('Apple Watch')).toBeNull())
  })

  it('leaves the archived toggle alone', async () => {
    renderDialog()

    await waitFor(() => expect(generalTierRow()).not.toBeNull())
    const archived = screen.getByLabelText('Show archived')
    expect(archived).not.toBeChecked()

    fireEvent.click(sharedCheckbox())
    await waitFor(() => expect(generalTierRow()).toBeNull())
    expect(archived).not.toBeChecked()
  })
})
