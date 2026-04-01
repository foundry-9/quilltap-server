/**
 * Unit tests for SectionHeader component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import SectionHeader from '@/components/ui/SectionHeader'

describe('SectionHeader', () => {
  it('renders title', () => {
    render(
      <SectionHeader
        title="Characters"
      />
    )

    expect(screen.getByText('Characters')).toBeInTheDocument()
  })

  it('renders count in parentheses after title', () => {
    render(
      <SectionHeader
        title="Characters"
        count={5}
      />
    )

    expect(screen.getByText('Characters (5)')).toBeInTheDocument()
  })

  it('renders without count when not provided', () => {
    render(
      <SectionHeader
        title="Characters"
      />
    )

    expect(screen.getByText('Characters')).toBeInTheDocument()
  })

  it('renders h3 by default', () => {
    const { container } = render(
      <SectionHeader
        title="Characters"
      />
    )

    const heading = container.querySelector('h3')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Characters')
  })

  it('renders h2 when specified', () => {
    const { container } = render(
      <SectionHeader
        title="Characters"
        level="h2"
      />
    )

    const heading = container.querySelector('h2')
    expect(heading).toBeInTheDocument()
    expect(heading?.textContent).toBe('Characters')
  })

  it('renders action button when provided', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add Character',
          onClick: onAction,
        }}
      />
    )

    expect(screen.getByRole('button', { name: /add character/i })).toBeInTheDocument()
  })

  it('calls action handler when button is clicked', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add Character',
          onClick: onAction,
        }}
      />
    )

    const button = screen.getByRole('button', { name: /add character/i })
    fireEvent.click(button)

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('hides action button when show is false', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add Character',
          onClick: onAction,
          show: false,
        }}
      />
    )

    expect(screen.queryByRole('button', { name: /add character/i })).not.toBeInTheDocument()
  })

  it('shows action button when show is true (default)', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add Character',
          onClick: onAction,
          show: true,
        }}
      />
    )

    expect(screen.getByRole('button', { name: /add character/i })).toBeInTheDocument()
  })

  it('shows action button when show is not specified (default)', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add Character',
          onClick: onAction,
        }}
      />
    )

    expect(screen.getByRole('button', { name: /add character/i })).toBeInTheDocument()
  })

  it('applies qt-text-section class', () => {
    const { container } = render(
      <SectionHeader
        title="Characters"
      />
    )

    const heading = container.querySelector('.qt-text-section')
    expect(heading).toBeInTheDocument()
  })

  it('applies qt-button-secondary class to action button', () => {
    const { container } = render(
      <SectionHeader
        title="Characters"
        action={{
          label: 'Add',
          onClick: () => {},
        }}
      />
    )

    const button = container.querySelector('.qt-button-secondary')
    expect(button).toBeInTheDocument()
  })

  it('renders with title and count together', () => {
    render(
      <SectionHeader
        title="Characters"
        count={3}
      />
    )

    const title = screen.getByText('Characters (3)')
    expect(title).toBeInTheDocument()
  })

  it('renders with all props', () => {
    const onAction = jest.fn()

    render(
      <SectionHeader
        title="Characters"
        count={5}
        level="h2"
        action={{
          label: 'Add',
          onClick: onAction,
        }}
      />
    )

    const heading = screen.getByText('Characters (5)')
    expect(heading.tagName).toBe('H2')
    expect(screen.getByRole('button')).toBeInTheDocument()
  })
})
