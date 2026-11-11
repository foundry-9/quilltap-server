/**
 * The shell's own props (refactor 4.13, "One modal shell"): role, subtitle,
 * busy, headerless + ModalTitle, the stack by DOM order, and the portal.
 */

import React, { useState } from 'react'
import { render, fireEvent, screen, act } from '@testing-library/react'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { WizardModal } from '@/components/ui/WizardModal'

describe('BaseModal shell', () => {
  it('portals to document.body, outside the isolated workspace', () => {
    const { container } = render(
      <div className="qt-workspace">
        <BaseModal isOpen onClose={jest.fn()} title="Portaled">
          <p>body</p>
        </BaseModal>
      </div>,
    )
    const dialog = screen.getByRole('dialog')
    expect(container.contains(dialog)).toBe(false)
    expect(document.body.contains(dialog)).toBe(true)
  })

  it('is labelled by its title and described by its subtitle', () => {
    render(
      <BaseModal isOpen onClose={jest.fn()} title="Export Data" subtitle="Step 1 of 4">
        <p>body</p>
      </BaseModal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Export Data' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Step 1 of 4')
  })

  it('takes role="alertdialog" for destructive confirms', () => {
    render(
      <BaseModal isOpen onClose={jest.fn()} title="Delete it?" role="alertdialog">
        <p>gone for good</p>
      </BaseModal>,
    )
    expect(screen.getByRole('alertdialog', { name: 'Delete it?' })).toBeInTheDocument()
  })

  it('a headerless modal is named by its ModalTitle', () => {
    render(
      <BaseModal isOpen onClose={jest.fn()} headerless>
        <div className="my-own-header">
          <ModalTitle>File preview</ModalTitle>
        </div>
      </BaseModal>,
    )
    const dialog = screen.getByRole('dialog', { name: 'File preview' })
    expect(dialog.querySelector('.qt-dialog-header')).toBeNull()
  })

  it('while busy, Escape, the backdrop and the close button do nothing', () => {
    const onClose = jest.fn()
    const { rerender } = render(
      <BaseModal isOpen onClose={onClose} title="Backing up" busy showCloseButton>
        <p>working</p>
      </BaseModal>,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')

    rerender(
      <BaseModal isOpen onClose={onClose} title="Backing up" showCloseButton>
        <p>done</p>
      </BaseModal>,
    )
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnClickOutside={false} keeps Escape working', () => {
    const onClose = jest.fn()
    render(
      <BaseModal isOpen onClose={onClose} title="A form" closeOnClickOutside={false}>
        <input aria-label="field" />
      </BaseModal>,
    )
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('the stack', () => {
    function Parent({ onCloseParent, onCloseChild }: { onCloseParent: () => void; onCloseChild: () => void }) {
      const [childOpen, setChildOpen] = useState(false)
      return (
        <BaseModal isOpen onClose={onCloseParent} title="Add Character">
          <button type="button" onClick={() => setChildOpen(true)}>Summon</button>
          <BaseModal isOpen={childOpen} onClose={() => { onCloseChild(); setChildOpen(false) }} title="Summon from Lore">
            <button type="button">Child option</button>
          </BaseModal>
        </BaseModal>
      )
    }

    it('a click inside a child opened from the parent is not outside the parent', () => {
      const parent = jest.fn()
      const child = jest.fn()
      render(<Parent onCloseParent={parent} onCloseChild={child} />)
      fireEvent.click(screen.getByText('Summon'))
      fireEvent.mouseDown(screen.getByText('Child option'))
      expect(parent).not.toHaveBeenCalled()
      expect(child).not.toHaveBeenCalled()
    })

    it('Escape closes only the topmost, even before focus moves into it', () => {
      const parent = jest.fn()
      const child = jest.fn()
      render(<Parent onCloseParent={parent} onCloseChild={child} />)
      const opener = screen.getByText('Summon')
      act(() => opener.focus())
      fireEvent.click(opener)
      // Focus is still on the opener inside the parent.
      fireEvent.keyDown(opener, { key: 'Escape' })
      expect(child).toHaveBeenCalledTimes(1)
      expect(parent).not.toHaveBeenCalled()
      // With the child gone, the parent answers again.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(parent).toHaveBeenCalledTimes(1)
    })

    it('a backdrop click with a child open closes only the child', () => {
      const parent = jest.fn()
      const child = jest.fn()
      render(<Parent onCloseParent={parent} onCloseChild={child} />)
      fireEvent.click(screen.getByText('Summon'))
      fireEvent.mouseDown(document.body)
      expect(child).toHaveBeenCalledTimes(1)
      expect(parent).not.toHaveBeenCalled()
    })
  })
})

describe('WizardModal', () => {
  it('shows the step, guards Back and Cancel while busy, and becomes one Close when done', () => {
    const onClose = jest.fn()
    const onBack = jest.fn()
    const next = jest.fn()
    const { rerender } = render(
      <WizardModal onClose={onClose} title="Export Data" step={{ current: 2, total: 4 }} onBack={onBack} primary={{ label: 'Next', onClick: next }}>
        <p>step body</p>
      </WizardModal>,
    )
    expect(screen.getByRole('dialog', { name: 'Export Data' })).toHaveAccessibleDescription('Step 2 of 4')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(next).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)

    rerender(
      <WizardModal onClose={onClose} title="Export Data" step={{ current: 3, total: 4 }} onBack={onBack} busy primary={{ label: 'Exporting…', onClick: next, disabled: true }}>
        <p>working</p>
      </WizardModal>,
    )
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    rerender(
      <WizardModal onClose={onClose} title="Export Data" done>
        <p>all done</p>
      </WizardModal>,
    )
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    // The header close button and the footer's Close are both named "Close".
    const closes = screen.getAllByRole('button', { name: 'Close' })
    fireEvent.click(closes[closes.length - 1])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
