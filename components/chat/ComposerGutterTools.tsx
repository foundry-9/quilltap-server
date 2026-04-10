'use client'

import { useRef } from 'react'
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
 * Displays small icon buttons for frequently-used message-level tools
 * in a 2x2 grid:
 * - Row 1: Library file (document), Generate image (camera)
 * - Row 2: Attach file (paperclip), RNG (dice)
 *
 * These are positioned in the left gutter of the composer for quick access.
 */
export function ComposerGutterTools({
  onAttachFileClick,
  uploadingFile = false,
  onLibraryFileClick,
  onStandaloneGenerateImageClick,
  chatId,
  onPendingToolResult,
  disabled = false,
}: Readonly<ComposerGutterToolsProps>) {
  const rngDropdownRef = useRef<HTMLDivElement>(null)

  return (
    <div className="qt-composer-gutter-tools">
      {/* Row 1, Col 1: Library File */}
      <button
        type="button"
        onClick={onLibraryFileClick}
        disabled={disabled}
        className="qt-composer-gutter-button"
        title="Attach file from library"
        aria-label="Attach file from library"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11v6m-3-3h6" />
        </svg>
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
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <circle cx="12" cy="13" r="3" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
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
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
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
