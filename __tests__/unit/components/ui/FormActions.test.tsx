/**
 * Unit tests for FormActions component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import FormActions from '@/components/ui/FormActions'

describe('FormActions', () => {
  it('renders cancel button', () => {
    const onCancel = jest.fn()

    render(
      <FormActions onCancel={onCancel} />
    )

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('renders submit button when onSubmit is provided', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} />
    )

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('does not render submit button when onSubmit is not provided and type is not submit', () => {
    render(
      <FormActions onCancel={() => {}} />
    )

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })

  it('renders submit button when type="submit" even without onSubmit', () => {
    render(
      <FormActions onCancel={() => {}} type="submit" submitLabel="Create" />
    )

    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = jest.fn()

    render(
      <FormActions onCancel={onCancel} />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onSubmit when submit button is clicked', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} />
    )

    const submitButton = screen.getByRole('button', { name: /save/i })
    fireEvent.click(submitButton)

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('uses custom submit label', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} submitLabel="Create" />
    )

    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
  })

  it('uses custom cancel label', () => {
    const onCancel = jest.fn()

    render(
      <FormActions onCancel={onCancel} cancelLabel="Close" />
    )

    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('uses default labels', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} />
    )

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
  })

  it('disables buttons when isLoading is true', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} isLoading={true} />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    const submitButton = screen.getByRole('button', { name: /save/i })

    expect(cancelButton).toBeDisabled()
    expect(submitButton).toBeDisabled()
  })

  it('disables buttons when isDisabled is true', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} isDisabled={true} />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    const submitButton = screen.getByRole('button', { name: /save/i })

    expect(cancelButton).toBeDisabled()
    expect(submitButton).toBeDisabled()
  })

  it('shows loading state on submit button', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} isLoading={true} />
    )

    // When loading, the button should show "Save" but be disabled with spinner
    const submitButton = screen.getByRole('button', { name: /save/i })
    expect(submitButton).toBeDisabled()

    // Check for spinner
    const spinner = submitButton.querySelector('.qt-spinner-sm')
    expect(spinner).toBeInTheDocument()
  })

  it('applies qt-button-secondary to cancel button', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} />
    )

    const button = container.querySelector('.qt-button-secondary')
    expect(button).toBeInTheDocument()
  })

  it('applies qt-button-primary to submit button', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} onSubmit={() => {}} />
    )

    const button = container.querySelector('.qt-button-primary')
    expect(button).toBeInTheDocument()
  })

  it('renders cancel button with type="button"', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} />
    )

    const buttons = container.querySelectorAll('button')
    const cancelButton = Array.from(buttons).find(b => b.textContent.includes('Cancel'))
    expect(cancelButton).toHaveAttribute('type', 'button')
  })

  it('renders submit button with default type="button"', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} onSubmit={() => {}} />
    )

    const buttons = container.querySelectorAll('button')
    const submitButton = Array.from(buttons).find(b => b.textContent.includes('Save'))
    expect(submitButton).toHaveAttribute('type', 'button')
  })

  it('renders submit button with type="submit" when specified', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} onSubmit={() => {}} type="submit" />
    )

    const buttons = container.querySelectorAll('button')
    const submitButton = Array.from(buttons).find(b => b.textContent.includes('Save'))
    expect(submitButton).toHaveAttribute('type', 'submit')
  })

  it('prevents interaction when loading', () => {
    const onCancel = jest.fn()
    const onSubmit = jest.fn()

    render(
      <FormActions onCancel={onCancel} onSubmit={onSubmit} isLoading={true} />
    )

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    const submitButton = screen.getByRole('button', { name: /save/i })

    fireEvent.click(cancelButton)
    fireEvent.click(submitButton)

    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('uses gap-2 for spacing between buttons', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} onSubmit={() => {}} />
    )

    const wrapper = container.querySelector('.flex')
    expect(wrapper).toHaveClass('gap-2')
  })

  it('aligns buttons to the end', () => {
    const { container } = render(
      <FormActions onCancel={() => {}} onSubmit={() => {}} />
    )

    const wrapper = container.querySelector('.flex')
    expect(wrapper).toHaveClass('justify-end')
  })
})
