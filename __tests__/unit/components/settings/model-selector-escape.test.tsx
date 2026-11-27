/**
 * #257 — Escape in the model search box closes the list, not the dialog
 * around it; with the list already closed, Escape still closes the dialog.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import React, { useState } from 'react'
import { ModelSelector } from '@/components/settings/model-selector'
import { BaseModal } from '@/components/ui/BaseModal'

const MODELS = Array.from({ length: 11 }, (_, i) => `model-${i}`)

function Harness({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('')
  return (
    <BaseModal isOpen onClose={onClose} title="Edit Connection Profile">
      <ModelSelector id="m" models={MODELS} value={value} onChange={setValue} placeholder="Select or search a model" />
    </BaseModal>
  )
}

describe('ModelSelector search box Escape', () => {
  it('closes only the list while it is open', () => {
    const onClose = jest.fn()
    render(<Harness onClose={onClose} />)
    const search = screen.getByPlaceholderText('Select or search a model')
    fireEvent.focus(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
