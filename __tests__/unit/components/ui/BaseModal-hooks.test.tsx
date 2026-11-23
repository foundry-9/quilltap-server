/**
 * BaseModal's theme hooks (Calliope Live, Spec B): the body and footer always
 * carry their identity class, whatever the caller passes; the default look is
 * a separate `-default` modifier; the close button is `qt-dialog-close`.
 */

import React from 'react'
import { render, screen } from '@testing-library/react'
import { BaseModal } from '@/components/ui/BaseModal'

function bodyOf(text: string): HTMLElement {
  return screen.getByText(text).parentElement as HTMLElement
}

describe('BaseModal theme hooks', () => {
  it('gives an unconfigured body and footer the hook and the default look', () => {
    render(
      <BaseModal isOpen onClose={jest.fn()} title="Plain" footer={<button type="button">OK</button>} showCloseButton>
        <p>plain body</p>
      </BaseModal>,
    )
    expect(bodyOf('plain body')).toHaveClass('qt-dialog-body', 'qt-dialog-body-default', 'flex-1', 'overflow-y-auto')
    const footer = screen.getByRole('button', { name: 'OK' }).parentElement as HTMLElement
    expect(footer).toHaveClass('qt-dialog-footer', 'qt-dialog-footer-default')
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('qt-dialog-close')
  })

  it('keeps the hook but drops the default look when the caller lays out its own', () => {
    render(
      <BaseModal
        isOpen
        onClose={jest.fn()}
        title="Custom"
        bodyClassName="p-6 overflow-y-auto"
        footer={<button type="button">Go</button>}
        footerClassName="flex justify-end"
      >
        <p>custom body</p>
      </BaseModal>,
    )
    const body = bodyOf('custom body')
    expect(body).toHaveClass('qt-dialog-body', 'p-6')
    expect(body).not.toHaveClass('qt-dialog-body-default')
    const footer = screen.getByRole('button', { name: 'Go' }).parentElement as HTMLElement
    expect(footer).toHaveClass('qt-dialog-footer', 'flex')
    expect(footer).not.toHaveClass('qt-dialog-footer-default')
  })

  it('an empty body class string still leaves the hook', () => {
    render(
      <BaseModal isOpen onClose={jest.fn()} title="Bare" bodyClassName="">
        <p>bare body</p>
      </BaseModal>,
    )
    expect(bodyOf('bare body').className.trim()).toBe('qt-dialog-body')
  })
})
