/**
 * #308: a private run whispers to the operator's user id; the announcement bar
 * must read "to you", not "to unknown".
 */
import { render, screen } from '@testing-library/react'
import React from 'react'
jest.mock('@/components/chat/MentionChip', () => ({ MentionChip: () => null }))
jest.mock('@/hooks/useChatMentions', () => ({ useChatMentions: () => [] }))
import { AnnouncementBarContents } from '@/app/salon/[id]/components/AnnouncementChip'

const message = {
  id: 'm1',
  type: 'message',
  role: 'ASSISTANT',
  content: 'rolled',
  systemSender: 'pascal',
  targetParticipantIds: ['user-1'],
  createdAt: '2026-11-27T00:00:00.000Z',
} as never

describe('AnnouncementBarContents whisper audience', () => {
  it('reads "to you" for the operator user id', () => {
    render(<AnnouncementBarContents message={message} currentUserId="user-1" />)
    expect(screen.getByText(/to you/)).toBeInTheDocument()
    expect(screen.queryByText(/unknown/)).toBeNull()
  })

  it('still falls back to unknown for a stranger', () => {
    render(<AnnouncementBarContents message={message} currentUserId="someone-else" />)
    expect(screen.getByText(/to unknown/)).toBeInTheDocument()
  })
})
