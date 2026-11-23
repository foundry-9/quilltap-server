/**
 * Homepage Components Unit Tests
 *
 * Comprehensive tests for all homepage dashboard components:
 * - WelcomeSection
 * - QuickActionsRow
 * - ChatsBand
 * - ResumeCard
 * - RecentChatsSection
 * - RecentChatItem
 * - ProjectsSection
 * - ProjectItem
 * - CharactersSection
 * - CharacterCard
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { renderWithQuery as render } from '../../../helpers/renderWithQuery'
import React from 'react'
import { WelcomeSection } from '@/components/homepage/WelcomeSection'
import { QuickActionsRow } from '@/components/homepage/QuickActionsRow'
import { ChatsBand } from '@/components/homepage/ChatsBand'
import { ResumeCard } from '@/components/homepage/ResumeCard'
import { RecentChatsSection, RECENT_CHAT_ROWS } from '@/components/homepage/RecentChatsSection'
import { RecentChatItem } from '@/components/homepage/RecentChatItem'
import { ProjectsSection } from '@/components/homepage/ProjectsSection'
import { ProjectItem } from '@/components/homepage/ProjectItem'
import { CharactersSection } from '@/components/homepage/CharactersSection'
import { CharacterCard } from '@/components/homepage/CharacterCard'
import type { RecentChat, HomepageProject, HomepageCharacter } from '@/components/homepage/types'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'
import { conciergeStateUsesUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'

// Mock next/link: an anchor that keeps whatever else the link was given
// (aria-label, title, tabIndex, onClick), as the real one does.
jest.mock('next/link', () => {
  return function MockLink({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode
    href: string
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  }
})

// Mock format-time
jest.mock('@/lib/format-time', () => ({
  formatMessageTime: jest.fn((date: string) => 'just now'),
}))

// Mock AvatarStack
jest.mock('@/components/ui/AvatarStack', () => {
  return function MockAvatarStack({ entities, size, maxDisplay }: any) {
    return (
      <div data-testid="avatar-stack" data-size={size} data-max-display={maxDisplay}>
        {entities.length} avatars
      </div>
    )
  }
})

// Mock Avatar
jest.mock('@/components/ui/Avatar', () => {
  return function MockAvatar({ name, src, size }: any) {
    return (
      <div data-testid="avatar" data-name={name} data-size={size}>
        {name}
      </div>
    )
  }
})

// The card opens the workspace's New Chat dialog through the provider, or
// falls back to the /salon/new page outside it.
const mockOpenNewChat = jest.fn()
let mockNewChatProvider: { open: jest.Mock } | null = { open: mockOpenNewChat }
jest.mock('@/components/providers/new-chat-provider', () => ({
  useNewChatModalOptional: () => mockNewChatProvider,
}))

const mockRouterPush = jest.fn()
jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: mockRouterPush }),
}))

// Mock CreateProjectDialog
jest.mock('@/app/prospero/components', () => ({
  CreateProjectDialog: function MockCreateProjectDialog({
    open,
    onClose,
    onSubmit,
  }: any) {
    return open ? (
      <div data-testid="create-project-dialog">
        <input
          data-testid="project-name-input"
          placeholder="Project name"
          onBlur={(e) => {
            // Store input for testing
            ;(e.target as any).__testValue = e.target.value
          }}
        />
        <button
          onClick={() => {
            const input = document.querySelector('[data-testid="project-name-input"]')
            const name = (input as any).__testValue || 'Test Project'
            onSubmit(name, null)
          }}
        >
          Create
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    ) : null
  },
}))

// Mock useQuickHide provider. Lists now ask the provider one question —
// shouldHideChat — so the rule (tags plus the Concierge's Unmoderated state)
// lives in exactly one place.
jest.mock('@/components/providers/quick-hide-provider', () => ({
  useQuickHide: jest.fn(() => ({
    shouldHideChat: jest.fn(() => false),
    shouldHideByIds: jest.fn(() => false),
  })),
}))

const mockUseQuickHide = require('@/components/providers/quick-hide-provider').useQuickHide

/** Point the provider mock at a hide predicate for one test. */
function stubQuickHide(shouldHideChat: (chat: { characterTags?: string[]; conciergeState?: ConciergeState }) => boolean) {
  const spy = jest.fn(shouldHideChat)
  mockUseQuickHide.mockReturnValue({ shouldHideChat: spy, shouldHideByIds: jest.fn(() => false) })
  return spy
}

// Every test starts with nothing hidden; the ones that care call stubQuickHide.
beforeEach(() => {
  mockUseQuickHide.mockReturnValue({
    shouldHideChat: jest.fn(() => false),
    shouldHideByIds: jest.fn(() => false),
  })
})

/**
 * Say how focus arrived. jsdom answers `:focus-visible` with false for a
 * dispatched focus event, so the tests that tab to something say so.
 */
function stubFocusVisible(visible: boolean) {
  const realMatches = Element.prototype.matches
  return jest.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
    return selector === ':focus-visible' ? visible : realMatches.call(this, selector)
  })
}

// Test data factories
function createMockRecentChat(overrides: Partial<RecentChat> = {}): RecentChat {
  return {
    id: 'chat-1',
    title: 'Test Chat',
    updatedAt: new Date().toISOString(),
    participants: [
      {
        id: 'p1',
        type: 'CHARACTER',
        isActive: true,
        displayOrder: 0,
        character: {
          id: 'c1',
          name: 'Alice',
          avatarUrl: undefined,
          defaultImageId: undefined,
          defaultImage: null,
        },
        persona: null,
      },
    ],
    _count: { messages: 42 },
    conciergeState: 'moderated',
    dangerCategories: [],
    ...overrides,
  }
}

