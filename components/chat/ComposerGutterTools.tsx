'use client'

import { useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import RngDropdown, { type RngPendingResult } from './RngDropdown'

interface ComposerGutterToolsProps {
  /** Callback to trigger file attachment dialog */
  onAttachFileClick: () => void
  /** Whether file upload is in progress */
  uploadingFile?: boolean
  /** Callback to open library file picker modal */
  onLibraryFileClick: () => void
  /** Callback to open standalone image generation dialog */
  onStandaloneGenerateImageClick: () => void
  /** Callback to open the Insert Announcement dialog */
  onInsertAnnouncementClick: () => void
  /** Chat ID for RNG API calls */
  chatId: string
  /** Callback when RNG result is ready */
  onPendingToolResult?: (result: RngPendingResult) => void
  /** Whether the tools are disabled */
  disabled?: boolean
}

/**
 * Gutter tools for the chat composer.
 *
 * Displays small icon buttons for frequently-used message-level tools.
 * The top row is a full-width Insert Announcement button; the lower
 * block is a 2x2 grid:
 * - Row 1: Insert Announcement (megaphone, spans both columns)
 * - Row 2: Library file (document), Generate image (camera)
 * - Row 3: Attach file (paperclip), RNG (dice)
 *
 * These are positioned in the left gutter of the composer for quick access.
 */
export function ComposerGutterTools({
  onAttachFileClick,
  uploadingFile = false,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onInsertAnnouncementClick,
  chatId,
  onPendingToolResult,
  disabled = false,
}: Readonly<ComposerGutterToolsProps>) {
  const rngDropdownRef = useRef<HTMLDivElement>(null)

  return (
    <div className="qt-composer-gutter-tools">
      {/* Row 1: Insert Announcement (spans full width) */}
      <button
        type="button"
        onClick={onInsertAnnouncementClick}
        disabled={disabled}
        className="qt-composer-gutter-button qt-composer-gutter-button-wide"
        title="Insert announcement"
        aria-label="Insert announcement"
        style={{ gridColumn: '1 / -1' }}
      >
        <Icon name="megaphone" className="w-5 h-5" />
      </button>

      {/* Row 2, Col 1: Library File */}
      <button
        type="button"
        onClick={onLibraryFileClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Attach file from library"
        aria-label="Attach file from library"
      >
        <Icon name="file-plus" className="w-5 h-5" />
      </button>

      {/* Row 1, Col 2: Generate Image */}
      <button
        type="button"
        onClick={onStandaloneGenerateImageClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Generate image"
        aria-label="Generate image"
      >
        <Icon name="camera" className="w-5 h-5" />
      </button>

      {/* Row 2, Col 1: Attach File */}
      <button
        type="button"
        onClick={onAttachFileClick}
        disabled={disabled || uploadingFile}
        className="qt-composer-gutter-button"
        title="Attach file"
        aria-label="Attach file"
      >
        {uploadingFile ? (
          <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        ) : (
          <Icon name="paperclip" className="w-5 h-5" />
        )}
      </button>

      {/* Row 2, Col 2: RNG with dropdown */}
      <div ref={rngDropdownRef} className="qt-composer-gutter-rng">
        <RngDropdown
          chatId={chatId}
          disabled={disabled}
          onPendingResult={onPendingToolResult}
          variant="gutter"
        />
      </div>
    </div>
  )
}

export default ComposerGutterTools
