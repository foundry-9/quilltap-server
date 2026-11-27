/**
 * The shared Move / Copy to another tier dialog (the Inventory's and the
 * Atlas's): the item's home is left out of the destinations, Submit waits
 * for a choice, a success closes with the kind's toast, and a refusal keeps
 * the dialog open with the kind's wording.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ItemTransferDialog, type ItemTransferWording } from '@/components/item-browser/ItemTransferDialog'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const CATALOGUE = {
  characters: [{ id: 'c1', name: 'Imogen' }],
  projects: [{ id: 'p1', name: 'The Manor' }],
  groups: [],
} as unknown as Parameters<typeof ItemTransferDialog>[0]['catalogue']

const WORDING: ItemTransferWording = {
  title: (verb) => `${verb} "Bow" to another inventory`,
  selectId: 'transfer-target',
  generalName: 'Quilltap General',
  placeholder: 'Choose an inventory',
  done: (mode) => `done ${mode}`,
  describeError: (_e, fallback) => `refused: ${fallback}`,
  failed: (mode) => `would not ${mode}`,
}

function renderDialog(transfer: jest.Mock, onClose = jest.fn()) {
  renderWithQuery(
    <ItemTransferDialog
      mode="move"
      from={{ scope: 'general', id: null }}
      catalogue={CATALOGUE}
      wording={WORDING}
      note="It keeps its identity."
      transfer={transfer}
      onClose={onClose}
    />,
  )
  return { onClose }
}

describe('ItemTransferDialog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('leaves the home tier out and waits for a destination', () => {
    renderDialog(jest.fn())
    expect(screen.getByText('Move "Bow" to another inventory')).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Quilltap General' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled()
  })

  it('sends the chosen destination, toasts and closes', async () => {
    const transfer = jest.fn(async () => undefined)
    const { onClose } = renderDialog(transfer)
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'project:p1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(transfer).toHaveBeenCalledWith({ scope: 'project', id: 'p1' })
    expect(showSuccessToast).toHaveBeenCalledWith('done move')
  })

  it('keeps the dialog open on a refusal', async () => {
    const transfer = jest.fn(async () => { throw new Error('no') })
    const { onClose } = renderDialog(transfer)
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'character:c1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('refused: would not move'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
