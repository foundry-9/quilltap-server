/**
 * MessageRow's theme hooks (Calliope Live, Spec B): a row says who, in kind,
 * wrote it in `data-role`, and a Staff row names its sender in `data-staff`.
 * The existing user / assistant classes stay as they were.
 */

import React from 'react'

import { MessageRow } from '@/app/salon/[id]/components/MessageRow'
import { renderWithQuery } from '../../../../helpers/renderWithQuery'

jest.mock('@/components/chat/LazyMessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="content">{content}</div>,
}))
jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))
// react-markdown and remark-gfm are ESM-only; the Atlas card renders through them.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => {} }))
jest.mock('@/components/terminal/TerminalEmbed', () => ({ TerminalEmbed: () => null }))
jest.mock('@/hooks/useChatMentions', () => ({ useChatMentions: () => [] }))

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

function rowOf(container: HTMLElement): HTMLElement {
  return container.querySelector('.qt-chat-message-row') as HTMLElement
}

describe('MessageRow theme hooks', () => {
  it('a character line is an assistant row with no staff sender', () => {
    const { container } = renderWithQuery(<MessageRow {...baseProps({})} />)
    const row = rowOf(container)
    expect(row).toHaveAttribute('data-role', 'assistant')
    expect(row).not.toHaveAttribute('data-staff')
    expect(row).toHaveClass('qt-chat-message-row-assistant')
  })

  it('a user line is a user row', () => {
    const { container } = renderWithQuery(<MessageRow {...baseProps({ role: 'USER' })} />)
    expect(rowOf(container)).toHaveAttribute('data-role', 'user')
    expect(rowOf(container)).toHaveClass('qt-chat-message-row-user')
  })

  it('a Staff announcement is a staff row naming its sender, still classed as assistant', () => {
    const { container } = renderWithQuery(
      <MessageRow {...baseProps({ systemSender: 'lantern', systemKind: 'story-background' })} />,
    )
    const row = rowOf(container)
    expect(row).toHaveAttribute('data-role', 'staff')
    expect(row).toHaveAttribute('data-staff', 'lantern')
    expect(row).toHaveClass('qt-chat-message-row-assistant')
  })

  it('carries no message, chat or character id beyond the existing anchor', () => {
    const { container } = renderWithQuery(<MessageRow {...baseProps({})} />)
    const dataAttributes = Array.from(rowOf(container).attributes)
      .map((a) => a.name)
      .filter((n) => n.startsWith('data-'))
      .sort()
    expect(dataAttributes).toEqual(['data-message-id', 'data-role'])
  })
})
