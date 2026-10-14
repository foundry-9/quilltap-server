/**
 * The Concierge mark and the chat card that wears it.
 *
 * The mark reads the derived three-state, never the raw danger label, so what
 * matters here is that Moderated draws nothing, that the other two each get
 * their own tone, and that the words come from the one presentation table —
 * the same words the Salon header's pill and the sidebar's helper text use.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConciergeMark, ConciergeTooltipBody } from '@/components/chat/ConciergeMark'
import { ChatCard, type ChatCardData } from '@/components/chat/ChatCard'
import { describeConciergeState } from '@/lib/services/dangerous-content/concierge-state-presentation'
import type { ConciergeState } from '@/lib/services/dangerous-content/chat-override'

jest.mock('next/link', () => {
  return function MockLink({ children, href, className, onClick }: any) {
    return <a href={href} className={className} onClick={onClick}>{children}</a>
  }
})

jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({
  useWorkspaceNavigate: () => jest.fn(),
}))

jest.mock('@/hooks/usePersonaDisplayName', () => ({
  useUserCharacterDisplayName: () => ({ formatCharacterName: (name: string) => name }),
}))

jest.mock('@/components/ui/AvatarStack', () => {
  return function MockAvatarStack() {
    return <div data-testid="avatar-stack" />
  }
})

jest.mock('@/components/tags/tag-display', () => ({
  TagDisplay: () => null,
}))

function chatCard(overrides: Partial<ChatCardData> = {}): ChatCardData {
  return {
    id: 'chat-1',
    title: 'A Conversation',
    messageCount: 12,
    participants: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    conciergeState: 'moderated',
    dangerCategories: [],
    ...overrides,
  }
}

describe('ConciergeMark', () => {
  it('renders nothing for Moderated — the default wears no mark', () => {
    const { container } = render(<ConciergeMark conciergeState="moderated" />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['unmoderated', 'Concierge: Unmoderated', ''],
    ['locked', 'Concierge: Locked', 'qt-concierge-mark-muted'],
  ] as const)('marks %s with an asterisk labelled "%s"', (state, label, modifier) => {
    render(<ConciergeMark conciergeState={state} />)

    const mark = screen.getByLabelText(label)
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('qt-concierge-mark')
    // Danger is the base rule; only Locked adds a modifier.
    expect(mark.className).toBe(['qt-concierge-mark', modifier].filter(Boolean).join(' '))
  })

  it('keeps one tone for Unmoderated whoever set it — provenance is never a colour', () => {
    const { unmount } = render(<ConciergeMark conciergeState="unmoderated" conciergeSetBy="concierge" conciergeReason="classifier" />)
    expect(screen.getByLabelText('Concierge: Unmoderated').className).toBe('qt-concierge-mark')
    unmount()

    render(<ConciergeMark conciergeState="unmoderated" conciergeSetBy="operator" conciergeReason="manual" />)
    expect(screen.getByLabelText('Concierge: Unmoderated').className).toBe('qt-concierge-mark')
  })

  it('appends the caller\'s classes without losing the tone', () => {
    render(<ConciergeMark conciergeState="locked" className="text-sm flex-shrink-0" />)

    const mark = screen.getByLabelText('Concierge: Locked')
    expect(mark).toHaveClass('qt-concierge-mark', 'qt-concierge-mark-muted', 'text-sm', 'flex-shrink-0')
  })

  it('carries no native title — the drawn tooltip would double up on it', () => {
    render(<ConciergeMark conciergeState="unmoderated" />)
    expect(screen.getByLabelText('Concierge: Unmoderated')).not.toHaveAttribute('title')
  })

  describe('the tooltip', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

    function hover(element: HTMLElement) {
      fireEvent.pointerEnter(element)
      act(() => { jest.advanceTimersByTime(250) })
    }

    it.each(['unmoderated', 'locked'] as ConciergeState[])(
      'speaks the presentation table\'s words for %s',
      (state) => {
        const { title, detail, hint } = describeConciergeState(state)
        render(<ConciergeMark conciergeState={state} />)

        hover(screen.getByLabelText(`Concierge: ${title}`))

        const bubble = screen.getByRole('tooltip', { hidden: true })
        expect(bubble).toHaveTextContent(title)
        expect(bubble).toHaveTextContent(detail)
        expect(bubble).toHaveTextContent(hint)
      }
    )

    it('speaks the operator\'s sentence when the operator set Unmoderated', () => {
      render(<ConciergeMark conciergeState="unmoderated" conciergeSetBy="operator" conciergeReason="manual" />)

      hover(screen.getByLabelText('Concierge: Unmoderated'))

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent(/opened the uncensored door yourself/)
      expect(bubble).not.toHaveTextContent(/The Concierge moved this chat/)
    })

    it('speaks the Concierge\'s sentence when the Concierge set Unmoderated', () => {
      render(<ConciergeMark conciergeState="unmoderated" conciergeSetBy="concierge" conciergeReason="classifier" />)

      hover(screen.getByLabelText('Concierge: Unmoderated'))

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent(/The Concierge moved this chat to the uncensored desk on reading the conversation/)
      expect(bubble).not.toHaveTextContent(/opened the uncensored door yourself/)
    })

    it('lists the classifier\'s categories when the classifier moved the chat', () => {
      render(
        <ConciergeMark
          conciergeState="unmoderated"
          conciergeSetBy="concierge"
          conciergeReason="classifier"
          dangerCategories={['NSFW', 'Violence']}
        />
      )

      hover(screen.getByLabelText('Concierge: Unmoderated'))

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent('Categories')
      expect(bubble).toHaveTextContent('NSFW, Violence')
    })

    it('omits the categories line when the operator set the state', () => {
      render(<ConciergeMark conciergeState="unmoderated" conciergeSetBy="operator" dangerCategories={['NSFW']} />)

      hover(screen.getByLabelText('Concierge: Unmoderated'))

      expect(screen.getByRole('tooltip', { hidden: true })).not.toHaveTextContent('Categories')
    })

    it('omits the categories line on Locked', () => {
      render(<ConciergeMark conciergeState="locked" dangerCategories={['NSFW']} />)

      hover(screen.getByLabelText('Concierge: Locked'))

      expect(screen.getByRole('tooltip', { hidden: true })).not.toHaveTextContent('Categories')
    })
  })
})

describe('ConciergeTooltipBody', () => {
  it('renders title, detail and hint, and drops an absent categories line', () => {
    render(<ConciergeTooltipBody {...describeConciergeState('unmoderated', { setBy: 'operator' })} />)

    expect(screen.getByText('Unmoderated')).toBeInTheDocument()
    expect(screen.getByText(/opened the uncensored door yourself/)).toBeInTheDocument()
    expect(screen.getByText("Change it from the Salon sidebar's Chat section.")).toBeInTheDocument()
    expect(screen.queryByText('Categories')).not.toBeInTheDocument()
  })
})

describe('ChatCard — the Concierge mark', () => {
  it('draws no mark for a Moderated chat', () => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState: 'moderated' })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it('draws no mark when the payload carries no state at all', () => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState: undefined })} />)
    expect(container.querySelector('.qt-concierge-mark')).toBeNull()
  })

  it.each([
    ['unmoderated', 'Concierge: Unmoderated', ''],
    ['locked', 'Concierge: Locked', 'qt-concierge-mark-muted'],
  ] as const)('marks a %s chat', (conciergeState, label, modifier) => {
    const { container } = render(<ChatCard chat={chatCard({ conciergeState })} />)

    const mark = screen.getByLabelText(label)
    expect(mark).toHaveTextContent('*')
    expect(mark).toHaveClass('qt-concierge-mark')
    if (modifier) {
      expect(mark).toHaveClass(modifier)
    } else {
      expect(container.querySelector('.qt-concierge-mark-muted')).toBeNull()
    }
  })

  it('passes provenance through to the mark\'s tooltip', () => {
    jest.useFakeTimers()
    try {
      render(<ChatCard chat={chatCard({ conciergeState: 'unmoderated', conciergeSetBy: 'concierge', conciergeReason: 'classifier', dangerCategories: ['NSFW'] })} />)
      fireEvent.pointerEnter(screen.getByLabelText('Concierge: Unmoderated'))
      act(() => { jest.advanceTimersByTime(250) })

      const bubble = screen.getByRole('tooltip', { hidden: true })
      expect(bubble).toHaveTextContent(/The Concierge moved this chat/)
      expect(bubble).toHaveTextContent('NSFW')
    } finally {
      jest.runOnlyPendingTimers()
      jest.useRealTimers()
    }
  })
})
