'use client'

import { useRef } from 'react'
import RngDropdown, { type RngPendingResult } from './RngDropdown'

interface ComposerGutterToolsProps {
  /** Callback to trigger file attachment dialog */
  onAttachFileClick: () => void
  /** Whether file upload is in progress */
  uploadingFile?: boolean
  /** Callback to open image generation modal */
  onGenerateImageClick: () => void
  /** Whether the generate image button should be shown */
  hasImageProfile: boolean
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
 * Displays small icon buttons for frequently-used message-level tools:
 * - Attach file (paperclip)
 * - Generate image (image icon) - only shown when hasImageProfile is true
 * - RNG (dice icon)
 *
 * These are positioned in the left gutter of the composer for quick access.
 */
export function ComposerGutterTools({
  onAttachFileClick,
  uploadingFile = false,
  onGenerateImageClick,
  hasImageProfile,
  chatId,
  onPendingToolResult,
  disabled = false,
}: Readonly<ComposerGutterToolsProps>) {
  const rngDropdownRef = useRef<HTMLDivElement>(null)

  return (
    <div className="qt-composer-gutter-tools">
      {/* Attach File */}
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

      {/* Generate Image - only shown when character has image profile */}
      {hasImageProfile && (
        <button
          type="button"
          onClick={onGenerateImageClick}
          disabled={disabled}
          className="qt-composer-gutter-button"
          title="Generate image"
          aria-label="Generate image"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      )}

      {/* RNG with dropdown */}
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
