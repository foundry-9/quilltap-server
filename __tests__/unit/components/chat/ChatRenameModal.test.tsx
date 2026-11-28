import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/lib/chat/use-patch-chat', () => ({
  usePatchChat: () => ({ patch: jest.fn(), isSaving: () => false }),
}))

import ChatRenameModal from '@/components/chat/ChatRenameModal'

function ui(isOpen: boolean, currentTitle = 'Original') {
  return (
    <ChatRenameModal isOpen={isOpen} onClose={() => {}} chatId="c1" currentTitle={currentTitle} isManuallyRenamed />
  )
}

describe('ChatRenameModal', () => {
  it('reopens with the chat title, not cancelled text (#275)', () => {
    const { rerender } = render(ui(true))
    fireEvent.change(screen.getByDisplayValue('Original'), { target: { value: 'abc' } })
    rerender(ui(false))
    rerender(ui(true))
    expect(screen.getByDisplayValue('Original')).toBeTruthy()
  })

  it('keeps typed text when the title changes while open (#275)', () => {
    const { rerender } = render(ui(true))
    fireEvent.change(screen.getByDisplayValue('Original'), { target: { value: 'abc' } })
    rerender(ui(true, 'Retitled'))
    expect(screen.getByDisplayValue('abc')).toBeTruthy()
  })
})