function createMockProject(overrides: Partial<HomepageProject> = {}): HomepageProject {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    color: '#ff0000',
    icon: null,
    chatCount: 5,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function createMockCharacter(overrides: Partial<HomepageCharacter> = {}): HomepageCharacter {
  return {
    id: 'char-1',
    name: 'Test Character',
    title: 'Test Title',
    avatarUrl: '/avatar.jpg',
    defaultImageId: null,
    defaultImage: null,
    tags: [],
    ...overrides,
  }
}

describe('WelcomeSection', () => {
  it('renders greeting with user name', () => {
    render(<WelcomeSection displayName="John" />)
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument()
    expect(screen.getByText('John')).toBeInTheDocument()
  })

  it('greets a first visit without the "back"', () => {
    render(<WelcomeSection displayName="John" firstVisit />)
    expect(screen.getByText(/Welcome to Quilltap/)).toBeInTheDocument()
    expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument()
  })

  it('renders with different display names', () => {
    render(<WelcomeSection displayName="Alice" />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders with empty display name', () => {
    render(<WelcomeSection displayName="" />)
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument()
  })

  it('wears the welcome hook class', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    expect(container.querySelector('div')).toHaveClass('qt-homepage-welcome')
  })

  // One line beside the quick actions: the page's only h1, at the second
  // heading size, and nothing under it.
  it('is a single h1 line', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    expect(container.querySelector('h1')).toHaveClass('qt-heading-2')
    expect(container.querySelector('p')).toBeNull()
  })

  it('renders name with primary text class', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    const span = container.querySelector('span')
    expect(span).toHaveClass('qt-text-brand')
  })
})

describe('QuickActionsRow', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders start chat button', () => {
    render(<QuickActionsRow />)
    const startChatLink = screen.getByRole('link', { name: /chat/i })
    expect(startChatLink).toBeInTheDocument()
    expect(startChatLink).toHaveAttribute('href', '/salon/new')
  })

  // Picking up the last conversation is the resume card's work now.
  it('offers no "continue last" action', () => {
    render(<QuickActionsRow />)
    expect(screen.queryByText(/continue/i)).not.toBeInTheDocument()
  })

  it('renders new project button', () => {
    render(<QuickActionsRow />)
    const projectButton = screen.getByRole('button', { name: /project/i })
    expect(projectButton).toBeInTheDocument()
  })

  it('renders generate image button', () => {
    render(<QuickActionsRow />)
    const imageLink = screen.getByRole('link', { name: /image/i })
    expect(imageLink).toBeInTheDocument()
    expect(imageLink).toHaveAttribute('href', '/generate-image')
  })

  it('opens project dialog when project button is clicked', () => {
    render(<QuickActionsRow />)
    const projectButton = screen.getByRole('button', { name: /project/i })

    fireEvent.click(projectButton)

    expect(screen.getByTestId('create-project-dialog')).toBeInTheDocument()
  })

  it('closes project dialog when cancel button is clicked', () => {
    render(<QuickActionsRow />)
    const projectButton = screen.getByRole('button', { name: /project/i })

    fireEvent.click(projectButton)
    expect(screen.getByTestId('create-project-dialog')).toBeInTheDocument()

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)

    expect(screen.queryByTestId('create-project-dialog')).not.toBeInTheDocument()
  })

  it('submits project creation form', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true })
    global.fetch = mockFetch

    render(<QuickActionsRow />)
    const projectButton = screen.getByRole('button', { name: /project/i })
    fireEvent.click(projectButton)

    const submitButton = screen.getByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/projects',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
  })

  it('applies qt-quick-actions class', () => {
    const { container } = render(<QuickActionsRow />)
    const quickActions = container.querySelector('.qt-quick-actions')
    expect(quickActions).toBeInTheDocument()
  })

  it('renders all four action buttons with correct styling', () => {
    const { container } = render(<QuickActionsRow />)
    const buttons = container.querySelectorAll('.qt-button')
    expect(buttons.length).toBeGreaterThanOrEqual(4)
  })
})

