'use client'

import { useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { Tooltip } from '@/components/ui/Tooltip'
import RngDropdown, { type RngPendingResult } from './RngDropdown'
import CustomToolsButton from './CustomToolsButton'

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
  /** Callback to open the Compose Mail dialog (The Post Office) */
  onComposeMailClick: () => void
  /** Callback to open the Inform dialog — out-of-character word to the cast */
  onInformClick: () => void
  /** Chat ID for RNG API calls */
  chatId: string
  /** Callback when RNG result is ready */
  onPendingToolResult?: (result: RngPendingResult) => void
  /** Whether this chat resolves a non-empty custom-tool roster. The custom
   *  tools button is rendered only when it does — an empty roster means the
   *  user has no definitions in scope and the button would open onto nothing. */
  customToolsAvailable?: boolean
  /** Opens Pascal's custom-tool dialog (mounted in the Salon's ChatModals) */
  onCustomToolsClick?: () => void
  /** Whether the tools are disabled */
  disabled?: boolean
}

/**
 * Gutter tools for the chat composer.
 *
 * Displays small icon buttons for frequently-used message-level tools in a
 * two-column grid, filling left-to-right:
 * - Row 1: Insert Announcement (megaphone), Compose Mail (envelope)
 * - Row 2: Library file (document), Generate image (camera)
 * - Row 3: Attach file (paperclip), RNG (dice)
 * - Row 4: Custom tools (wand) — present only when `customToolsAvailable` —
 *   then Inform (info). With Pascal in the roster row 4 reads *Pascal, Inform*
 *   and the grid is a full 4×2; without him Inform falls to row 4 column 1 on
 *   its own, leaving the last row half-full.
 *
 * These are positioned in the left gutter of the composer for quick access.
 */
export function ComposerGutterTools({
  onAttachFileClick,
  uploadingFile = false,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  onInsertAnnouncementClick,
  onComposeMailClick,
  onInformClick,
  chatId,
  onPendingToolResult,
  customToolsAvailable = false,
  onCustomToolsClick,
  disabled = false,
}: Readonly<ComposerGutterToolsProps>) {
  const rngDropdownRef = useRef<HTMLDivElement>(null)

  return (
    <div className="qt-composer-gutter-tools">
      {/* Row 1, Col 1: Insert Announcement */}
      <Tooltip content="Insert announcement">
        <button
          type="button"
          onClick={onInsertAnnouncementClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          aria-label="Insert announcement"
        >
          <Icon name="megaphone" className="w-5 h-5" />
        </button>
      </Tooltip>

      {/* Row 1, Col 2: Compose Mail — pairs with the megaphone as another
          "insert a special message" action (The Post Office) */}
      <Tooltip content="Post a letter">
        <button
          type="button"
          onClick={onComposeMailClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          aria-label="Post a letter"
        >
          <Icon name="mail" className="w-5 h-5" />
        </button>
      </Tooltip>

      {/* Row 2, Col 1: Library File */}
      <Tooltip content="Attach file from library">
        <button
          type="button"
          onClick={onLibraryFileClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          aria-label="Attach file from library"
        >
          <Icon name="file-plus" className="w-5 h-5" />
        </button>
      </Tooltip>

      {/* Row 2, Col 2: Generate Image */}
      <Tooltip content="Generate image">
        <button
          type="button"
          onClick={onStandaloneGenerateImageClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          aria-label="Generate image"
        >
          <Icon name="camera" className="w-5 h-5" />
        </button>
      </Tooltip>

      {/* Row 3, Col 1: Attach File */}
      <Tooltip content="Attach file">
        <button
          type="button"
          onClick={onAttachFileClick}
          disabled={disabled || uploadingFile}
          className="qt-composer-gutter-button"
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
      </Tooltip>

      {/* Row 3, Col 2: RNG with dropdown */}
      <div ref={rngDropdownRef} className="qt-composer-gutter-rng">
        <RngDropdown
          chatId={chatId}
          disabled={disabled}
          onPendingResult={onPendingToolResult}
          variant="gutter"
        />
      </div>

      {/* Row 4, Col 1: Custom tools (Pascal) — opens a dialog; only when the
          chat actually resolves a roster */}
      {customToolsAvailable && onCustomToolsClick && (
        <CustomToolsButton
          onClick={onCustomToolsClick}
          disabled={disabled}
          variant="gutter"
        />
      )}

      {/* Row 4, Col 2 (or Col 1 when Pascal is absent): Inform — a quiet word
          out of character, delivered to a seat before it next speaks */}
      <Tooltip content="Inform the cast">
        <button
          type="button"
          onClick={onInformClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          aria-label="Inform the cast"
        >
          <Icon name="info" className="w-5 h-5" />
        </button>
      </Tooltip>
    </div>
  )
}

export default ComposerGutterTools
