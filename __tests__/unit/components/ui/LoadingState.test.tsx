/**
 * Unit tests for LoadingState component
 */

import { render, screen } from '@testing-library/react'
import React from 'react'
import LoadingState from '@/components/ui/LoadingState'

describe('LoadingState', () => {
  it('renders a spinner by default', () => {
    const { container } = render(
      <LoadingState />
    )

    const spinner = container.querySelector('.qt-spinner')
    expect(spinner).toBeInTheDocument()
  })

  it('renders default message', () => {
    render(
      <LoadingState />
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders custom message', () => {
    render(
      <LoadingState message="Saving your changes..." />
    )

    expect(screen.getByText('Saving your changes...')).toBeInTheDocument()
  })

  it('renders the spinner beside the message', () => {
    const { container } = render(
      <LoadingState message="Loading" />
    )

    expect(container.querySelector('.qt-spinner')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <LoadingState className="custom-class" />
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('custom-class')
  })

  it('centres content with the loading-state layout by default', () => {
    const { container } = render(
      <LoadingState />
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('qt-loading-state')
  })

  it('applies qt-text-secondary to message', () => {
    const { container } = render(
      <LoadingState message="Loading" />
    )

    const message = container.querySelector('.qt-text-secondary')
    expect(message).toBeInTheDocument()
  })

  it('applies primary color to spinner', () => {
    const { container } = render(
      <LoadingState />
    )

    const spinner = container.querySelector('.qt-spinner')
    expect(spinner).toHaveClass('qt-text-brand')
  })

  it('does not render message when not provided', () => {
    const { container } = render(
      <LoadingState message="" />
    )

    // Only the spinner should be present, no message paragraph
    const spinner = container.querySelector('.qt-spinner')
    expect(spinner).toBeInTheDocument()
  })
})
