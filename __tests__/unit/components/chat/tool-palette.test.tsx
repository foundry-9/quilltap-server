/**
 * Unit tests for ToolPalette memory management actions
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ToolPalette from '@/components/chat/ToolPalette'

const baseProps = {
  isOpen: true,
  onClose: jest.fn(),
  onGalleryClick: jest.fn(),
  onGenerateImageClick: jest.fn(),
  onSettingsClick: jest.fn(),
  chatPhotoCount: 0,
  hasImageProfile: false,
  chatId: 'chat-1',
}

function renderPalette(overrides: Partial<React.ComponentProps<typeof ToolPalette>> = {}) {
  const props = { ...baseProps, ...overrides }
  return {
    onClose: props.onClose,
    ...render(
      <ToolPalette
        {...props}
      />
    ),
  }
}

describe('ToolPalette memory controls', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders and triggers Delete Chat Memories action', () => {
    const deleteMemories = jest.fn()
    const onClose = jest.fn()

    renderPalette({
      chatPhotoCount: 0,
      hasImageProfile: false,
      onDeleteChatMemoriesClick: deleteMemories,
      chatMemoryCount: 3,
      onClose,
    })

    const deleteButton = screen.getByRole('button', { name: /delete chat memories/i })
    fireEvent.click(deleteButton)

    expect(deleteMemories).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('renders and triggers Re-extract Memories action', () => {
    const reextract = jest.fn()
    const onClose = jest.fn()

    renderPalette({
      onReextractMemoriesClick: reextract,
      chatMemoryCount: 5,
      onClose,
    })

    const reextractButton = screen.getByRole('button', { name: /re-extract memories/i })
    fireEvent.click(reextractButton)

    expect(reextract).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

