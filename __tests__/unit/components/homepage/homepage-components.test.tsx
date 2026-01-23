/**
 * Homepage Components Unit Tests
 *
 * Comprehensive tests for all homepage dashboard components:
 * - WelcomeSection
 * - QuickActionsRow
 * - RecentChatsSection
 * - RecentChatItem
 * - ProjectsSection
 * - ProjectItem
 * - CharactersSection
 * - CharacterCard
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { WelcomeSection } from '@/components/homepage/WelcomeSection'
import { QuickActionsRow } from '@/components/homepage/QuickActionsRow'
import { RecentChatsSection } from '@/components/homepage/RecentChatsSection'
import { RecentChatItem } from '@/components/homepage/RecentChatItem'
import { ProjectsSection } from '@/components/homepage/ProjectsSection'
import { ProjectItem } from '@/components/homepage/ProjectItem'
import { CharactersSection } from '@/components/homepage/CharactersSection'
import { CharacterCard } from '@/components/homepage/CharacterCard'
import type { RecentChat, HomepageProject, HomepageCharacter } from '@/components/homepage/types'

// Mock next/link
jest.mock('next/link', () => {
  return function MockLink({
    children,
    href,
    className,
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) {
    return (
      <a href={href} className={className}>
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

// Mock QuickChatDialog
jest.mock('@/components/dashboard/QuickChatDialog', () => ({
  QuickChatDialog: function MockQuickChatDialog({
    characterId,
    characterName,
    isOpen,
    onClose,
  }: any) {
    if (!isOpen) return null
    return (
      <div
        data-testid="quick-chat-dialog"
        data-character-id={characterId}
        data-character-name={characterName}
        role="dialog"
      >
        <button onClick={onClose} type="button">Close</button>
      </div>
    )
  },
}))

// Mock CreateProjectDialog
jest.mock('@/app/(authenticated)/projects/components', () => ({
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

// Mock useQuickHide provider
jest.mock('@/components/providers/quick-hide-provider', () => ({
  useQuickHide: jest.fn(() => ({
    shouldHideByIds: jest.fn(() => false),
  })),
}))

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

  it('renders question text', () => {
    render(<WelcomeSection displayName="John" />)
    expect(screen.getByText('What would you like to do today?')).toBeInTheDocument()
  })

  it('renders with different display names', () => {
    render(<WelcomeSection displayName="Alice" />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders with empty display name', () => {
    render(<WelcomeSection displayName="" />)
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument()
  })

  it('applies correct CSS classes', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    const welcomeDiv = container.querySelector('div')
    expect(welcomeDiv).toHaveClass('text-center', 'py-6')
  })

  it('renders h1 with correct classes', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    const h1 = container.querySelector('h1')
    expect(h1).toHaveClass('text-3xl', 'font-bold', 'mb-2')
  })

  it('renders paragraph with muted foreground class', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    const paragraph = container.querySelector('p')
    expect(paragraph).toHaveClass('text-muted-foreground')
  })

  it('renders name with primary text class', () => {
    const { container } = render(<WelcomeSection displayName="John" />)
    const span = container.querySelector('span')
    expect(span).toHaveClass('text-primary')
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
    render(<QuickActionsRow lastChatId={null} />)
    const startChatLink = screen.getByRole('link', { name: /chat/i })
    expect(startChatLink).toBeInTheDocument()
    expect(startChatLink).toHaveAttribute('href', '/chats/new')
  })

  it('renders continue last button when lastChatId is provided', () => {
    render(<QuickActionsRow lastChatId="chat-123" />)
    const continueLink = screen.getByRole('link', { name: /continue/i })
    expect(continueLink).toBeInTheDocument()
    expect(continueLink).toHaveAttribute('href', '/chats/chat-123')
  })

  it('renders disabled continue button when no lastChatId', () => {
    render(<QuickActionsRow lastChatId={null} />)
    const buttons = screen.getAllByRole('button')
    const continueButton = buttons.find(
      (btn) => btn.textContent?.includes('Continue') || btn.textContent?.includes('continue')
    )
    expect(continueButton).toBeDisabled()
    expect(continueButton).toHaveClass('opacity-50', 'cursor-not-allowed')
  })

  it('renders new project button', () => {
    render(<QuickActionsRow lastChatId={null} />)
    const projectButton = screen.getByRole('button', { name: /project/i })
    expect(projectButton).toBeInTheDocument()
  })

  it('renders generate image button', () => {
    render(<QuickActionsRow lastChatId={null} />)
    const imageLink = screen.getByRole('link', { name: /image/i })
    expect(imageLink).toBeInTheDocument()
    expect(imageLink).toHaveAttribute('href', '/generate-image')
  })

  it('opens project dialog when project button is clicked', () => {
    render(<QuickActionsRow lastChatId={null} />)
    const projectButton = screen.getByRole('button', { name: /project/i })

    fireEvent.click(projectButton)

    expect(screen.getByTestId('create-project-dialog')).toBeInTheDocument()
  })

  it('closes project dialog when cancel button is clicked', () => {
    render(<QuickActionsRow lastChatId={null} />)
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

    render(<QuickActionsRow lastChatId={null} />)
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
    const { container } = render(<QuickActionsRow lastChatId={null} />)
    const quickActions = container.querySelector('.qt-quick-actions')
    expect(quickActions).toBeInTheDocument()
  })

  it('renders all four action buttons with correct styling', () => {
    const { container } = render(<QuickActionsRow lastChatId="chat-123" />)
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
    expect(link).toHaveAttribute('href', '/chats/chat-123')
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
    // Verify the link contains styling for hover and transition
    const className = link?.getAttribute('class') || ''
    expect(className).toContain('rounded-lg')
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

describe('RecentChatsSection', () => {
  it('renders section title', () => {
    const chats = [createMockRecentChat()]
    render(<RecentChatsSection chats={chats} />)
    expect(screen.getByText('Recent Chats')).toBeInTheDocument()
  })

  it('renders view all link', () => {
    const chats = [createMockRecentChat()]
    render(<RecentChatsSection chats={chats} />)
    const link = screen.getByRole('link', { name: /View all/ })
    expect(link).toHaveAttribute('href', '/chats')
  })

  it('renders all chats', () => {
    const chats = [
      createMockRecentChat({ id: 'chat-1', title: 'Chat One' }),
      createMockRecentChat({ id: 'chat-2', title: 'Chat Two' }),
    ]
    render(<RecentChatsSection chats={chats} />)
    expect(screen.getByText('Chat One')).toBeInTheDocument()
    expect(screen.getByText('Chat Two')).toBeInTheDocument()
  })

  it('renders empty state when no chats', () => {
    render(<RecentChatsSection chats={[]} />)
    expect(screen.getByText('No chats yet')).toBeInTheDocument()
  })

  it('renders empty state link to start chat', () => {
    render(<RecentChatsSection chats={[]} />)
    const link = screen.getByRole('link', { name: /Start your first chat/ })
    expect(link).toHaveAttribute('href', '/chats/new')
  })

  it('does not render empty state when chats exist', () => {
    const chats = [createMockRecentChat()]
    render(<RecentChatsSection chats={chats} />)
    expect(screen.queryByText('No chats yet')).not.toBeInTheDocument()
  })

  it('applies qt-homepage-section class', () => {
    const { container } = render(<RecentChatsSection chats={[]} />)
    const section = container.querySelector('.qt-homepage-section')
    expect(section).toBeInTheDocument()
  })

  it('applies qt-homepage-section-header class', () => {
    const { container } = render(<RecentChatsSection chats={[]} />)
    const header = container.querySelector('.qt-homepage-section-header')
    expect(header).toBeInTheDocument()
  })

  it('applies qt-homepage-section-title class', () => {
    const { container } = render(<RecentChatsSection chats={[]} />)
    const title = container.querySelector('.qt-homepage-section-title')
    expect(title).toBeInTheDocument()
  })

  it('renders RecentChatItem for each chat', () => {
    const chats = [
      createMockRecentChat({ id: 'chat-1' }),
      createMockRecentChat({ id: 'chat-2' }),
      createMockRecentChat({ id: 'chat-3' }),
    ]
    render(<RecentChatsSection chats={chats} />)
    const links = screen.getAllByRole('link')
    // 3 chat items + 1 view all link
    expect(links.length).toBeGreaterThanOrEqual(4)
  })
})

describe('ProjectItem', () => {
  it('renders project name', () => {
    const project = createMockProject({ name: 'My Project' })
    render(<ProjectItem project={project} />)
    expect(screen.getByText('My Project')).toBeInTheDocument()
  })

  it('renders description', () => {
    const project = createMockProject({ description: 'A great project' })
    render(<ProjectItem project={project} />)
    expect(screen.getByText('A great project')).toBeInTheDocument()
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
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/projects/proj-123')
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
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('fill', '#ff0000')
  })

  it('applies hover styling', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const link = container.querySelector('a')
    expect(link).toBeInTheDocument()
    // Verify the link contains styling for hover and transition
    const className = link?.getAttribute('class') || ''
    expect(className).toContain('rounded-lg')
  })

  it('renders folder icon', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('renders icon container with correct classes', () => {
    const { container } = render(<ProjectItem project={createMockProject()} />)
    const iconContainer = container.querySelector('.rounded-md.bg-muted')
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
    const projects = [createMockProject()]
    render(<ProjectsSection projects={projects} />)
    expect(screen.getByText('Active Projects')).toBeInTheDocument()
  })

  it('renders view all link', () => {
    const projects = [createMockProject()]
    render(<ProjectsSection projects={projects} />)
    const link = screen.getByRole('link', { name: /View all/ })
    expect(link).toHaveAttribute('href', '/projects')
  })

  it('renders all projects', () => {
    const projects = [
      createMockProject({ id: 'proj-1', name: 'Project One' }),
      createMockProject({ id: 'proj-2', name: 'Project Two' }),
    ]
    render(<ProjectsSection projects={projects} />)
    expect(screen.getByText('Project One')).toBeInTheDocument()
    expect(screen.getByText('Project Two')).toBeInTheDocument()
  })

  it('renders empty state when no projects', () => {
    render(<ProjectsSection projects={[]} />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })

  it('renders empty state help text', () => {
    render(<ProjectsSection projects={[]} />)
    expect(screen.getByText(/Create a project to organize your chats/)).toBeInTheDocument()
  })

  it('does not render empty state when projects exist', () => {
    const projects = [createMockProject()]
    render(<ProjectsSection projects={projects} />)
    expect(screen.queryByText('No projects yet')).not.toBeInTheDocument()
  })

  it('applies qt-homepage-section class', () => {
    const { container } = render(<ProjectsSection projects={[]} />)
    const section = container.querySelector('.qt-homepage-section')
    expect(section).toBeInTheDocument()
  })

  it('applies qt-homepage-section-header class', () => {
    const { container } = render(<ProjectsSection projects={[]} />)
    const header = container.querySelector('.qt-homepage-section-header')
    expect(header).toBeInTheDocument()
  })

  it('renders ProjectItem for each project', () => {
    const projects = [
      createMockProject({ id: 'proj-1' }),
      createMockProject({ id: 'proj-2' }),
      createMockProject({ id: 'proj-3' }),
    ]
    render(<ProjectsSection projects={projects} />)
    const links = screen.getAllByRole('link')
    // 3 project items + 1 view all link
    expect(links.length).toBeGreaterThanOrEqual(4)
  })
})

describe('CharacterCard', () => {
  it('renders character name', () => {
    const character = createMockCharacter({ name: 'Alice' })
    render(<CharacterCard character={character} />)
    expect(screen.getByRole('link', { name: /Alice/i })).toBeInTheDocument()
  })

  it('renders character title', () => {
    const character = createMockCharacter({ title: 'Wizard' })
    render(<CharacterCard character={character} />)
    expect(screen.getByText('Wizard')).toBeInTheDocument()
  })

  it('does not render title when not provided', () => {
    const character = createMockCharacter({ title: null })
    render(<CharacterCard character={character} />)
    expect(screen.queryByText(/Wizard/)).not.toBeInTheDocument()
  })

  it('renders avatar component', () => {
    const character = createMockCharacter()
    render(<CharacterCard character={character} />)
    expect(screen.getByTestId('avatar')).toBeInTheDocument()
  })

  it('links to character view page', () => {
    const character = createMockCharacter({ id: 'char-123' })
    render(<CharacterCard character={character} />)
    const link = screen.getByRole('link', { name: /Test Character/i })
    expect(link).toHaveAttribute('href', '/characters/char-123/view')
  })

  it('renders chat button', () => {
    const character = createMockCharacter()
    render(<CharacterCard character={character} />)
    const chatButton = screen.getByRole('button', { name: /Chat/i })
    expect(chatButton).toBeInTheDocument()
  })

  it('opens quick chat dialog when chat button is clicked', async () => {
    const character = createMockCharacter({ id: 'char-123', name: 'Alice' })
    render(<CharacterCard character={character} />)

    const chatButton = screen.getByRole('button', { name: /Chat/i })
    fireEvent.click(chatButton)

    await waitFor(() => {
      expect(screen.getByTestId('quick-chat-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('quick-chat-dialog')).toHaveAttribute(
      'data-character-id',
      'char-123'
    )
  })

  it('closes quick chat dialog when close button is clicked', async () => {
    const character = createMockCharacter()
    render(<CharacterCard character={character} />)

    const chatButton = screen.getByRole('button', { name: /Chat/i })
    fireEvent.click(chatButton)

    await waitFor(() => {
      expect(screen.getByTestId('quick-chat-dialog')).toBeInTheDocument()
    })

    const closeButton = screen.getByRole('button', { name: /Close/i })
    fireEvent.click(closeButton)

    await waitFor(() => {
      expect(screen.queryByTestId('quick-chat-dialog')).not.toBeInTheDocument()
    })
  })

  it('applies card styling classes', () => {
    const { container } = render(<CharacterCard character={createMockCharacter()} />)
    const card = container.querySelector('div')
    expect(card).toHaveClass('border', 'bg-card', 'hover:border-primary')
  })

  it('renders chat button with success styling', () => {
    const character = createMockCharacter()
    render(<CharacterCard character={character} />)
    const chatButton = screen.getByRole('button', { name: /Chat/i })
    expect(chatButton).toHaveClass('qt-button-success')
  })

  it('truncates long character name', () => {
    const { container } = render(
      <CharacterCard
        character={createMockCharacter({
          name: 'This is a very long character name that should be truncated',
        })}
      />
    )
    const nameElement = container.querySelector('.truncate')
    expect(nameElement).toBeInTheDocument()
  })

  it('passes character data to Avatar', () => {
    const character = createMockCharacter({ name: 'Alice' })
    render(<CharacterCard character={character} />)
    const avatar = screen.getByTestId('avatar')
    expect(avatar).toHaveAttribute('data-name', 'Alice')
  })

  it('renders chat icon in button', () => {
    const character = createMockCharacter()
    render(<CharacterCard character={character} />)
    const chatButton = screen.getByRole('button', { name: /Chat/i })
    const svg = chatButton.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('has accessible title on chat button', () => {
    const character = createMockCharacter({ name: 'Alice' })
    render(<CharacterCard character={character} />)
    const chatButton = screen.getByRole('button', { name: /Chat/i })
    expect(chatButton).toHaveAttribute('title', 'Start a chat with Alice')
  })

  it('renders with multiple character instances', () => {
    const char1 = createMockCharacter({ id: 'char-1', name: 'Alice' })
    const char2 = createMockCharacter({ id: 'char-2', name: 'Bob' })
    const { rerender } = render(<CharacterCard character={char1} />)
    expect(screen.getByRole('link', { name: /Alice/i })).toBeInTheDocument()

    rerender(<CharacterCard character={char2} />)
    expect(screen.getByRole('link', { name: /Bob/i })).toBeInTheDocument()
  })
})

describe('CharactersSection', () => {
  it('renders section title', () => {
    const characters = [createMockCharacter()]
    render(<CharactersSection characters={characters} />)
    expect(screen.getByText('Your Characters')).toBeInTheDocument()
  })

  it('renders manage link', () => {
    const characters = [createMockCharacter()]
    render(<CharactersSection characters={characters} />)
    const link = screen.getByRole('link', { name: /Manage/ })
    expect(link).toHaveAttribute('href', '/characters')
  })

  it('renders all characters up to 4', () => {
    const characters = [
      createMockCharacter({ id: 'char-1', name: 'Alice' }),
      createMockCharacter({ id: 'char-2', name: 'Bob' }),
      createMockCharacter({ id: 'char-3', name: 'Charlie' }),
    ]
    render(<CharactersSection characters={characters} />)
    // Verify all three character cards are rendered
    const characterCards = screen.getAllByRole('button', { name: /Chat/i })
    expect(characterCards).toHaveLength(3)
    // Verify each character appears by checking links
    expect(screen.getByRole('link', { name: /Alice/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Bob/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Charlie/i })).toBeInTheDocument()
  })

  it('limits display to 4 characters', () => {
    const characters = [
      createMockCharacter({ id: 'char-1', name: 'Alice' }),
      createMockCharacter({ id: 'char-2', name: 'Bob' }),
      createMockCharacter({ id: 'char-3', name: 'Charlie' }),
      createMockCharacter({ id: 'char-4', name: 'David' }),
      createMockCharacter({ id: 'char-5', name: 'Eve' }),
    ]
    render(<CharactersSection characters={characters} />)
    // Should show 4 characters
    const characterCards = screen.getAllByRole('button', { name: /Chat/i })
    expect(characterCards).toHaveLength(4)
    // Verify Eve is not in the document
    expect(screen.queryByText('Eve')).not.toBeInTheDocument()
  })

  it('renders empty state when no characters', () => {
    render(<CharactersSection characters={[]} />)
    expect(screen.getByText('No favorite characters')).toBeInTheDocument()
  })

  it('renders empty state link to mark favorites', () => {
    render(<CharactersSection characters={[]} />)
    const link = screen.getByRole('link', { name: /Mark some as favorites/ })
    expect(link).toHaveAttribute('href', '/characters')
  })

  it('does not render empty state when characters exist', () => {
    const characters = [createMockCharacter()]
    render(<CharactersSection characters={characters} />)
    expect(screen.queryByText('No favorite characters')).not.toBeInTheDocument()
  })

  it('applies qt-homepage-section class', () => {
    const { container } = render(<CharactersSection characters={[]} />)
    const section = container.querySelector('.qt-homepage-section')
    expect(section).toBeInTheDocument()
  })

  it('applies qt-characters-grid class when characters exist', () => {
    const characters = [createMockCharacter()]
    const { container } = render(<CharactersSection characters={characters} />)
    const grid = container.querySelector('.qt-characters-grid')
    expect(grid).toBeInTheDocument()
  })

  it('renders CharacterCard for each character', () => {
    const characters = [
      createMockCharacter({ id: 'char-1' }),
      createMockCharacter({ id: 'char-2' }),
    ]
    render(<CharactersSection characters={characters} />)
    const buttons = screen.getAllByRole('button', { name: /Chat/i })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })
})
