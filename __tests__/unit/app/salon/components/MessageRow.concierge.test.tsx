/**
 * MessageRow — the Concierge's polish (concierge-overhaul phase 5):
 *
 * - "Not Dangerous" lifts the blur: only flags still standing blur or collapse
 *   a message; overridden chips stay, struck through, as the record.
 * - "Try uncensored" is offered on character lines and the Lantern's refused
 *   backdrop, and on none of them when the chat is Locked (no handlers).
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { MessageRow } from '@/app/salon/[id]/components/MessageRow'
import type { ConciergeRetryHandlers } from '@/app/salon/[id]/concierge-retry'
import { renderWithQuery } from '../../../../helpers/renderWithQuery'

jest.mock('@/components/chat/LazyMessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="content">{content}</div>,
}))
jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))
jest.mock('@/components/terminal/TerminalEmbed', () => ({ TerminalEmbed: () => null }))

const noop = () => {}

function baseProps(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    message: {
      id: 'msg-1',
      role: 'ASSISTANT',
      content: 'A line of prose.',
      createdAt: '2026-09-25T00:00:00.000Z',
      attachments: [],
      participantId: 'seat-1',
      ...message,
    },
    messageIndex: 0,
    isEditing: false,
    editContent: '',
    viewSourceMessageIds: new Set<string>(),
    swipeState: null,
    showResendButton: false,
    shouldShowAvatars: false,
    messageAvatar: null,
    isMultiChar: false,
    participantData: [],
    turnState: { currentTurnParticipantId: null } as never,
    streaming: false,
    waitingForResponse: false,
    userParticipantId: null,
    conciergeDisplay: { mode: 'BLUR' as const, showWarningBadges: true },
    onEditStart: noop,
    onEditSave: noop,
    onEditCancel: noop,
    onEditChange: noop,
    onToggleSourceView: noop,
    onDelete: noop,
    onGenerateSwipe: noop,
    onSwitchSwipe: noop,
    onCopyContent: noop,
    onResend: noop,
    onImageClick: noop,
    onHandleNudge: noop,
    onHandleQueue: noop,
    onHandleDequeue: noop,
    onHandleTalkativenessChange: noop,
    onHandleRemoveCharacter: noop,
    onHandleContinue: noop,
    ...extra,
  } as never
}

const flag = (userOverridden: boolean) => ({
  category: 'nsfw', score: 0.9, userOverridden, wasRerouted: false,
})

function retryHandlers(): ConciergeRetryHandlers {
  return { onRetryTurn: jest.fn(), onRetryPicture: jest.fn(), onRetryBackground: jest.fn() }
}

describe('MessageRow — "Not Dangerous" clears the blur', () => {
  it('blurs a message with a standing flag', () => {
    render(<MessageRow {...baseProps({ role: 'USER', dangerFlags: [flag(false)] })} />)
    expect(screen.getByText('Click to reveal flagged content')).toBeInTheDocument()
  })

  it('shows a message whose flags are all overridden, chips still there struck through', () => {
    render(<MessageRow {...baseProps({ role: 'USER', dangerFlags: [flag(true)] })} />)
    expect(screen.queryByText('Click to reveal flagged content')).not.toBeInTheDocument()
    const chip = screen.getByText('NSFW')
    expect(chip.className).toContain('line-through')
    expect(screen.queryByText('Not Dangerous')).not.toBeInTheDocument()
  })

  it('keeps blurring while any one flag is still standing', () => {
    render(<MessageRow {...baseProps({ role: 'USER', dangerFlags: [flag(true), { ...flag(false), category: 'violence' }] })} />)
    expect(screen.getByText('Click to reveal flagged content')).toBeInTheDocument()
  })

  it('lifts the blur when the override lands on a re-render', () => {
    const { rerender } = render(<MessageRow {...baseProps({ role: 'USER', dangerFlags: [flag(false)] })} />)
    expect(screen.getByText('Click to reveal flagged content')).toBeInTheDocument()
    rerender(<MessageRow {...baseProps({ role: 'USER', dangerFlags: [flag(true)] })} />)
    expect(screen.queryByText('Click to reveal flagged content')).not.toBeInTheDocument()
  })
})

describe('MessageRow — "Try uncensored"', () => {
  it('is offered on a character line and re-rolls it', () => {
    const handlers = retryHandlers()
    render(<MessageRow {...baseProps({}, { conciergeRetry: handlers })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try uncensored' }))
    expect(handlers.onRetryTurn).toHaveBeenCalledWith('msg-1')
  })

  it('is absent on a Locked chat (no handlers)', () => {
    render(<MessageRow {...baseProps({})} />)
    expect(screen.queryByRole('button', { name: 'Try uncensored' })).not.toBeInTheDocument()
  })

  it('is absent on the operator\'s own lines', () => {
    render(<MessageRow {...baseProps({ role: 'USER' }, { conciergeRetry: retryHandlers() })} />)
    expect(screen.queryByRole('button', { name: 'Try uncensored' })).not.toBeInTheDocument()
  })

  it('is offered on the Lantern\'s refused backdrop and re-queues it', () => {
    const handlers = retryHandlers()
    render(
      <MessageRow
        {...baseProps(
          { systemSender: 'lantern', systemKind: 'background-refused', participantId: null, content: 'The Lantern\'s usual painter would not take the scene.' },
          { conciergeRetry: handlers, onToggleSystemMessageExpanded: noop },
        )}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: 'Try uncensored' })
    // The Staff bubble has no line to re-roll, only the backdrop to redo.
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(handlers.onRetryBackground).toHaveBeenCalled()
    expect(handlers.onRetryTurn).not.toHaveBeenCalled()
  })

  it('offers the picture retry on a folded generate_image block', () => {
    const handlers = retryHandlers()
    const tool = {
      id: 'tool-1',
      role: 'TOOL',
      createdAt: '2026-09-25T00:00:00.000Z',
      content: JSON.stringify({ toolName: 'generate_image', success: false, arguments: { prompt: 'x' } }),
      routeTrail: [{ profileId: 'p', profileName: 'Gemini', provider: 'GOOGLE', modelName: 'imagen', via: 'primary', outcome: 'refused', profileKind: 'image' }],
    }
    // The picture's call sheet renders provider badges, which read the provider list.
    renderWithQuery(<MessageRow {...baseProps({}, { conciergeRetry: handlers, attachedToolMessages: [tool] })} />)
    const buttons = screen.getAllByRole('button', { name: 'Try uncensored' })
    // One on the line, one on the picture.
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons.find(b => b.textContent === 'Try uncensored')!)
    expect(handlers.onRetryPicture).toHaveBeenCalledWith('tool-1')
  })
})
