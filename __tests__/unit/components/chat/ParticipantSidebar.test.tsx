/**
 * Unit tests for ParticipantSidebar component
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { ParticipantSidebar } from '@/components/chat/ParticipantSidebar'
import type { ParticipantData } from '@/components/chat/ParticipantCard'
import type { TurnState, TurnSelectionResult } from '@/lib/chat/turn-manager'


// Mock the ParticipantCard component to simplify testing the sidebar
jest.mock('@/components/chat/ParticipantCard', () => ({
  ParticipantCard: ({ participant, isCurrentTurn, queuePosition, onNudge, onQueue, onDequeue, onRemove, canRemove }: {
    participant: ParticipantData
    isCurrentTurn: boolean
    queuePosition: number
    onNudge: (id: string) => void
    onQueue: (id: string) => void
    onDequeue: (id: string) => void
    onRemove?: (id: string) => void
    canRemove?: boolean
  }) => (
    <div
      data-testid={`participant-${participant.id}`}
      className="participant-card-mock"
      data-current-turn={isCurrentTurn ? 'true' : 'false'}
      data-queue-position={queuePosition}
      data-type={participant.type}
      data-display-order={participant.displayOrder}
    >
      <span className="participant-name">
        {participant.type === 'CHARACTER' ? participant.character?.name : participant.persona?.name}
      </span>
      <button
        data-testid={`nudge-${participant.id}`}
        onClick={() => onNudge(participant.id)}
      >
        Nudge
      </button>
      <button
        data-testid={`queue-${participant.id}`}
        onClick={() => onQueue(participant.id)}
      >
        Queue
      </button>
      <button
        data-testid={`dequeue-${participant.id}`}
        onClick={() => onDequeue(participant.id)}
      >
        Dequeue
      </button>
      {onRemove && canRemove && (
        <button
          data-testid={`remove-${participant.id}`}
          onClick={() => onRemove(participant.id)}
        >
          Remove
        </button>
      )}
    </div>
  ),
}))

// Mock the Avatar component for collapsed sidebar
jest.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name, src, size }: { name: string; src?: unknown; size?: string }) => (
    <div data-testid={`avatar-${name}`} data-size={size} className="avatar-mock">
      {name}
    </div>
  ),
  getAvatarSrc: (src: unknown) => src,
}))

// Helper to create test participants
function createCharacterParticipant(id: string, name: string, displayOrder: number, isActive = true): ParticipantData {
  return {
    id,
    type: 'CHARACTER',
    displayOrder,
    isActive,
    character: {
      id: `char-${id}`,
      name,
      talkativeness: 0.5,
    },
  }
}

function createPersonaParticipant(id: string, name: string, displayOrder: number, isActive = true): ParticipantData {
  return {
    id,
    type: 'PERSONA',
    displayOrder,
    isActive,
    persona: {
      id: `persona-${id}`,
      name,
    },
  }
}

// Default props for tests
function createDefaultProps() {
  return {
    participants: [] as ParticipantData[],
    turnState: {
      spokenSinceUserTurn: [],
      currentTurnParticipantId: null,
      queue: [],
      lastSpeakerId: null,
    } as TurnState,
    turnSelectionResult: {
      nextSpeakerId: null,
      reason: 'user_turn' as const,
      cycleComplete: false,
    } as TurnSelectionResult,
    isGenerating: false,
    userParticipantId: null,
    onNudge: jest.fn(),
    onQueue: jest.fn(),
    onDequeue: jest.fn(),
  }
}

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key]
    }),
    clear: jest.fn(() => {
      store = {}
    }),
    get store() {
      return store
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

describe('ParticipantSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLocalStorage.clear()
    // Default to expanded state for most tests (collapsed sidebar tests will override this)
    mockLocalStorage.setItem('quilltap.participant-sidebar.collapsed', 'false')
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('Rendering participants', () => {
    it('renders a list of participants', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.getByTestId('participant-char-1')).toBeInTheDocument()
      expect(screen.getByTestId('participant-char-2')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('displays correct character count in header', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
        createCharacterParticipant('char-3', 'Charlie', 3),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.getByText('3 characters')).toBeInTheDocument()
    })

    it('displays singular character when only one character', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.getByText('1 character')).toBeInTheDocument()
    })

    it('does not count personas in character count', () => {
      const participants = [
        createPersonaParticipant('persona-1', 'User', 0),
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          userParticipantId="persona-1"
        />
      )

      expect(screen.getByText('2 characters')).toBeInTheDocument()
    })

    it('filters out inactive participants from display', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1, true),
        createCharacterParticipant('char-2', 'Bob', 2, false), // inactive
        createCharacterParticipant('char-3', 'Charlie', 3, true),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.getByTestId('participant-char-1')).toBeInTheDocument()
      expect(screen.queryByTestId('participant-char-2')).not.toBeInTheDocument()
      expect(screen.getByTestId('participant-char-3')).toBeInTheDocument()
    })
  })

  describe('Current speaker indicator', () => {
    it('marks the current speaker with isCurrentTurn', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-2',
        reason: 'weighted_selection',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.getByTestId('participant-char-1')).toHaveAttribute('data-current-turn', 'false')
      expect(screen.getByTestId('participant-char-2')).toHaveAttribute('data-current-turn', 'true')
    })

    it('marks respondingParticipantId as current during generation', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          isGenerating={true}
          respondingParticipantId="char-1"
        />
      )

      expect(screen.getByTestId('participant-char-1')).toHaveAttribute('data-current-turn', 'true')
      expect(screen.getByTestId('participant-char-2')).toHaveAttribute('data-current-turn', 'false')
    })

    it('shows "Generating response..." status when generating', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-1',
        reason: 'weighted_selection',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
          isGenerating={true}
        />
      )

      expect(screen.getByText('Generating response...')).toBeInTheDocument()
    })

    it('shows "Your turn to speak" when nextSpeakerId is null', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: null,
        reason: 'user_turn',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.getByText('Your turn to speak')).toBeInTheDocument()
    })

    it('shows cycle complete message when all characters have spoken', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: null,
        reason: 'cycle_complete',
        cycleComplete: true,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.getByText('All characters have spoken - your turn')).toBeInTheDocument()
    })
  })

  describe('Add/remove participant actions', () => {
    it('calls onNudge when nudge button is clicked', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]
      const onNudge = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          onNudge={onNudge}
        />
      )

      fireEvent.click(screen.getByTestId('nudge-char-1'))
      expect(onNudge).toHaveBeenCalledWith('char-1')
    })

    it('calls onQueue when queue button is clicked', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]
      const onQueue = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          onQueue={onQueue}
        />
      )

      fireEvent.click(screen.getByTestId('queue-char-1'))
      expect(onQueue).toHaveBeenCalledWith('char-1')
    })

    it('calls onDequeue when dequeue button is clicked', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]
      const onDequeue = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          onDequeue={onDequeue}
        />
      )

      fireEvent.click(screen.getByTestId('dequeue-char-1'))
      expect(onDequeue).toHaveBeenCalledWith('char-1')
    })

    it('renders add character button when onAddCharacter is provided', () => {
      const onAddCharacter = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onAddCharacter={onAddCharacter}
        />
      )

      const addButton = screen.getByRole('button', { name: /add character/i })
      expect(addButton).toBeInTheDocument()

      fireEvent.click(addButton)
      expect(onAddCharacter).toHaveBeenCalled()
    })

    it('does not render add character button when onAddCharacter is not provided', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      expect(screen.queryByRole('button', { name: /add character/i })).not.toBeInTheDocument()
    })

    it('calls onRemoveCharacter when remove button is clicked', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]
      const onRemoveCharacter = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          onRemoveCharacter={onRemoveCharacter}
        />
      )

      fireEvent.click(screen.getByTestId('remove-char-1'))
      expect(onRemoveCharacter).toHaveBeenCalledWith('char-1')
    })

    it('does not show remove button when only one character', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]
      const onRemoveCharacter = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          onRemoveCharacter={onRemoveCharacter}
        />
      )

      // Remove button should not be rendered since canRemove would be false
      expect(screen.queryByTestId('remove-char-1')).not.toBeInTheDocument()
    })
  })

  describe('Pause/resume functionality', () => {
    it('renders pause button when onTogglePause is provided', () => {
      const onTogglePause = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={onTogglePause}
        />
      )

      const pauseButton = screen.getByRole('button', { name: /pause/i })
      expect(pauseButton).toBeInTheDocument()
    })

    it('shows Pause text when not paused', () => {
      const onTogglePause = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={onTogglePause}
          isPaused={false}
        />
      )

      expect(screen.getByText('Pause')).toBeInTheDocument()
    })

    it('shows Resume text when paused', () => {
      const onTogglePause = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={onTogglePause}
          isPaused={true}
        />
      )

      expect(screen.getByText('Resume')).toBeInTheDocument()
    })

    it('calls onTogglePause when button is clicked', () => {
      const onTogglePause = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={onTogglePause}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /pause/i }))
      expect(onTogglePause).toHaveBeenCalled()
    })

    it('does not render pause button when onTogglePause is not provided', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument()
    })
  })

  describe('Empty state', () => {
    it('shows empty state when no active participants', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={[]}
        />
      )

      expect(screen.getByText('No participants')).toBeInTheDocument()
      expect(screen.getByText('All characters have been removed')).toBeInTheDocument()
    })

    it('shows empty state when all participants are inactive', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1, false),
        createCharacterParticipant('char-2', 'Bob', 2, false),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.getByText('No participants')).toBeInTheDocument()
    })

    it('shows "No characters available" when no active characters', () => {
      const participants: ParticipantData[] = []

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: null,
        reason: 'user_turn',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.getByText('No characters available')).toBeInTheDocument()
    })
  })

  describe('Participant ordering', () => {
    it('orders personas before characters', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createPersonaParticipant('persona-1', 'User', 0),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          userParticipantId="persona-1"
        />
      )

      // Use the mock class to select only the top-level participant card elements
      const participantElements = container.querySelectorAll('.participant-card-mock')
      expect(participantElements).toHaveLength(3)
      expect(participantElements[0]).toHaveAttribute('data-testid', 'participant-persona-1')
      expect(participantElements[1]).toHaveAttribute('data-testid', 'participant-char-1')
      expect(participantElements[2]).toHaveAttribute('data-testid', 'participant-char-2')
    })

    it('orders characters by displayOrder', () => {
      const participants = [
        createCharacterParticipant('char-3', 'Charlie', 3),
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      // Use the mock class to select only the top-level participant card elements
      const participantElements = container.querySelectorAll('.participant-card-mock')
      expect(participantElements).toHaveLength(3)
      expect(participantElements[0]).toHaveAttribute('data-display-order', '1')
      expect(participantElements[1]).toHaveAttribute('data-display-order', '2')
      expect(participantElements[2]).toHaveAttribute('data-display-order', '3')
    })
  })

  describe('Queue display', () => {
    it('shows queue indicator when participants are queued', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const turnState: TurnState = {
        spokenSinceUserTurn: [],
        currentTurnParticipantId: null,
        queue: ['char-1', 'char-2'],
        lastSpeakerId: null,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnState={turnState}
        />
      )

      expect(screen.getByText('2 in queue')).toBeInTheDocument()
    })

    it('passes correct queue position to participant cards', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const turnState: TurnState = {
        spokenSinceUserTurn: [],
        currentTurnParticipantId: null,
        queue: ['char-2', 'char-1'],
        lastSpeakerId: null,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnState={turnState}
        />
      )

      // char-2 is first in queue (position 1)
      expect(screen.getByTestId('participant-char-2')).toHaveAttribute('data-queue-position', '1')
      // char-1 is second in queue (position 2)
      expect(screen.getByTestId('participant-char-1')).toHaveAttribute('data-queue-position', '2')
    })

    it('does not show queue indicator when queue is empty', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      expect(screen.queryByText(/in queue/i)).not.toBeInTheDocument()
    })
  })

  describe('Debug info', () => {
    it('shows debug details when turnSelectionResult has debug info', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-1',
        reason: 'weighted_selection',
        cycleComplete: false,
        debug: {
          eligibleSpeakers: ['char-1'],
          weights: { 'char-1': 0.5 },
          randomValue: 0.25,
        },
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.getByText('Turn Debug Info')).toBeInTheDocument()
    })

    it('does not show debug details when no debug info', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-1',
        reason: 'weighted_selection',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      expect(screen.queryByText('Turn Debug Info')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has a heading for the participants section', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      expect(screen.getByRole('heading', { name: /participants/i })).toBeInTheDocument()
    })

    it('pause button has appropriate title for screen readers', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={jest.fn()}
          isPaused={false}
        />
      )

      const pauseButton = screen.getByRole('button', { name: /pause/i })
      expect(pauseButton).toHaveAttribute('title', 'Pause auto-responses')
    })

    it('resume button has appropriate title for screen readers', () => {
      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={jest.fn()}
          isPaused={true}
        />
      )

      const resumeButton = screen.getByRole('button', { name: /resume/i })
      expect(resumeButton).toHaveAttribute('title', 'Resume auto-responses')
    })

    it('applies desktop-only class for responsive behavior', () => {
      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('qt-desktop-only')
    })

    it('applies custom className when provided', () => {
      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
          className="custom-class"
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('custom-class')
    })

    it('applies qt-chat-sidebar-collapsed class when collapsed', () => {
      // Clear localStorage to test default collapsed state
      mockLocalStorage.clear()

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('qt-chat-sidebar-collapsed')
    })

    it('applies qt-chat-sidebar class when expanded', () => {
      // localStorage is already set to expanded in beforeEach
      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('qt-chat-sidebar')
    })
  })

  describe('Collapsed state', () => {
    beforeEach(() => {
      // Clear localStorage to test default collapsed behavior
      mockLocalStorage.clear()
    })

    it('starts collapsed by default', () => {
      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('qt-chat-sidebar-collapsed')
    })

    it('loads collapsed state from localStorage on mount', () => {
      // Set localStorage to expanded
      mockLocalStorage.setItem('quilltap.participant-sidebar.collapsed', 'false')

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      const sidebar = container.firstChild
      expect(sidebar).toHaveClass('qt-chat-sidebar')
      // localStorage is read during initial render via lazy initializer
      expect(mockLocalStorage.getItem).toHaveBeenCalled()
    })

    it('persists collapsed state true to localStorage', () => {
      mockLocalStorage.setItem('quilltap.participant-sidebar.collapsed', 'true')

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      expect(mockLocalStorage.store['quilltap.participant-sidebar.collapsed']).toBe('true')
    })

    it('expands when toggle button is clicked from collapsed state', () => {
      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      // Initially collapsed
      expect(container.firstChild).toHaveClass('qt-chat-sidebar-collapsed')

      // Click expand button
      const expandButton = screen.getByRole('button', { name: /expand participant sidebar/i })
      fireEvent.click(expandButton)

      // Now expanded
      expect(container.firstChild).toHaveClass('qt-chat-sidebar')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('quilltap.participant-sidebar.collapsed', 'false')
    })

    it('collapses when toggle button is clicked from expanded state', () => {
      // Start expanded
      mockLocalStorage.setItem('quilltap.participant-sidebar.collapsed', 'false')

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
        />
      )

      // Initially expanded
      expect(container.firstChild).toHaveClass('qt-chat-sidebar')

      // Click collapse button
      const collapseButton = screen.getByRole('button', { name: /collapse participant sidebar/i })
      fireEvent.click(collapseButton)

      // Now collapsed
      expect(container.firstChild).toHaveClass('qt-chat-sidebar-collapsed')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('quilltap.participant-sidebar.collapsed', 'true')
    })

    it('expands when avatar is clicked in collapsed state', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      // Initially collapsed
      expect(container.firstChild).toHaveClass('qt-chat-sidebar-collapsed')

      // Click avatar
      const avatarButton = screen.getByRole('button', { name: /alice.*click to expand/i })
      fireEvent.click(avatarButton)

      // Now expanded
      expect(container.firstChild).toHaveClass('qt-chat-sidebar')
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('quilltap.participant-sidebar.collapsed', 'false')
    })

    it('shows mini avatars in collapsed state', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      // In collapsed state, should show avatars
      expect(screen.getByTestId('avatar-Alice')).toBeInTheDocument()
      expect(screen.getByTestId('avatar-Bob')).toBeInTheDocument()
    })

    it('shows icon-only pause button in collapsed state', () => {
      const onTogglePause = jest.fn()

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          onTogglePause={onTogglePause}
        />
      )

      // In collapsed state, pause button should be icon-only (no text)
      const pauseButton = screen.getByRole('button', { name: /pause auto-responses/i })
      expect(pauseButton).toBeInTheDocument()
      expect(screen.queryByText('Pause')).not.toBeInTheDocument()
    })

    it('applies active class to current turn avatar in collapsed state', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-1',
        reason: 'weighted_selection',
        cycleComplete: false,
      }

      const { container } = render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
        />
      )

      // Find the Alice avatar button
      const aliceButton = screen.getByRole('button', { name: /alice.*click to expand/i })
      expect(aliceButton).toHaveClass('qt-chat-sidebar-collapsed-avatar-active')

      // Bob should not have active class
      const bobButton = screen.getByRole('button', { name: /bob.*click to expand/i })
      expect(bobButton).not.toHaveClass('qt-chat-sidebar-collapsed-avatar-active')
    })

    it('applies streaming class to avatar when isGenerating is true', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      const turnSelectionResult: TurnSelectionResult = {
        nextSpeakerId: 'char-1',
        reason: 'weighted_selection',
        cycleComplete: false,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnSelectionResult={turnSelectionResult}
          isGenerating={true}
          respondingParticipantId="char-1"
        />
      )

      const aliceButton = screen.getByRole('button', { name: /alice.*click to expand/i })
      expect(aliceButton).toHaveClass('qt-chat-sidebar-collapsed-avatar-streaming')
      expect(aliceButton).toHaveClass('qt-chat-sidebar-collapsed-avatar-active')
    })

    it('shows queue badge on avatar in collapsed state', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
        createCharacterParticipant('char-2', 'Bob', 2),
      ]

      const turnState: TurnState = {
        spokenSinceUserTurn: [],
        currentTurnParticipantId: null,
        queue: ['char-2'],
        lastSpeakerId: null,
      }

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
          turnState={turnState}
        />
      )

      // Bob is in queue, should show badge with position 1
      const bobButton = screen.getByRole('button', { name: /bob.*click to expand/i })
      expect(bobButton).toBeInTheDocument()
      // Check title includes queue position
      expect(bobButton).toHaveAttribute('title', 'Bob (queue #1)')
      expect(bobButton.querySelector('.qt-chat-sidebar-collapsed-queue-badge')).toHaveTextContent('1')
    })

    it('does not show participant cards in collapsed state', () => {
      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      // In collapsed state, should not render ParticipantCard
      expect(screen.queryByTestId('participant-char-1')).not.toBeInTheDocument()
    })

    it('shows participant cards in expanded state', () => {
      // Set to expanded
      mockLocalStorage.setItem('quilltap.participant-sidebar.collapsed', 'false')

      const participants = [
        createCharacterParticipant('char-1', 'Alice', 1),
      ]

      render(
        <ParticipantSidebar
          {...createDefaultProps()}
          participants={participants}
        />
      )

      // In expanded state, should render ParticipantCard
      expect(screen.getByTestId('participant-char-1')).toBeInTheDocument()
    })
  })
})