describe('RecentChatItem', () => {
  it('renders chat title', () => {
    const chat = createMockRecentChat({ title: 'My Chat' })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('My Chat')).toBeInTheDocument()
  })

  it('renders message count', () => {
    const chat = createMockRecentChat({ _count: { messages: 42 } })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('42 msgs')).toBeInTheDocument()
  })

  it('renders correct singular message text', () => {
    const chat = createMockRecentChat({ _count: { messages: 1 } })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('1 msgs')).toBeInTheDocument()
  })

  it('renders character name', () => {
    const chat = createMockRecentChat({
      participants: [
        {
          id: 'p1',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 0,
          character: {
            id: 'c1',
            name: 'Alice',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
      ],
    })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders multiple character names', () => {
    const chat = createMockRecentChat({
      participants: [
        {
          id: 'p1',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 0,
          character: {
            id: 'c1',
            name: 'Alice',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
        {
          id: 'p2',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 1,
          character: {
            id: 'c2',
            name: 'Bob',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
      ],
    })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText(/Alice \+ Bob/)).toBeInTheDocument()
  })

  it('renders "Unknown" when no active characters', () => {
    const chat = createMockRecentChat({ participants: [] })
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('filters inactive participants', () => {
    const chat = createMockRecentChat({
      participants: [
        {
          id: 'p1',
          type: 'CHARACTER',
          isActive: false,
          displayOrder: 0,
          character: {
            id: 'c1',
            name: 'Alice',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
      ],
    })
    render(<RecentChatItem chat={chat} />)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('links to chat page', () => {
    const chat = createMockRecentChat({ id: 'chat-123' })
    render(<RecentChatItem chat={chat} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/salon/chat-123')
  })

  it('renders avatar stack component', () => {
    const chat = createMockRecentChat()
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByTestId('avatar-stack')).toBeInTheDocument()
  })

  it('formats time display', () => {
    const chat = createMockRecentChat()
    render(<RecentChatItem chat={chat} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('renders as interactive link', () => {
    const { container } = render(<RecentChatItem chat={createMockRecentChat()} />)
    const link = container.querySelector('a')
    expect(link).toBeInTheDocument()
    expect(link).toHaveClass('qt-homepage-row')
  })

  // The complaint that started the redesign: a title cut to one line.
  it('lets the title wrap instead of truncating it', () => {
    render(<RecentChatItem chat={createMockRecentChat({ title: 'A Title Long Enough to Need Its Second Line' })} />)
    const title = screen.getByText('A Title Long Enough to Need Its Second Line')
    expect(title).toHaveClass('qt-homepage-row-title')
    expect(title).not.toHaveClass('truncate')
  })

  it('names the project the chat is filed under', () => {
    render(<RecentChatItem chat={createMockRecentChat({ project: { id: 'p1', name: 'The Estate' } })} />)
    expect(screen.getByText(/The Estate/)).toBeInTheDocument()
  })

  it('counts a crowd rather than listing it', () => {
    const participants = ['Amy', 'Laura', 'Abigail', 'Friday', 'Jackie', 'Ariel'].map((name, i) => ({
      id: `p${i}`,
      type: 'CHARACTER' as const,
      isActive: true,
      displayOrder: i,
      character: { id: `c${i}`, name, defaultImage: null },
    }))
    render(<RecentChatItem chat={createMockRecentChat({ participants })} />)
    expect(screen.getByText('Amy + Laura + Abigail + Friday + 2 more')).toBeInTheDocument()
  })

  it('sorts participants by display order', () => {
    const chat = createMockRecentChat({
      participants: [
        {
          id: 'p2',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 1,
          character: {
            id: 'c2',
            name: 'Bob',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
        {
          id: 'p1',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 0,
          character: {
            id: 'c1',
            name: 'Alice',
            avatarUrl: undefined,
            defaultImageId: undefined,
            defaultImage: null,
          },
          persona: null,
        },
      ],
    })
    render(<RecentChatItem chat={chat} />)
    // Avatar stack should have been passed Alice first
    expect(screen.getByTestId('avatar-stack')).toBeInTheDocument()
  })
})

describe('RecentChatItem — the Concierge mark', () => {
  // The asterisk marks any state other than the default, in the same two
  // tones as the Salon header's pill. Moderated is the default and wears
  // nothing.
  it('draws no mark for a Moderated chat', () => {
    const { container } = render(<RecentChatItem chat={createMockRecentChat({ conciergeState: 'moderated' })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it('draws no mark when the payload carries no state at all', () => {
    const { container } = render(<RecentChatItem chat={createMockRecentChat({ conciergeState: undefined })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it.each([
    ['unmoderated', 'Concierge: Unmoderated', ['qt-concierge-mark-muted']],
    ['locked', 'Concierge: Locked', [] as string[]],
  ] as const)('marks a %s chat and labels it "%s"', (conciergeState, label, absentModifiers) => {
    const { container } = render(
      <RecentChatItem chat={createMockRecentChat({ conciergeState })} />
    )

    const mark = screen.getByLabelText(label)
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('qt-concierge-mark')
    for (const absent of absentModifiers) {
      expect(container.querySelector(`.${absent}`)).toBeNull()
    }
  })

  it('gives each state its own tone class', () => {
    // Red is the base rule (no modifier); grey is a modifier.
    const unmoderated = render(<RecentChatItem chat={createMockRecentChat({ conciergeState: 'unmoderated' })} />)
    expect(unmoderated.container.querySelector('.qt-concierge-mark')?.className).toBe('qt-concierge-mark')
    unmoderated.unmount()

    const locked = render(<RecentChatItem chat={createMockRecentChat({ conciergeState: 'locked' })} />)
    expect(locked.container.querySelector('.qt-concierge-mark')).toHaveClass('qt-concierge-mark-muted')
  })

  describe('the tooltip', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

    it('explains the state after the pointer has dwelt on the mark', () => {
      render(<RecentChatItem chat={createMockRecentChat({ conciergeState: 'locked' })} />)
      const mark = screen.getByLabelText('Concierge: Locked')

      expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()

      fireEvent.pointerEnter(mark)
      act(() => { jest.advanceTimersByTime(250) })

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent('Locked')
      expect(bubble).toHaveTextContent('Only the usual providers, ever.')
      expect(bubble).toHaveTextContent("Change it from the Salon sidebar's Chat section.")
    })

    it('says who opened the door — the Concierge or the operator', () => {
      const concierge = render(
        <RecentChatItem
          chat={createMockRecentChat({ conciergeState: 'unmoderated', conciergeSetBy: 'concierge', conciergeReason: 'refusals' })}
        />
      )
      fireEvent.pointerEnter(screen.getByLabelText('Concierge: Unmoderated'))
      act(() => { jest.advanceTimersByTime(250) })
      expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent(/The Concierge moved this chat to the uncensored desk/)
      concierge.unmount()

      render(
        <RecentChatItem
          chat={createMockRecentChat({ conciergeState: 'unmoderated', conciergeSetBy: 'operator', conciergeReason: 'manual' })}
        />
      )
      fireEvent.pointerEnter(screen.getByLabelText('Concierge: Unmoderated'))
      act(() => { jest.advanceTimersByTime(250) })
      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent(/opened the uncensored door yourself/)
      expect(bubble).not.toHaveTextContent(/The Concierge moved this chat/)
    })

    it("names the classifier's categories when the classifier moved the chat", () => {
      render(
        <RecentChatItem
          chat={createMockRecentChat({
            conciergeState: 'unmoderated',
            conciergeSetBy: 'concierge',
            conciergeReason: 'classifier',
            dangerCategories: ['NSFW', 'Violence'],
          })}
        />
      )

      fireEvent.pointerEnter(screen.getByLabelText('Concierge: Unmoderated'))
      act(() => { jest.advanceTimersByTime(250) })

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent('Categories')
      expect(bubble).toHaveTextContent('NSFW, Violence')
    })

    it('never surfaces a preserved category list on an operator state', () => {
      render(
        <RecentChatItem
          chat={createMockRecentChat({ conciergeState: 'unmoderated', conciergeSetBy: 'operator', dangerCategories: ['NSFW'] })}
        />
      )

      fireEvent.pointerEnter(screen.getByLabelText('Concierge: Unmoderated'))
      act(() => { jest.advanceTimersByTime(250) })

      expect(screen.getByRole('tooltip', { hidden: true })).not.toHaveTextContent('Categories')
    })
  })

  it('still opens the chat when the mark itself is clicked', () => {
    // The mark sits inside the row's <Link>; it must not swallow the click.
    const onClick = jest.fn()
    const { container } = render(<RecentChatItem chat={createMockRecentChat({ conciergeState: 'unmoderated' })} />)
    const link = container.querySelector('a')!
    link.addEventListener('click', onClick)

    fireEvent.click(screen.getByLabelText('Concierge: Unmoderated'))

    expect(onClick).toHaveBeenCalled()
  })
})

describe('RecentChatsSection', () => {
  it('renders section title', () => {
    render(<RecentChatsSection chats={[createMockRecentChat()]} />)
    expect(screen.getByText('Recent Conversations')).toBeInTheDocument()
  })

  it('renders view all link', () => {
    render(<RecentChatsSection chats={[createMockRecentChat()]} />)
    const link = screen.getByRole('link', { name: /View all/ })
    expect(link).toHaveAttribute('href', '/salon')
  })

  it('renders all chats', () => {
    const chats = [
      createMockRecentChat({ id: 'chat-1', title: 'Chat One' }),
      createMockRecentChat({ id: 'chat-2', title: 'Chat Two' }),
      createMockRecentChat({ id: 'chat-3', title: 'Chat Three' }),
    ]
    render(<RecentChatsSection chats={chats} />)
    expect(screen.getByText('Chat One')).toBeInTheDocument()
    expect(screen.getByText('Chat Two')).toBeInTheDocument()
    expect(screen.getByText('Chat Three')).toBeInTheDocument()
  })

  it('shows no more rows than stand level with the resume card', () => {
    const chats = Array.from({ length: RECENT_CHAT_ROWS + 3 }, (_, i) =>
      createMockRecentChat({ id: `chat-${i}`, title: `Chat ${i}` }))
    const { container } = render(<RecentChatsSection chats={chats} />)
    expect(container.querySelectorAll('.qt-homepage-row')).toHaveLength(RECENT_CHAT_ROWS)
    expect(screen.queryByText(`Chat ${RECENT_CHAT_ROWS}`)).not.toBeInTheDocument()
  })

  it('is the chats band, with the catalogued header and title', () => {
    const { container } = render(<RecentChatsSection chats={[createMockRecentChat()]} />)
    const section = container.querySelector('.qt-homepage-section')
    expect(section).toHaveAttribute('data-section', 'chats')
    expect(container.querySelector('.qt-homepage-section-header')).toBeInTheDocument()
    expect(container.querySelector('.qt-homepage-section-title')).toBeInTheDocument()
  })
})

describe('ResumeCard', () => {
  it('shows the title in full, as a link into the chat', () => {
    render(<ResumeCard chat={createMockRecentChat({ id: 'chat-9', title: 'The Hand That Would Not Let Go' })} />)
    const title = screen.getByRole('link', { name: 'The Hand That Would Not Let Go' })
    expect(title).toHaveAttribute('href', '/salon/chat-9')
    expect(title.closest('.qt-homepage-resume-title')).toBeInTheDocument()
  })

  it('offers one Resume button, named for the chat', () => {
    render(<ResumeCard chat={createMockRecentChat({ id: 'chat-9', title: 'Supper' })} />)
    const resume = screen.getByRole('link', { name: 'Resume Supper' })
    expect(resume).toHaveAttribute('href', '/salon/chat-9')
    expect(resume).toHaveClass('qt-button-primary')
  })

  it('hangs the story background when the chat has one', () => {
    const { container } = render(
      <ResumeCard chat={createMockRecentChat({ storyBackgroundUrl: '/files/bg.webp' })} />
    )
    const picture = container.querySelector('.qt-homepage-resume-picture')
    expect(picture?.querySelector('img')).toHaveAttribute('src', '/files/bg.webp')
    expect(screen.queryByTestId('avatar-stack')).not.toBeInTheDocument()
  })

  it('shows the cast instead when there is no story background', () => {
    const { container } = render(<ResumeCard chat={createMockRecentChat({ storyBackgroundUrl: null })} />)
    expect(container.querySelector('.qt-homepage-resume-picture img')).toBeNull()
    expect(screen.getByTestId('avatar-stack')).toBeInTheDocument()
  })

  // The picture repeats the title's link; a keyboard or screen-reader user
  // should meet the chat once.
  it('keeps the picture out of the tab order and the accessibility tree', () => {
    const { container } = render(<ResumeCard chat={createMockRecentChat({ storyBackgroundUrl: '/files/bg.webp' })} />)
    const picture = container.querySelector('.qt-homepage-resume-picture')
    expect(picture).toHaveAttribute('tabindex', '-1')
    expect(picture).toHaveAttribute('aria-hidden', 'true')
  })

  it('says who is in it, where it is filed and how long it runs', () => {
    render(<ResumeCard chat={createMockRecentChat({ project: { id: 'p1', name: 'The Estate' } })} />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/The Estate/)).toBeInTheDocument()
    expect(screen.getByText('42 messages')).toBeInTheDocument()
  })

  it('uses the singular for one message', () => {
    render(<ResumeCard chat={createMockRecentChat({ _count: { messages: 1 } })} />)
    expect(screen.getByText('1 message')).toBeInTheDocument()
  })

  it('prints the line on where things stand, when the chat has one', () => {
    const { container, rerender } = render(
      <ResumeCard chat={createMockRecentChat({ summaryExcerpt: 'The bridge is down and the ford is rising.' })} />
    )
    expect(screen.getByText('The bridge is down and the ford is rising.')).toHaveClass('qt-homepage-resume-excerpt')

    rerender(<ResumeCard chat={createMockRecentChat({ summaryExcerpt: null })} />)
    expect(container.querySelector('.qt-homepage-resume-excerpt')).toBeNull()
  })

  it('is the resume band', () => {
    const { container } = render(<ResumeCard chat={createMockRecentChat()} />)
    expect(container.querySelector('.qt-homepage-section')).toHaveAttribute('data-section', 'resume')
    expect(screen.getByText('Where You Left Off')).toHaveClass('qt-homepage-section-title')
  })
})

describe('ChatsBand', () => {
  it('gives the newest chat the resume card and lists the rest', () => {
    const chats = [
      createMockRecentChat({ id: 'chat-1', title: 'Newest' }),
      createMockRecentChat({ id: 'chat-2', title: 'Older' }),
      createMockRecentChat({ id: 'chat-3', title: 'Oldest' }),
    ]
    const { container } = render(<ChatsBand chats={chats} />)

    const resume = container.querySelector('[data-section="resume"]')
    const list = container.querySelector('[data-section="chats"]')
    expect(resume).toHaveTextContent('Newest')
    expect(list).not.toHaveTextContent('Newest')
    expect(list).toHaveTextContent('Older')
    expect(list).toHaveTextContent('Oldest')
  })

  it('lets a lone chat take the row, with no empty list beside it', () => {
    const { container } = render(<ChatsBand chats={[createMockRecentChat({ title: 'Only' })]} />)
    expect(container.querySelector('.qt-homepage-chats')).toHaveAttribute('data-solo', 'true')
    expect(container.querySelector('[data-section="chats"]')).toBeNull()
  })

  it('invites a first chat when there are none', () => {
    const { container } = render(<ChatsBand chats={[]} />)
    expect(container.querySelector('.qt-homepage-empty')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Start your first chat/ })
    expect(link).toHaveAttribute('href', '/salon/new')
  })

  it('filters chats based on quick-hide tags', () => {
    stubQuickHide(chat => Boolean(chat.characterTags?.includes('hidden-tag')))

    const chats = [
      createMockRecentChat({
        id: 'chat-1',
        title: 'Visible Chat',
        participants: [{
          id: 'p1',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 0,
          character: { id: 'c1', name: 'Alice', defaultImage: null, tags: ['normal-tag'] },
          persona: null,
        }],
      }),
      createMockRecentChat({
        id: 'chat-2',
        title: 'Hidden Chat',
        participants: [{
          id: 'p2',
          type: 'CHARACTER',
          isActive: true,
          displayOrder: 0,
          character: { id: 'c2', name: 'Bob', defaultImage: null, tags: ['hidden-tag'] },
          persona: null,
        }],
      }),
    ]

    render(<ChatsBand chats={chats} />)
    expect(screen.getByText('Visible Chat')).toBeInTheDocument()
    expect(screen.queryByText('Hidden Chat')).not.toBeInTheDocument()
  })

  // "Continue Last" used to open the newest chat whether or not quick-hide
  // was hiding it. The resume card is the newest chat still on show.
  it('never resumes into a chat quick-hide is hiding', () => {
    stubQuickHide(chat => Boolean(chat.conciergeState && conciergeStateUsesUncensoredRoute(chat.conciergeState)))

    const chats = [
      createMockRecentChat({ id: 'a', title: 'Hidden Newest', conciergeState: 'unmoderated' }),
      createMockRecentChat({ id: 'b', title: 'Shown Second', conciergeState: 'moderated' }),
    ]
    const { container } = render(<ChatsBand chats={chats} />)

    expect(screen.queryByText('Hidden Newest')).not.toBeInTheDocument()
    expect(container.querySelector('[data-section="resume"]')).toHaveTextContent('Shown Second')
    expect(screen.getByRole('link', { name: 'Resume Shown Second' })).toHaveAttribute('href', '/salon/b')
  })

  it('shows the invitation when all chats are hidden by quick-hide', () => {
    stubQuickHide(() => true)

    render(<ChatsBand chats={[createMockRecentChat({ id: 'chat-1', title: 'Chat One' })]} />)
    expect(screen.queryByText('Chat One')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Start your first chat/ })).toBeInTheDocument()
  })

  it('collects tags from all character participants for filtering', () => {
    const mockShouldHideChat = stubQuickHide(() => false)

    const chats = [
      createMockRecentChat({
        id: 'chat-1',
        title: 'Multi-Character Chat',
        participants: [
          {
            id: 'p1',
            type: 'CHARACTER',
            isActive: true,
            displayOrder: 0,
            character: { id: 'c1', name: 'Alice', defaultImage: null, tags: ['tag-a', 'tag-b'] },
            persona: null,
          },
          {
            id: 'p2',
            type: 'CHARACTER',
            isActive: true,
            displayOrder: 1,
            character: { id: 'c2', name: 'Bob', defaultImage: null, tags: ['tag-c'] },
            persona: null,
          },
        ],
      }),
    ]

    render(<ChatsBand chats={chats} />)

    // Every tag from every participant, and the chat's derived state, go to
    // the provider's one rule.
    expect(mockShouldHideChat).toHaveBeenCalledWith({
      characterTags: ['tag-a', 'tag-b', 'tag-c'],
      conciergeState: 'moderated',
    })
  })

  it('hides the Unmoderated chat and keeps the rest when "Dangerous Chats" is on', () => {
    // The real rule, borrowed: hide whatever takes the uncensored route.
    stubQuickHide(chat => Boolean(chat.conciergeState && conciergeStateUsesUncensoredRoute(chat.conciergeState)))

    const chats = [
      createMockRecentChat({ id: 'a', title: 'Watched Chat', conciergeState: 'moderated' }),
      createMockRecentChat({ id: 'b', title: 'Unmoderated Chat', conciergeState: 'unmoderated' }),
      createMockRecentChat({ id: 'c', title: 'Locked Chat', conciergeState: 'locked' }),
    ]

    render(<ChatsBand chats={chats} />)

    expect(screen.getAllByText('Watched Chat').length).toBeGreaterThan(0)
    // A locked chat is never hidden, whatever label it preserves.
    expect(screen.getByText('Locked Chat')).toBeInTheDocument()
    expect(screen.queryByText('Unmoderated Chat')).not.toBeInTheDocument()
  })
})

describe('ProjectItem', () => {
  it('renders project name', () => {
    const project = createMockProject({ name: 'My Project' })
    render(<ProjectItem project={project} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
  })

  // A tile has no room for the description; it rides on the link's tooltip.
  it('carries the description as the tile link\'s title', () => {
    const project = createMockProject({ description: 'A great project' })
    render(<ProjectItem project={project} />)
    expect(screen.getByTitle('A great project')).toHaveAttribute('href', '/prospero/proj-1')
  })

  it('does not render description when null', () => {
    const project = createMockProject({ description: null })
    render(<ProjectItem project={project} />)
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument()
  })

  it('renders chat count with correct singular/plural', () => {
    const project = createMockProject({ chatCount: 1 })
    render(<ProjectItem project={project} />)
    expect(screen.getByText('1 chat')).toBeInTheDocument()
  })

  it('renders chat count plural', () => {
    const project = createMockProject({ chatCount: 5 })
    render(<ProjectItem project={project} />)
    expect(screen.getByText('5 chats')).toBeInTheDocument()
  })

  it('links to project page', () => {
    const project = createMockProject({ id: 'proj-123' })
    render(<ProjectItem project={project} />)
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/prospero/proj-123')
  })

  it('renders a new-chat button linking to /salon/new with projectId', () => {
    const project = createMockProject({ id: 'proj-123' })
    const { container } = render(<ProjectItem project={project} />)
    const chatLink = container.querySelector('a[href="/salon/new?projectId=proj-123"]')
    expect(chatLink).toBeInTheDocument()
  })

  it('renders formatted time', () => {
    const project = createMockProject()
    render(<ProjectItem project={project} />)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('applies project color to folder icon', () => {
    const { container } = render(
      <ProjectItem project={createMockProject({ color: '#ff0000' })} />
    )
    // The folder is now a themeable <Icon> (a masked <span>); the project color
    // is applied as `currentColor` via inline style so the mask paints in it.
    const folderIcon = container.querySelector('[data-icon="folder"]')
    expect(folderIcon).toBeInTheDocument()
    expect(folderIcon).toHaveStyle({ color: '#ff0000' })
  })

  // Hover lives in the stylesheet on the row hook: a variant prefix on a
  // qt-* class (hover:qt-bg-muted/50) names a class that does not exist.
  it('is a home row, with no variant-prefixed qt-* class', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const row = container.firstElementChild
    expect(row).toHaveClass('qt-homepage-row')
    expect(row?.getAttribute('class') || '').not.toMatch(/\S:qt-/)
  })

  it('renders folder icon', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const folderIcon = container.querySelector('[data-icon="folder"]')
    expect(folderIcon).toBeInTheDocument()
  })

  it('renders icon container with correct classes', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const iconContainer = container.querySelector('.rounded-md.qt-bg-muted')
    expect(iconContainer).toBeInTheDocument()
  })

  it('truncates long project names', () => {
    const { container } = render(
      <ProjectItem
        project={createMockProject({
          name: 'This is a very long project name that should be truncated',
        })}
      />
    )
    const nameElement = container.querySelector('p')
    expect(nameElement).toHaveClass('truncate')
  })
})

describe('ProjectsSection', () => {
  it('renders section title', () => {
    render(<ProjectsSection projects={[createMockProject()]} />)
    expect(screen.getByText('Projects')).toBeInTheDocument()
  })

  it('renders view all link', () => {
    render(<ProjectsSection projects={[createMockProject()]} />)
    const link = screen.getByRole('link', { name: /View all/ })
    expect(link).toHaveAttribute('href', '/prospero')
  })

  it('renders all projects', () => {
    const projects = [
      createMockProject({ id: 'proj-1', name: 'Project One' }),
      createMockProject({ id: 'proj-2', name: 'Project Two' }),
      createMockProject({ id: 'proj-3', name: 'Project Three' }),
    ]
    render(<ProjectsSection projects={projects} />)
    expect(screen.getByText('Project One')).toBeInTheDocument()
    expect(screen.getByText('Project Two')).toBeInTheDocument()
    expect(screen.getByText('Project Three')).toBeInTheDocument()
  })

  // Most households never fill a projects column; one with no projects
  // gets no shelf at all rather than an empty card.
  it('renders nothing when there are no projects', () => {
    const { container } = render(<ProjectsSection projects={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is the projects band, with the catalogued header', () => {
    const { container } = render(<ProjectsSection projects={[createMockProject()]} />)
    expect(container.querySelector('.qt-homepage-section')).toHaveAttribute('data-section', 'projects')
    expect(container.querySelector('.qt-homepage-section-header')).toBeInTheDocument()
  })

  it('renders ProjectItem for each project', () => {
    const projects = [
      createMockProject({ id: 'proj-1' }),
      createMockProject({ id: 'proj-2' }),
    ]
    const { container } = render(<ProjectsSection projects={projects} />)
    expect(container.querySelectorAll('.qt-homepage-row')).toHaveLength(2)
  })
})

describe('CharacterCard', () => {
  let focusVisible: jest.SpyInstance

  beforeEach(() => {
    mockNewChatProvider = { open: mockOpenNewChat }
    mockOpenNewChat.mockClear()
    mockRouterPush.mockClear()
    focusVisible = stubFocusVisible(true)
  })

  afterEach(() => {
    focusVisible.mockRestore()
  })

  /** Tab to the portrait. */
  function focusPortrait(name: string) {
    fireEvent.focus(screen.getByRole('button', { name: `Start a chat with ${name}` }))
  }

  it('renders character name', () => {
    render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
    expect(screen.getByText('Alice', { selector: '.qt-character-card-name' })).toBeInTheDocument()
  })

  it('renders avatar component', () => {
    render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-name', 'Alice')
  })

  it('shows the portrait at the large size', () => {
    render(<CharacterCard character={createMockCharacter()} />)
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-size', 'lg')
  })

  it('is one button, named for what it does', () => {
    render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Start a chat with Alice' })).toHaveClass('qt-character-card-button')
  })

  it('opens the New Chat dialog for this character when the portrait is clicked', () => {
    const character = createMockCharacter({ id: 'char-123', name: 'Alice' })
    render(<CharacterCard character={character} />)

    fireEvent.click(screen.getByRole('button', { name: /Start a chat/i }))

    expect(mockOpenNewChat).toHaveBeenCalledWith({ characterId: 'char-123', characterName: 'Alice' })
  })

  it('falls back to the /salon/new page outside the workspace', () => {
    mockNewChatProvider = null
    const character = createMockCharacter({ id: 'char-123', name: 'Alice' })
    render(<CharacterCard character={character} />)

    fireEvent.click(screen.getByRole('button', { name: /Start a chat/i }))

    expect(mockRouterPush).toHaveBeenCalledWith('/salon/new?characterId=char-123')
  })

  it('applies card styling classes', () => {
    const { container } = render(<CharacterCard character={createMockCharacter()} />)
    expect(container.querySelector('.qt-character-card')).toBeInTheDocument()
  })

  it('truncates a long character name', () => {
    render(<CharacterCard character={createMockCharacter({ name: 'A Very Long Character Name Indeed' })} />)
    // Truncation is the name class's own rule (see _surfaces.css).
    expect(
      screen.getByText('A Very Long Character Name Indeed', { selector: '.qt-character-card-name' })
    ).toBeInTheDocument()
  })

  it('marks a favourite with a star and leaves the rest unmarked', () => {
    const { container, rerender } = render(<CharacterCard character={createMockCharacter({ isFavorite: true })} />)
    expect(container.querySelector('.qt-character-card')).toHaveAttribute('data-favorite', 'true')
    expect(container.querySelector('.qt-character-card-favorite [data-icon="star"]')).toBeInTheDocument()

    rerender(<CharacterCard character={createMockCharacter({ isFavorite: false })} />)
    expect(container.querySelector('.qt-character-card')).not.toHaveAttribute('data-favorite')
    expect(container.querySelector('.qt-character-card-favorite')).toBeNull()
  })

  describe('the card that opens on it', () => {
    it('stays shut until the portrait is rested on or focused', () => {
      const { container } = render(<CharacterCard character={createMockCharacter()} />)
      expect(container.querySelector('.qt-character-card-popover')).toBeNull()
    })

    it('opens on keyboard focus with the title and the way to the character page', () => {
      render(<CharacterCard character={createMockCharacter({ id: 'char-7', name: 'Alice', title: 'The Rival' })} />)
      focusPortrait('Alice')

      expect(screen.getByText('The Rival')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Open Alice.s page/ })).toHaveAttribute('href', '/aurora/char-7')
    })

    // A click focuses the button too, and so does a dialog handing focus
    // back to it; neither asks for the card, and nothing would close it.
    it('stays shut when focus did not come from the keyboard', () => {
      focusVisible.mockRestore()
      focusVisible = stubFocusVisible(false)
      const { container } = render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
      focusPortrait('Alice')
      expect(container.querySelector('.qt-character-card-popover')).toBeNull()
    })

    it('describes the portrait button while open', () => {
      const { container } = render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
      const button = screen.getByRole('button', { name: 'Start a chat with Alice' })
      expect(button).not.toHaveAttribute('aria-describedby')

      fireEvent.focus(button)
      const popover = container.querySelector('.qt-character-card-popover')
      expect(button).toHaveAttribute('aria-describedby', popover?.id)
    })

    it('opens after the pointer has rested, not as it passes', () => {
      jest.useFakeTimers()
      try {
        const { container } = render(<CharacterCard character={createMockCharacter()} />)
        const card = container.querySelector('.qt-character-card')!

        fireEvent.mouseEnter(card)
        expect(container.querySelector('.qt-character-card-popover')).toBeNull()
        fireEvent.mouseLeave(card)
        act(() => { jest.advanceTimersByTime(1000) })
        expect(container.querySelector('.qt-character-card-popover')).toBeNull()

        fireEvent.mouseEnter(card)
        act(() => { jest.advanceTimersByTime(1000) })
        expect(container.querySelector('.qt-character-card-popover')).toBeInTheDocument()

        fireEvent.mouseLeave(card)
        expect(container.querySelector('.qt-character-card-popover')).toBeNull()
      } finally {
        jest.useRealTimers()
      }
    })

    // WCAG 1.4.13: content that appears on hover or focus can be dismissed
    // without moving the pointer or focus.
    it('closes on Escape', () => {
      const { container } = render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
      focusPortrait('Alice')
      expect(container.querySelector('.qt-character-card-popover')).toBeInTheDocument()

      fireEvent.keyDown(screen.getByRole('button', { name: 'Start a chat with Alice' }), { key: 'Escape' })
      expect(container.querySelector('.qt-character-card-popover')).toBeNull()
    })

    it('stays open while focus moves into it and closes when focus leaves', () => {
      const { container } = render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
      const button = screen.getByRole('button', { name: 'Start a chat with Alice' })
      fireEvent.focus(button)
      const profileLink = screen.getByRole('link', { name: /Open Alice.s page/ })

      fireEvent.blur(button, { relatedTarget: profileLink })
      expect(container.querySelector('.qt-character-card-popover')).toBeInTheDocument()

      fireEvent.blur(profileLink, { relatedTarget: document.body })
      expect(container.querySelector('.qt-character-card-popover')).toBeNull()
    })

    it('closes when the portrait is clicked', () => {
      const { container } = render(<CharacterCard character={createMockCharacter({ name: 'Alice' })} />)
      focusPortrait('Alice')
      fireEvent.click(screen.getByRole('button', { name: 'Start a chat with Alice' }))
      expect(container.querySelector('.qt-character-card-popover')).toBeNull()
    })

    it('offers the way back into the latest chat', () => {
      const character = createMockCharacter({
        name: 'Alice',
        latestChat: { id: 'chat-5', title: 'Supper at Eight', characterTags: [], conciergeState: 'moderated' },
      })
      render(<CharacterCard character={character} />)
      focusPortrait('Alice')

      expect(screen.getByRole('link', { name: /Resume Supper at Eight/ })).toHaveAttribute('href', '/salon/chat-5')
    })

    it('offers no latest chat when the character has none', () => {
      render(<CharacterCard character={createMockCharacter({ name: 'Alice', latestChat: null })} />)
      focusPortrait('Alice')
      expect(screen.queryByRole('link', { name: /Resume/ })).not.toBeInTheDocument()
    })

    // The character may be on show while their latest chat is not: a hidden
    // co-star, or the Concierge's Unmoderated state.
    it('leaves the latest chat out when quick-hide hides that chat', () => {
      const spy = stubQuickHide(chat => Boolean(chat.characterTags?.includes('hidden-tag')))
      const character = createMockCharacter({
        name: 'Alice',
        latestChat: { id: 'chat-5', title: 'Supper at Eight', characterTags: ['hidden-tag'], conciergeState: 'moderated' },
      })
      render(<CharacterCard character={character} />)
      focusPortrait('Alice')

      expect(spy).toHaveBeenCalledWith({ characterTags: ['hidden-tag'], conciergeState: 'moderated' })
      expect(screen.queryByRole('link', { name: /Resume/ })).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Open Alice.s page/ })).toBeInTheDocument()
    })

    it('opens on the side and edge it is told to', () => {
      const { container } = render(
        <CharacterCard character={createMockCharacter({ name: 'Alice' })} align="end" placement="above" />
      )
      focusPortrait('Alice')
      const popover = container.querySelector('.qt-character-card-popover')
      expect(popover).toHaveAttribute('data-align', 'end')
      expect(popover).toHaveAttribute('data-placement', 'above')
    })
  })

  it('renders with multiple character instances', () => {
    render(
      <>
        <CharacterCard character={createMockCharacter({ id: 'a', name: 'Alice' })} />
        <CharacterCard character={createMockCharacter({ id: 'b', name: 'Bob' })} />
      </>
    )
    expect(screen.getByRole('button', { name: 'Start a chat with Alice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a chat with Bob' })).toBeInTheDocument()
  })
})

describe('CharactersSection', () => {
  /** Enough characters to overflow the unmeasured wall (six abreast, two rows). */
  function company(count: number) {
    return Array.from({ length: count }, (_, i) => createMockCharacter({ id: `char-${i}`, name: `Member ${i}` }))
  }

  it('renders section title', () => {
    render(<CharactersSection characters={[]} total={0} />)
    expect(screen.getByText('The Company')).toBeInTheDocument()
  })

  it('renders view all link', () => {
    render(<CharactersSection characters={[]} total={0} />)
    const link = screen.getByRole('link', { name: /View all/ })
    expect(link).toHaveAttribute('href', '/aurora')
  })

  it('shows every character when they all fit', () => {
    const characters = [
      createMockCharacter({ id: 'char-1', name: 'Alice' }),
      createMockCharacter({ id: 'char-2', name: 'Bob' }),
      createMockCharacter({ id: 'char-3', name: 'Charlie' }),
    ]
    const { container } = render(<CharactersSection characters={characters} total={3} />)
    expect(screen.getAllByRole('button', { name: /Start a chat with/ })).toHaveLength(3)
    // No one is left over, so there is no "everyone" tile.
    expect(container.querySelector('[data-kind="all"]')).toBeNull()
  })

  // jsdom lays nothing out, so the wall keeps its unmeasured six columns:
  // two rows of six, the last place given to the "everyone" tile.
  it('fills two rows and gives the last place to the rest', () => {
    const { container } = render(<CharactersSection characters={company(20)} total={43} />)

    expect(screen.getAllByRole('button', { name: /Start a chat with/ })).toHaveLength(11)
    const all = container.querySelector('[data-kind="all"]')
    expect(all).toHaveAttribute('href', '/aurora')
    expect(all).toHaveTextContent('All 43')
  })

  it('shows the "everyone" tile when more characters exist than were sent', () => {
    const { container } = render(<CharactersSection characters={company(4)} total={9} />)
    expect(container.querySelector('[data-kind="all"]')).toHaveTextContent('All 9')
  })

  it('opens cards away from the wall: above the first row, below the last', () => {
    const focusVisible = stubFocusVisible(true)
    const { container } = render(<CharactersSection characters={company(20)} total={20} />)
    const buttons = screen.getAllByRole('button', { name: /Start a chat with/ })

    fireEvent.focus(buttons[0])
    expect(container.querySelector('.qt-character-card-popover')).toHaveAttribute('data-placement', 'above')
    expect(container.querySelector('.qt-character-card-popover')).toHaveAttribute('data-align', 'start')
    fireEvent.blur(buttons[0], { relatedTarget: document.body })

    fireEvent.focus(buttons[10])
    expect(container.querySelector('.qt-character-card-popover')).toHaveAttribute('data-placement', 'below')
    expect(container.querySelector('.qt-character-card-popover')).toHaveAttribute('data-align', 'end')
    focusVisible.mockRestore()
  })

  it('leaves out characters quick-hide is hiding', () => {
    mockUseQuickHide.mockReturnValue({
      shouldHideChat: jest.fn(() => false),
      shouldHideByIds: jest.fn((tags: string[]) => tags.includes('hidden-tag')),
    })
    const characters = [
      createMockCharacter({ id: 'char-1', name: 'Alice' }),
      createMockCharacter({ id: 'char-2', name: 'Bob', tags: ['hidden-tag'] }),
    ]
    render(<CharactersSection characters={characters} total={2} />)

    expect(screen.getByRole('button', { name: 'Start a chat with Alice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start a chat with Bob' })).not.toBeInTheDocument()
  })

  // A head count would give the hidden ones away.
  it('gives no head count while quick-hide is hiding someone', () => {
    mockUseQuickHide.mockReturnValue({
      shouldHideChat: jest.fn(() => false),
      shouldHideByIds: jest.fn((tags: string[]) => tags.includes('hidden-tag')),
    })
    const characters = [...company(14), createMockCharacter({ id: 'secret', name: 'Secret', tags: ['hidden-tag'] })]
    const { container } = render(<CharactersSection characters={characters} total={15} />)

    const all = container.querySelector('[data-kind="all"]')
    expect(all).toHaveTextContent('Everyone')
    expect(all).not.toHaveTextContent('15')
  })

  it('renders empty state when no characters', () => {
    const { container } = render(<CharactersSection characters={[]} total={0} />)
    expect(container.querySelector('.qt-homepage-empty')).toBeInTheDocument()
    expect(container.querySelector('.qt-characters-grid')).toBeNull()
  })

  it('renders empty state link to the characters page', () => {
    render(<CharactersSection characters={[]} total={0} />)
    const link = screen.getByRole('link', { name: /acquaintance/ })
    expect(link).toHaveAttribute('href', '/aurora')
  })

  it('does not render empty state when characters exist', () => {
    const { container } = render(<CharactersSection characters={[createMockCharacter()]} total={1} />)
    expect(container.querySelector('.qt-homepage-empty')).toBeNull()
  })

  it('is the characters band', () => {
    const { container } = render(<CharactersSection characters={[]} total={0} />)
    expect(container.querySelector('.qt-homepage-section')).toHaveAttribute('data-section', 'characters')
  })

  it('applies qt-characters-grid class when characters exist', () => {
    const { container } = render(<CharactersSection characters={[createMockCharacter()]} total={1} />)
    expect(container.querySelector('.qt-characters-grid')).toBeInTheDocument()
  })
})
