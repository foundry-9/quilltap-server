/**
 * Unit tests for EmptyState component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import EmptyState from '@/components/ui/EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    render(
      <EmptyState
        title="No items found"
      />
    )

    expect(screen.getByText('No items found')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    const description = 'You haven\'t created any items yet.'

    render(
      <EmptyState
        title="No items found"
        description={description}
      />
    )

    expect(screen.getByText(description)).toBeInTheDocument()
  })

  it('does not render description when not provided', () => {
    render(
      <EmptyState
        title="No items found"
      />
    )

    const description = 'You haven\'t created any items yet.'
    expect(screen.queryByText(description)).not.toBeInTheDocument()
  })

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="No items found"
        icon={<div data-testid="custom-icon">📭</div>}
      />
    )

    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('renders action button when provided', () => {
    const onAction = jest.fn()

    render(
      <EmptyState
        title="No items found"
        action={{
          label: 'Create Item',
          onClick: onAction,
        }}
      />
    )

    expect(screen.getByRole('button', { name: /create item/i })).toBeInTheDocument()
  })

  it('calls action handler when button is clicked', () => {
    const onAction = jest.fn()

    render(
      <EmptyState
        title="No items found"
        action={{
          label: 'Create Item',
          onClick: onAction,
        }}
      />
    )

    const button = screen.getByRole('button', { name: /create item/i })
    fireEvent.click(button)

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('applies default variant classes', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        variant="default"
      />
    )

    const emptyState = container.querySelector('.qt-empty-state')
    expect(emptyState).toHaveClass('bg-muted', 'border', 'border-border')
  })

  it('applies dashed variant classes', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        variant="dashed"
      />
    )

    const emptyState = container.querySelector('.qt-empty-state')
    expect(emptyState).toHaveClass('border', 'border-dashed', 'border-border')
    expect(emptyState).not.toHaveClass('bg-muted')
  })

  it('applies muted variant classes', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        variant="muted"
      />
    )

    const emptyState = container.querySelector('.qt-empty-state')
    expect(emptyState).toHaveClass('bg-muted/50')
  })

  it('applies qt-empty-state class', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
      />
    )

    const emptyState = container.querySelector('.qt-empty-state')
    expect(emptyState).toBeInTheDocument()
  })

  it('applies qt-empty-state-title class to title', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
      />
    )

    const title = container.querySelector('.qt-empty-state-title')
    expect(title).toBeInTheDocument()
  })

  it('applies qt-empty-state-description class to description', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        description="Try creating one"
      />
    )

    const description = container.querySelector('.qt-empty-state-description')
    expect(description).toBeInTheDocument()
  })

  it('applies qt-empty-state-icon class to icon', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        icon={<div>📭</div>}
      />
    )

    const icon = container.querySelector('.qt-empty-state-icon')
    expect(icon).toBeInTheDocument()
  })

  it('applies qt-empty-state-action class to action container', () => {
    const { container } = render(
      <EmptyState
        title="No items found"
        action={{
          label: 'Create',
          onClick: () => {},
        }}
      />
    )

    const action = container.querySelector('.qt-empty-state-action')
    expect(action).toBeInTheDocument()
  })
})
