/**
 * Tests for the composer gutter palette's Compose Mail button.
 *
 * Verifies the mail button fires `onComposeMailClick` and respects `disabled`.
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import ComposerGutterTools from '@/components/chat/ComposerGutterTools'

// RngDropdown makes API calls and manages its own popover — out of scope here.
jest.mock('@/components/chat/RngDropdown', () => ({
  __esModule: true,
  default: () => <div data-testid="rng-dropdown" />,
}))

function renderTools(overrides: Partial<React.ComponentProps<typeof ComposerGutterTools>> = {}) {
  const onComposeMailClick = jestGlobal.fn()
  render(
    <ComposerGutterTools
      onAttachFileClick={() => {}}
      onLibraryFileClick={() => {}}
      onStandaloneGenerateImageClick={() => {}}
      onInsertAnnouncementClick={() => {}}
      onComposeMailClick={onComposeMailClick}
      chatId="chat-1"
      {...overrides}
    />,
  )
  return { onComposeMailClick }
}

describe('ComposerGutterTools — Compose Mail button', () => {
  it('fires onComposeMailClick when clicked', () => {
    const { onComposeMailClick } = renderTools()
    fireEvent.click(screen.getByRole('button', { name: 'Post a letter' }))
    expect(onComposeMailClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled (and does not fire) when the palette is disabled', () => {
    const { onComposeMailClick } = renderTools({ disabled: true })
    const button = screen.getByRole('button', { name: 'Post a letter' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onComposeMailClick).not.toHaveBeenCalled()
  })
})
