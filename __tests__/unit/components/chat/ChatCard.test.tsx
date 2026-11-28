import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

const navigate = jest.fn()
jest.mock('@/components/workspace/useWorkspaceNavigate', () => ({ useWorkspaceNavigate: () => navigate }))
jest.mock('@/hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copied: false, copy: jest.fn() }) }))
jest.mock('@/hooks/usePersonaDisplayName', () => ({ useUserCharacterDisplayName: () => 'Me' }))
jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/components/ui/AvatarStack', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/tags/tag-display', () => ({ TagDisplay: () => null }))
jest.mock('@/components/chat/ConciergeMark', () => ({ ConciergeMark: () => null }))

import { ChatCard } from '@/components/chat/ChatCard'

const chat = {
  id: 'chat-1',
  title: 'A chat',
  messageCount: 3,
  memoryCount: 2,
  participants: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('ChatCard keyboard', () => {
  beforeEach(() => navigate.mockClear())

  it('does not navigate when Enter is pressed on an inner button (#245)', () => {
    const onReextract = jest.fn()
    render(<ChatCard chat={chat as any} onReextractMemories={onReextract} />)
    const inner = screen.getByRole('button', { name: /memories/ })
    fireEvent.keyDown(inner, { key: 'Enter' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigates when Enter is pressed on the card itself', () => {
    const { container } = render(<ChatCard chat={chat as any} />)
    fireEvent.keyDown(container.firstElementChild as HTMLElement, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('/salon/chat-1')
  })
})
