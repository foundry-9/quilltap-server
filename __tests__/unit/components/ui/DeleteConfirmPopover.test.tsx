/**
 * Unit tests for DeleteConfirmPopover component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import DeleteConfirmPopover from '@/components/ui/DeleteConfirmPopover'

describe('DeleteConfirmPopover', () => {
  it('renders nothing when closed', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    const { container } = render(
      <DeleteConfirmPopover
        isOpen={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders popover when open', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('Delete this item?')).toBeInTheDocument()
  })

  it('displays custom message', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()
    const customMessage = 'Are you sure you want to delete this chat?'

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
        message={customMessage}
      />
    )

    expect(screen.getByText(customMessage)).toBeInTheDocument()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('calls onConfirm when delete button is clicked', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    const deleteButton = screen.getByRole('button', { name: /delete/i })
    fireEvent.click(deleteButton)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('disables buttons when isDeleting is true', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
        isDeleting={true}
      />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    const deleteButton = screen.getByRole('button', { name: /deleting/i })

    expect(cancelButton).toBeDisabled()
    expect(deleteButton).toBeDisabled()
  })

  it('shows loading state when deleting', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
        isDeleting={true}
      />
    )

    expect(screen.getByText('Deleting...')).toBeInTheDocument()
  })

  it('applies qt-popover class', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    const { container } = render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    const popover = container.querySelector('.qt-popover')
    expect(popover).toBeInTheDocument()
  })

  it('positions popover absolutely', () => {
    const onCancel = jest.fn()
    const onConfirm = jest.fn()

    const { container } = render(
      <DeleteConfirmPopover
        isOpen={true}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    const wrapper = container.querySelector('.absolute')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveClass('absolute', 'top-0', 'left-0', 'z-50')
  })
})
