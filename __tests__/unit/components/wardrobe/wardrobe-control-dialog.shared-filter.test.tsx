/**
 * The Wardrobe dialog's "Show shared" toggle.
 *
 * The character view lists the merge of the character's own garments with
 * every shared tier above them (group / project / Quilltap General). Those
 * borrowed rows are badged `· shared` and can't be edited from here, and when
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
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React, { useEffect } from 'react'

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

/** A Quilltap General archetype merged in from above — badged `· shared`. */
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
  render(
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

describe('WardrobeControlDialog — Show shared', () => {
  it('lists shared items by default and drops them when unticked, keeping the character’s own', async () => {
    renderDialog()

    // Default on: the merged list shows both tiers.
    expect(await screen.findByTitle('Apple Watch')).toBeInTheDocument()
    expect(screen.getByTitle('Linen Shirt')).toBeInTheDocument()
    expect(sharedCheckbox()).toBeChecked()

    fireEvent.click(sharedCheckbox())

    await waitFor(() => expect(screen.queryByTitle('Apple Watch')).toBeNull())
    expect(screen.getByTitle('Linen Shirt')).toBeInTheDocument()

    // And back again — hiding is a view filter, not a fetch.
    fireEvent.click(sharedCheckbox())
    expect(await screen.findByTitle('Apple Watch')).toBeInTheDocument()
  })

  it('leaves the archived toggle alone', async () => {
    renderDialog()

    await screen.findByTitle('Apple Watch')
    const archived = screen.getByLabelText('Show archived')
    expect(archived).not.toBeChecked()

    fireEvent.click(sharedCheckbox())
    await waitFor(() => expect(screen.queryByTitle('Apple Watch')).toBeNull())
    expect(archived).not.toBeChecked()
  })
})
