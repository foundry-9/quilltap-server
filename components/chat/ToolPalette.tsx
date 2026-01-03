'use client'

import { useEffect, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { useClickOutside } from '@/hooks/useClickOutside'

interface ToolPaletteProps {
  isOpen: boolean
  onClose: () => void
  toggleButtonRef?: React.RefObject<HTMLButtonElement | null>
  onGalleryClick: () => void
  onGenerateImageClick: () => void
  onSettingsClick: () => void
  onRenameClick?: () => void
  onProjectClick?: () => void // Assign chat to project
  projectName?: string | null // Current project name (to show in button)
  onAddCharacterClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  onReextractMemoriesClick?: () => void
  onSearchReplaceClick?: () => void // Search and replace in chat
  onBulkCharacterReplaceClick?: () => void // Bulk re-attribute messages between characters
  chatPhotoCount: number
  hasImageProfile: boolean
  showAddCharacter?: boolean // Show "Add Character" button for single-character chats
  chatId: string // Chat ID for export functionality
  chatMemoryCount?: number // Number of memories associated with this chat
  // File attachment props
  onAttachFileClick?: () => void
  uploadingFile?: boolean
  // Preview toggle props
  showPreview?: boolean
  onTogglePreview?: () => void
  disabled?: boolean
}

export default function ToolPalette({
  isOpen,
  onClose,
  toggleButtonRef,
  onGalleryClick,
  onGenerateImageClick,
  onSettingsClick,
  onRenameClick,
  onProjectClick,
  projectName,
  onAddCharacterClick,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  onSearchReplaceClick,
  onBulkCharacterReplaceClick,
  chatPhotoCount,
  hasImageProfile,
  showAddCharacter = false,
  chatId,
  chatMemoryCount = 0,
  // File attachment
  onAttachFileClick,
  uploadingFile = false,
  // Preview toggle
  showPreview = false,
  onTogglePreview,
  disabled = false,
}: ToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)

  useClickOutside(paletteRef, onClose, {
    enabled: isOpen,
    excludeRefs: toggleButtonRef ? [toggleButtonRef] : [],
    onEscape: onClose,
  })

  const handleGalleryClick = () => {
    onGalleryClick()
    onClose()
  }

  const handleGenerateImageClick = () => {
    onGenerateImageClick()
    onClose()
  }

  const handleSettingsClick = () => {
    onSettingsClick()
    onClose()
  }

  const handleRenameClick = () => {
    clientLogger.debug('[ToolPalette] Rename clicked')
    onRenameClick?.()
    onClose()
  }

  const handleProjectClick = () => {
    clientLogger.debug('[ToolPalette] Project clicked', { projectName })
    onProjectClick?.()
    onClose()
  }

  const handleAddCharacterClick = () => {
    clientLogger.debug('[ToolPalette] Add Character clicked')
    onAddCharacterClick?.()
    onClose()
  }

  const handleExportClick = () => {
    clientLogger.debug('[ToolPalette] Export Chat clicked', { chatId })
    // Trigger download by navigating to the export endpoint
    window.location.href = `/api/chats/${chatId}/export`
    onClose()
  }

  const handleDeleteChatMemoriesClick = () => {
    clientLogger.debug('[ToolPalette] Delete Chat Memories clicked', { chatId, chatMemoryCount })
    onDeleteChatMemoriesClick?.()
    onClose()
  }

  const handleReextractMemoriesClick = () => {
    clientLogger.debug('[ToolPalette] Re-extract Memories clicked', { chatId })
    onReextractMemoriesClick?.()
    onClose()
  }

  const handleAttachFileClick = () => {
    clientLogger.debug('[ToolPalette] Attach File clicked')
    onAttachFileClick?.()
    onClose()
  }

  const handleSearchReplaceClick = () => {
    clientLogger.debug('[ToolPalette] Search & Replace clicked', { chatId })
    onSearchReplaceClick?.()
    onClose()
  }

  const handleBulkCharacterReplaceClick = () => {
    clientLogger.debug('[ToolPalette] Bulk Character Replace clicked', { chatId })
    onBulkCharacterReplaceClick?.()
    onClose()
  }

  const handleTogglePreview = () => {
    clientLogger.debug('[ToolPalette] Toggle Preview clicked', { showPreview })
    onTogglePreview?.()
    onClose()
  }

  // Debug logging when palette opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[ToolPalette] Opened', {
        showAddCharacter,
        hasAddCharacterCallback: !!onAddCharacterClick,
        hasDeleteMemoriesCallback: !!onDeleteChatMemoriesClick,
        hasReextractMemoriesCallback: !!onReextractMemoriesClick,
        hasSearchReplaceCallback: !!onSearchReplaceClick,
        hasBulkCharacterReplaceCallback: !!onBulkCharacterReplaceClick,
        hasRenameCallback: !!onRenameClick,
        hasProjectCallback: !!onProjectClick,
        projectName,
        chatPhotoCount,
        hasImageProfile,
        chatId,
        chatMemoryCount,
        hasAttachFile: !!onAttachFileClick,
        hasPreviewToggle: !!onTogglePreview,
      })
    }
  }, [isOpen, showAddCharacter, onAddCharacterClick, onDeleteChatMemoriesClick, onReextractMemoriesClick, onSearchReplaceClick, onBulkCharacterReplaceClick, onRenameClick, onProjectClick, projectName, chatPhotoCount, hasImageProfile, chatId, chatMemoryCount, onAttachFileClick, onTogglePreview])

  if (!isOpen) return null

  return (
    <div
      ref={paletteRef}
      className="qt-tool-palette-bar"
    >
      {/* Left section: Attach File, Chat Settings, Export */}
      <div className="qt-tool-palette-section qt-tool-palette-section-left">
        {/* Attach File */}
        {onAttachFileClick && (
          <button
            type="button"
            onClick={handleAttachFileClick}
            disabled={disabled || uploadingFile}
            className="qt-tool-palette-button"
            title="Attach file"
          >
            {uploadingFile ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
            <span>Attach</span>
          </button>
        )}

        {/* Chat Settings */}
        <button
          type="button"
          onClick={handleSettingsClick}
          className="qt-tool-palette-button"
          title="Chat settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>Settings</span>
        </button>

        {/* Rename Chat */}
        {onRenameClick && (
          <button
            type="button"
            onClick={handleRenameClick}
            className="qt-tool-palette-button"
            title="Rename chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>Rename</span>
          </button>
        )}

        {/* Project Assignment */}
        {onProjectClick && (
          <button
            type="button"
            onClick={handleProjectClick}
            className="qt-tool-palette-button"
            title={projectName ? `In project: ${projectName}` : 'Assign to project'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span>{projectName ? projectName : 'Project'}</span>
          </button>
        )}

        {/* Export Chat */}
        <button
          type="button"
          onClick={handleExportClick}
          className="qt-tool-palette-button"
          title="Export chat"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>Export</span>
        </button>

        {/* Search & Replace */}
        {onSearchReplaceClick && (
          <button
            type="button"
            onClick={handleSearchReplaceClick}
            className="qt-tool-palette-button"
            title="Search and replace in chat"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span>Replace</span>
          </button>
        )}

        {/* Optional Gallery - only when photos exist */}
        {chatPhotoCount > 0 && (
          <button
            type="button"
            onClick={handleGalleryClick}
            className="qt-tool-palette-button"
            title="View gallery"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Gallery ({chatPhotoCount})</span>
          </button>
        )}

        {/* Optional Generate Image */}
        {hasImageProfile && (
          <button
            type="button"
            onClick={handleGenerateImageClick}
            className="qt-tool-palette-button"
            title="Generate image"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Generate</span>
          </button>
        )}

        {/* Optional Add Character */}
        {showAddCharacter && onAddCharacterClick && (
          <button
            type="button"
            onClick={handleAddCharacterClick}
            className="qt-tool-palette-button"
            title="Add character"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            <span>Add Character</span>
          </button>
        )}

        {/* Bulk Character Replace */}
        {onBulkCharacterReplaceClick && (
          <button
            type="button"
            onClick={handleBulkCharacterReplaceClick}
            className="qt-tool-palette-button"
            title="Bulk re-attribute messages between characters"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Bulk Replace</span>
          </button>
        )}
      </div>

      {/* Right section: Re-extract, Delete, Preview */}
      <div className="qt-tool-palette-section qt-tool-palette-section-right">
        {/* Re-extract Memories */}
        {onReextractMemoriesClick && (
          <button
            type="button"
            onClick={handleReextractMemoriesClick}
            className="qt-tool-palette-button"
            title="Re-extract memories"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Re-extract</span>
          </button>
        )}

        {/* Delete Chat Memories */}
        {onDeleteChatMemoriesClick && (
          <button
            type="button"
            onClick={handleDeleteChatMemoriesClick}
            className="qt-tool-palette-button qt-tool-palette-button-danger"
            title="Delete chat memories"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Delete ({chatMemoryCount})</span>
          </button>
        )}

        {/* Preview Toggle */}
        {onTogglePreview && (
          <button
            type="button"
            onClick={handleTogglePreview}
            disabled={disabled}
            className="qt-tool-palette-button"
            title={showPreview ? 'Switch to edit mode' : 'Preview message'}
          >
            {showPreview ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
            <span>{showPreview ? 'Edit' : 'Preview'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
