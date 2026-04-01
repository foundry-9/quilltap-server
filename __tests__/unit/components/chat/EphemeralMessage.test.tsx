/**
 * Unit tests for EphemeralMessage component
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import {
  EphemeralMessage,
  createEphemeralMessage,
  EphemeralMessageData,
  EphemeralMessageType,
} from '@/components/chat/EphemeralMessage'

// Mock the client logger to avoid issues with logging during tests
jest.mock('@/lib/client-logger', () => ({
  clientLogger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}))

describe('EphemeralMessage', () => {
  const baseMessage: EphemeralMessageData = {
    id: 'ephemeral-test-1',
    type: 'nudge',
    participantId: 'participant-1',
    participantName: 'Alice',
    timestamp: Date.now(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('renders message content', () => {
    it('renders nudge message with default content', () => {
      render(<EphemeralMessage message={{ ...baseMessage, type: 'nudge' }} />)

      expect(screen.getByText('Alice was asked to speak')).toBeInTheDocument()
    })

    it('renders join message with default content', () => {
      render(<EphemeralMessage message={{ ...baseMessage, type: 'join' }} />)

      expect(screen.getByText('Alice has joined the conversation')).toBeInTheDocument()
    })

    it('renders queue message with default content', () => {
      render(<EphemeralMessage message={{ ...baseMessage, type: 'queue' }} />)

      expect(screen.getByText('Alice was added to the queue')).toBeInTheDocument()
    })

    it('renders dequeue message with default content', () => {
      render(<EphemeralMessage message={{ ...baseMessage, type: 'dequeue' }} />)

      expect(screen.getByText('Alice was removed from the queue')).toBeInTheDocument()
    })

    it('renders custom content when provided', () => {
      const customContent = 'This is a custom message'
      render(
        <EphemeralMessage
          message={{ ...baseMessage, content: customContent }}
        />
      )

      expect(screen.getByText(customContent)).toBeInTheDocument()
    })

    it('prefers custom content over default content', () => {
      const customContent = 'Custom override'
      render(
        <EphemeralMessage
          message={{ ...baseMessage, type: 'nudge', content: customContent }}
        />
      )

      expect(screen.getByText(customContent)).toBeInTheDocument()
      expect(screen.queryByText('Alice was asked to speak')).not.toBeInTheDocument()
    })
  })

  describe('system message type', () => {
    it('returns null when system type has no content', () => {
      const { container } = render(
        <EphemeralMessage message={{ ...baseMessage, type: 'system' }} />
      )

      expect(container.firstChild).toBeNull()
    })

    it('renders system type with custom content', () => {
      render(
        <EphemeralMessage
          message={{ ...baseMessage, type: 'system', content: 'System notification' }}
        />
      )

      expect(screen.getByText('System notification')).toBeInTheDocument()
    })
  })

  describe('dismiss functionality', () => {
    it('shows dismiss button when onDismiss is provided', () => {
      const onDismiss = jest.fn()
      render(<EphemeralMessage message={baseMessage} onDismiss={onDismiss} />)

      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      expect(dismissButton).toBeInTheDocument()
    })

    it('does not show dismiss button when onDismiss is not provided', () => {
      render(<EphemeralMessage message={baseMessage} />)

      expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
    })

    it('calls onDismiss with message id when dismiss button is clicked', () => {
      const onDismiss = jest.fn()
      render(<EphemeralMessage message={baseMessage} onDismiss={onDismiss} />)

      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      fireEvent.click(dismissButton)

      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDismiss).toHaveBeenCalledWith('ephemeral-test-1')
    })
  })

  describe('styling and animation', () => {
    it('applies centered layout classes', () => {
      const { container } = render(<EphemeralMessage message={baseMessage} />)

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex', 'justify-center')
    })

    it('applies animation classes for fade-in effect', () => {
      const { container } = render(<EphemeralMessage message={baseMessage} />)

      const messageDiv = container.querySelector('.animate-in')
      expect(messageDiv).toBeInTheDocument()
      expect(messageDiv).toHaveClass('fade-in', 'slide-in-from-bottom-2', 'duration-300')
    })

    it('wraps content with asterisks', () => {
      const { container } = render(<EphemeralMessage message={baseMessage} />)

      const asterisks = container.querySelectorAll('.opacity-75')
      expect(asterisks).toHaveLength(2)
      expect(asterisks[0].textContent).toBe('*')
      expect(asterisks[1].textContent).toBe('*')
    })

    it('applies italic text styling', () => {
      const { container } = render(<EphemeralMessage message={baseMessage} />)

      const messageDiv = container.querySelector('.italic')
      expect(messageDiv).toBeInTheDocument()
    })

    it('applies rounded-full styling for pill appearance', () => {
      const { container } = render(<EphemeralMessage message={baseMessage} />)

      const messageDiv = container.querySelector('.rounded-full')
      expect(messageDiv).toBeInTheDocument()
    })
  })

  describe('different participant names', () => {
    it('handles names with special characters', () => {
      render(
        <EphemeralMessage
          message={{ ...baseMessage, participantName: "O'Brien" }}
        />
      )

      expect(screen.getByText("O'Brien was asked to speak")).toBeInTheDocument()
    })

    it('handles empty participant name', () => {
      render(
        <EphemeralMessage
          message={{ ...baseMessage, participantName: '' }}
        />
      )

      expect(screen.getByText('was asked to speak')).toBeInTheDocument()
    })

    it('handles long participant names', () => {
      const longName = 'A Very Long Character Name That Goes On And On'
      render(
        <EphemeralMessage
          message={{ ...baseMessage, participantName: longName }}
        />
      )

      expect(screen.getByText(`${longName} was asked to speak`)).toBeInTheDocument()
    })
  })
})

describe('createEphemeralMessage', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('creates a message with correct type', () => {
    const message = createEphemeralMessage('nudge', 'p1', 'Alice')
    expect(message.type).toBe('nudge')
  })

  it('creates a message with correct participantId', () => {
    const message = createEphemeralMessage('nudge', 'participant-123', 'Alice')
    expect(message.participantId).toBe('participant-123')
  })

  it('creates a message with correct participantName', () => {
    const message = createEphemeralMessage('nudge', 'p1', 'Bob')
    expect(message.participantName).toBe('Bob')
  })

  it('creates a message with timestamp', () => {
    const message = createEphemeralMessage('nudge', 'p1', 'Alice')
    expect(message.timestamp).toBe(1700000000000)
  })

  it('creates a message with unique id', () => {
    const message = createEphemeralMessage('nudge', 'p1', 'Alice')
    expect(message.id).toContain('ephemeral-nudge-')
    expect(message.id).toContain('1700000000000')
  })

  it('includes custom content when provided', () => {
    const message = createEphemeralMessage('system', 'p1', 'Alice', 'Custom content here')
    expect(message.content).toBe('Custom content here')
  })

  it('has undefined content when not provided', () => {
    const message = createEphemeralMessage('nudge', 'p1', 'Alice')
    expect(message.content).toBeUndefined()
  })

  it('creates different message types correctly', () => {
    const types: EphemeralMessageType[] = ['nudge', 'join', 'queue', 'dequeue', 'system']

    types.forEach((type) => {
      const message = createEphemeralMessage(type, 'p1', 'Alice')
      expect(message.type).toBe(type)
    })
  })
})
