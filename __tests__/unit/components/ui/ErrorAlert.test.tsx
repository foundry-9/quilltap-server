/**
 * Unit tests for ErrorAlert component
 */

import { describe, it, expect } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ErrorAlert from '@/components/ui/ErrorAlert'

describe('ErrorAlert', () => {
  it('renders error message', () => {
    const message = 'Something went wrong'

    render(
      <ErrorAlert message={message} />
    )

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('does not render retry button when onRetry is not provided', () => {
    render(
      <ErrorAlert message="Something went wrong" />
    )

    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn()

    render(
      <ErrorAlert message="Something went wrong" onRetry={onRetry} />
    )

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = jest.fn()

    render(
      <ErrorAlert message="Something went wrong" onRetry={onRetry} />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('applies qt-alert-error class', () => {
    const { container } = render(
      <ErrorAlert message="Error occurred" />
    )

    const alert = container.querySelector('.qt-alert-error')
    expect(alert).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <ErrorAlert message="Error" className="custom-class" />
    )

    const alert = container.querySelector('.qt-alert-error')
    expect(alert).toHaveClass('custom-class')
  })

  it('applies qt-button-ghost class to retry button', () => {
    const { container } = render(
      <ErrorAlert message="Error" onRetry={() => {}} />
    )

    const button = container.querySelector('.qt-button-ghost')
    expect(button).toBeInTheDocument()
  })

  it('displays message as semantic label text', () => {
    const { container } = render(
      <ErrorAlert message="Error occurred" />
    )

    const messageParagraph = container.querySelector('.qt-label')
    expect(messageParagraph).toBeInTheDocument()
    expect(messageParagraph?.textContent).toBe('Error occurred')
  })

  it('applies qt-label class to message', () => {
    const { container } = render(
      <ErrorAlert message="Error" />
    )

    const messageParagraph = container.querySelector('.qt-label')
    expect(messageParagraph).toBeInTheDocument()
  })

  it('renders with long error message', () => {
    const longMessage = 'This is a very long error message that explains what went wrong in detail and provides helpful information to the user'

    render(
      <ErrorAlert message={longMessage} />
    )

    expect(screen.getByText(longMessage)).toBeInTheDocument()
  })

  it('renders with special characters in message', () => {
    const message = 'Failed to save: "user data" (error 404)'

    render(
      <ErrorAlert message={message} />
    )

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('allows multiple retry attempts', () => {
    const onRetry = jest.fn()

    render(
      <ErrorAlert message="Error" onRetry={onRetry} />
    )

    const retryButton = screen.getByRole('button', { name: /retry/i })

    fireEvent.click(retryButton)
    fireEvent.click(retryButton)
    fireEvent.click(retryButton)

    expect(onRetry).toHaveBeenCalledTimes(3)
  })

  it('maintains flex layout for content alignment', () => {
    const { container } = render(
      <ErrorAlert message="Error" onRetry={() => {}} />
    )

    const wrapper = container.querySelector('.flex')
    expect(wrapper).toHaveClass('flex', 'items-center', 'justify-between', 'gap-4')
  })
})
