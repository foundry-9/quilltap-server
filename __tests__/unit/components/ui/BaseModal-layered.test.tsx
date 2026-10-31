/**
 * Only the dialog on top answers an outside click or Escape. A dialog opened
 * over a BaseModal (a picker's Move to…, a confirmation) is portaled outside
 * it, so before this its clicks read as "outside" the modal beneath and one
 * Escape closed both.
 */

import React from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { BaseModal } from '@/components/ui/BaseModal'

function Stack({ onCloseOuter, onCloseInner, inner }: { onCloseOuter: () => void; onCloseInner: () => void; inner: boolean }) {
  return (
    <>
      <BaseModal isOpen onClose={onCloseOuter} title="Picker">
        <button type="button">Outer button</button>
      </BaseModal>
      <BaseModal isOpen={inner} onClose={onCloseInner} title="Move to">
        <button type="button">Inner option</button>
      </BaseModal>
    </>
  )
}

describe('BaseModal layering', () => {
  it('a click inside a dialog over it does not close the modal beneath', () => {
    const outer = jest.fn()
    const inner = jest.fn()
    const { getByText } = render(<Stack onCloseOuter={outer} onCloseInner={inner} inner />)
    fireEvent.mouseDown(getByText('Inner option'))
    expect(outer).not.toHaveBeenCalled()
    expect(inner).not.toHaveBeenCalled()
  })

  it('Escape with focus in the dialog on top closes only that one', () => {
    const outer = jest.fn()
    const inner = jest.fn()
    const { getByText } = render(<Stack onCloseOuter={outer} onCloseInner={inner} inner />)
    const option = getByText('Inner option')
    act(() => option.focus())
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('an open confirmation owns Escape even without focus', () => {
    const outer = jest.fn()
    const { getByText } = render(
      <>
        <BaseModal isOpen onClose={outer} title="Picker">
          <button type="button">Outer button</button>
        </BaseModal>
        <div role="alertdialog">Delete it?</div>
      </>,
    )
    fireEvent.keyDown(getByText('Outer button'), { key: 'Escape' })
    expect(outer).not.toHaveBeenCalled()
  })

  it('alone, it still closes on Escape and on an outside click', () => {
    const outer = jest.fn()
    render(<Stack onCloseOuter={outer} onCloseInner={jest.fn()} inner={false} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(outer).toHaveBeenCalledTimes(2)
  })
})
