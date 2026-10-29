/**
 * A topmost FloatingDialog (the always-on Brahma Console) floats over whatever
 * modal is open. Using it must not dismiss that modal, and Escape must close
 * only the surface it was pressed in.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { FloatingDialog } from '@/components/ui/FloatingDialog'
import { BaseModal } from '@/components/ui/BaseModal'

function renderBoth() {
  const closeDialog = jest.fn()
  const closeModal = jest.fn()
  render(
    <>
      <BaseModal isOpen onClose={closeModal} title="A form">
        <input aria-label="form field" />
      </BaseModal>
      <FloatingDialog isOpen onClose={closeDialog} title="Console" storageKey="test:geo" topmost>
        <textarea aria-label="console composer" />
      </FloatingDialog>
    </>
  )
  return { closeDialog, closeModal }
}

describe('FloatingDialog topmost', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; the dialog only uses it to persist geometry.
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  beforeEach(() => localStorage.clear())

  it('carries the topmost class and the floating-layer marker', () => {
    renderBoth()
    const dialog = screen.getByLabelText('console composer').closest('.qt-floating-dialog')
    expect(dialog).toHaveClass('qt-floating-dialog-topmost')
    expect(dialog).toHaveAttribute('data-qt-floating-layer')
  })

  it('clicking inside it leaves the modal beneath open', () => {
    const { closeModal, closeDialog } = renderBoth()
    fireEvent.mouseDown(screen.getByLabelText('console composer'))
    expect(closeModal).not.toHaveBeenCalled()
    expect(closeDialog).not.toHaveBeenCalled()
  })

  it('Escape inside it closes only the dialog', () => {
    const { closeModal, closeDialog } = renderBoth()
    fireEvent.keyDown(screen.getByLabelText('console composer'), { key: 'Escape' })
    expect(closeDialog).toHaveBeenCalledTimes(1)
    expect(closeModal).not.toHaveBeenCalled()
  })

  it('Escape in the modal closes only the modal', () => {
    const { closeModal, closeDialog } = renderBoth()
    fireEvent.keyDown(screen.getByLabelText('form field'), { key: 'Escape' })
    expect(closeModal).toHaveBeenCalledTimes(1)
    expect(closeDialog).not.toHaveBeenCalled()
  })
})
