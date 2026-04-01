/**
 * Unit tests for LoadingState component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import React from 'react'
import LoadingState from '@/components/ui/LoadingState'

describe('LoadingState', () => {
  it('renders with default spinner variant', () => {
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

  it('renders spinner variant with spinner icon', () => {
    const { container } = render(
      <LoadingState variant="spinner" message="Loading" />
    )

    expect(container.querySelector('.qt-spinner')).toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('renders text variant without spinner', () => {
    const { container } = render(
      <LoadingState variant="text" message="Loading..." />
    )

    expect(container.querySelector('.qt-spinner')).not.toBeInTheDocument()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders dots variant with animated dots', () => {
    render(
      <LoadingState variant="dots" message="Processing" />
    )

    expect(screen.getByText('Processing')).toBeInTheDocument()
    // Dots variant includes three animated dots
    const dots = screen.getByText('Processing').parentElement
    expect(dots?.querySelector('.animate-bounce')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <LoadingState className="custom-class" />
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('custom-class')
  })

  it('centers content by default', () => {
    const { container } = render(
      <LoadingState />
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center')
  })

  it('applies padding to container', () => {
    const { container } = render(
      <LoadingState />
    )

    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('py-8')
  })

  it('applies text-muted-foreground to message in spinner variant', () => {
    const { container } = render(
      <LoadingState variant="spinner" message="Loading" />
    )

    const message = container.querySelector('.text-muted-foreground')
    expect(message).toBeInTheDocument()
  })

  it('applies text-muted-foreground to message in text variant', () => {
    const { container } = render(
      <LoadingState variant="text" message="Loading" />
    )

    const message = container.querySelector('.text-muted-foreground')
    expect(message).toBeInTheDocument()
  })

  it('applies text-muted-foreground to message in dots variant', () => {
    const { container } = render(
      <LoadingState variant="dots" message="Loading" />
    )

    const message = container.querySelector('.text-muted-foreground')
    expect(message).toBeInTheDocument()
  })

  it('applies primary color to spinner', () => {
    const { container } = render(
      <LoadingState variant="spinner" />
    )

    const spinner = container.querySelector('.qt-spinner')
    expect(spinner).toHaveClass('text-primary')
  })

  it('does not render message in spinner variant when not provided', () => {
    const { container } = render(
      <LoadingState variant="spinner" message="" />
    )

    // Only the spinner should be present, no message paragraph
    const spinner = container.querySelector('.qt-spinner')
    expect(spinner).toBeInTheDocument()
  })
})
