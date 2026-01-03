'use client'

import { useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useClickOutside } from '@/hooks/useClickOutside'

interface MobileToolPaletteProps {
  isOpen: boolean
  onClose: () => void
  toggleButtonRef?: React.RefObject<HTMLButtonElement | null>
  // File attachment
  onAttachFileClick: () => void
  uploadingFile: boolean
  // Preview toggle
  showPreview: boolean
  onTogglePreview: () => void
  // Gallery
  onGalleryClick: () => void
  chatPhotoCount: number
  // Generate Image
  onGenerateImageClick: () => void
  hasImageProfile: boolean
  // Add Character
  onAddCharacterClick?: () => void
  showAddCharacter?: boolean
  // Settings
  onSettingsClick: () => void
  // Rename
  onRenameClick?: () => void
  // Export
  chatId: string
  // Memory management
  onDeleteChatMemoriesClick?: () => void
  onReextractMemoriesClick?: () => void
  chatMemoryCount?: number
  // Disabled state
  disabled?: boolean
}

export default function MobileToolPalette({
  isOpen,
  onClose,
  toggleButtonRef,
  onAttachFileClick,
  uploadingFile,
  showPreview,
  onTogglePreview,
  onGalleryClick,
  chatPhotoCount,
  onGenerateImageClick,
  hasImageProfile,
  onAddCharacterClick,
  showAddCharacter = false,
  onSettingsClick,
  onRenameClick,
  chatId,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  chatMemoryCount = 0,
  disabled = false,
}: MobileToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useClickOutside(paletteRef, onClose, {
    enabled: isOpen,
    excludeRefs: toggleButtonRef ? [toggleButtonRef] : [],
    onEscape: onClose,
  })

  // Debug logging when palette opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[MobileToolPalette] Opened', {
        showAddCharacter,
        hasImageProfile,
        chatPhotoCount,
        chatId,
        chatMemoryCount,
        hasRenameCallback: !!onRenameClick,
      })
    }
  }, [isOpen, showAddCharacter, hasImageProfile, chatPhotoCount, chatId, chatMemoryCount, onRenameClick])

  // Handlers that close palette after action
  const handleAttachFileClick = () => {
    onAttachFileClick()
    onClose()
  }

  const handleTogglePreview = () => {
    onTogglePreview()
    onClose()
  }

  const handleGalleryClick = () => {
    onGalleryClick()
    onClose()
  }

  const handleGenerateImageClick = () => {
    onGenerateImageClick()
    onClose()
  }

  const handleAddCharacterClick = () => {
    clientLogger.debug('[MobileToolPalette] Add Character clicked')
    onAddCharacterClick?.()
    onClose()
  }

  const handleSettingsClick = () => {
    onSettingsClick()
    onClose()
  }

  const handleRenameClick = () => {
    clientLogger.debug('[MobileToolPalette] Rename clicked')
    onRenameClick?.()
    onClose()
  }

  const handleExportClick = () => {
    clientLogger.debug('[MobileToolPalette] Export Chat clicked', { chatId })
    window.location.href = `/api/chats/${chatId}/export`
    onClose()
  }

  const handleDeleteChatMemoriesClick = () => {
    clientLogger.debug('[MobileToolPalette] Delete Chat Memories clicked', { chatId, chatMemoryCount })
    onDeleteChatMemoriesClick?.()
    onClose()
  }

  const handleReextractMemoriesClick = () => {
    clientLogger.debug('[MobileToolPalette] Re-extract Memories clicked', { chatId })
    onReextractMemoriesClick?.()
    onClose()
  }

  return (
    <div
      ref={paletteRef}
      className={`qt-mobile-tool-palette ${isOpen ? 'qt-mobile-tool-palette-open' : ''}`}
    >
      {/* Memory Management Section - Top */}
      {(onDeleteChatMemoriesClick || onReextractMemoriesClick) && (
        <div className="qt-mobile-tool-palette-section">
          <div className="qt-mobile-tool-palette-section-header">Memory</div>
          <div className="qt-mobile-tool-palette-grid">
            {/* Re-extract Memories */}
            {onReextractMemoriesClick && (
              <button
                type="button"
                onClick={handleReextractMemoriesClick}
                className="qt-mobile-tool-palette-button"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span className="qt-mobile-tool-palette-button-label">Re-extract</span>
              </button>
            )}

            {/* Delete Chat Memories */}
            {onDeleteChatMemoriesClick && (
              <button
                type="button"
                onClick={handleDeleteChatMemoriesClick}
                className="qt-mobile-tool-palette-button qt-mobile-tool-palette-button-danger"
              >
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span className="qt-mobile-tool-palette-button-label">
                  Delete ({chatMemoryCount})
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat Tools Section */}
      <div className="qt-mobile-tool-palette-section">
        <div className="qt-mobile-tool-palette-section-header">Chat Tools</div>
        <div className="qt-mobile-tool-palette-grid">
          {/* View Gallery */}
          {chatPhotoCount > 0 && (
            <button
              type="button"
              onClick={handleGalleryClick}
              className="qt-mobile-tool-palette-button"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="qt-mobile-tool-palette-button-label">Gallery ({chatPhotoCount})</span>
            </button>
          )}

          {/* Generate Image */}
          {hasImageProfile && (
            <button
              type="button"
              onClick={handleGenerateImageClick}
              className="qt-mobile-tool-palette-button"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="qt-mobile-tool-palette-button-label">Generate Image</span>
            </button>
          )}

          {/* Add Character */}
          {showAddCharacter && onAddCharacterClick && (
            <button
              type="button"
              onClick={handleAddCharacterClick}
              className="qt-mobile-tool-palette-button"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              <span className="qt-mobile-tool-palette-button-label">Add Character</span>
            </button>
          )}

          {/* Chat Settings */}
          <button
            type="button"
            onClick={handleSettingsClick}
            className="qt-mobile-tool-palette-button"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="qt-mobile-tool-palette-button-label">Settings</span>
          </button>

          {/* Rename Chat */}
          {onRenameClick && (
            <button
              type="button"
              onClick={handleRenameClick}
              className="qt-mobile-tool-palette-button"
            >
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span className="qt-mobile-tool-palette-button-label">Rename</span>
            </button>
          )}

          {/* Export Chat */}
          <button
            type="button"
            onClick={handleExportClick}
            className="qt-mobile-tool-palette-button"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="qt-mobile-tool-palette-button-label">Export Chat</span>
          </button>
        </div>
      </div>

      {/* Quick Actions Section */}
      <div className="qt-mobile-tool-palette-section">
        <div className="qt-mobile-tool-palette-section-header">Quick Actions</div>
        <div className="qt-mobile-tool-palette-grid">
          {/* Attach File */}
          <button
            type="button"
            onClick={handleAttachFileClick}
            disabled={disabled || uploadingFile}
            className="qt-mobile-tool-palette-button"
          >
            {uploadingFile ? (
              <svg className="w-5 h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
            <span className="qt-mobile-tool-palette-button-label">Attach File</span>
          </button>

          {/* Toggle Preview */}
          <button
            type="button"
            onClick={handleTogglePreview}
            disabled={disabled}
            className="qt-mobile-tool-palette-button"
          >
            {showPreview ? (
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            ) : (
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
            <span className="qt-mobile-tool-palette-button-label">
              {showPreview ? 'Edit Mode' : 'Preview'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
