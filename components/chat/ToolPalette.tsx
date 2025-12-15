'use client'

import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'

interface ToolPaletteProps {
  isOpen: boolean
  onClose: () => void
  onGalleryClick: () => void
  onGenerateImageClick: () => void
  onSettingsClick: () => void
  onAddCharacterClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  onReextractMemoriesClick?: () => void
  chatPhotoCount: number
  hasImageProfile: boolean
  showAddCharacter?: boolean // Show "Add Character" button for single-character chats
  chatId: string // Chat ID for export functionality
  chatMemoryCount?: number // Number of memories associated with this chat
}

interface PalettePosition {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export default function ToolPalette({
  isOpen,
  onClose,
  onGalleryClick,
  onGenerateImageClick,
  onSettingsClick,
  onAddCharacterClick,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  chatPhotoCount,
  hasImageProfile,
  showAddCharacter = false,
  chatId,
  chatMemoryCount = 0,
}: ToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PalettePosition>({ bottom: 80, right: 0 })

  // Calculate viewport-aware position when palette opens
  useLayoutEffect(() => {
    if (!isOpen || !paletteRef.current) return

    const palette = paletteRef.current
    const parent = palette.parentElement
    if (!parent) return

    const paletteRect = palette.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const padding = 8 // Minimum padding from viewport edge

    const newPosition: PalettePosition = {}

    // Horizontal positioning: prefer right-aligned, but switch to left if overflowing
    const rightEdge = parentRect.right
    const leftEdge = parentRect.left
    const paletteWidth = paletteRect.width

    if (rightEdge - paletteWidth < padding) {
      // Would overflow left edge, align to left of parent instead
      newPosition.left = 0
      clientLogger.debug('[ToolPalette] Adjusted horizontal position: left-aligned', {
        rightEdge,
        paletteWidth,
        viewportWidth,
      })
    } else if (leftEdge + paletteWidth > viewportWidth - padding) {
      // Would overflow right edge, keep right-aligned
      newPosition.right = 0
    } else {
      // Default: right-aligned
      newPosition.right = 0
    }

    // Vertical positioning: prefer above (bottom: 80), but switch to below if overflowing top
    const buttonBottom = parentRect.bottom
    const paletteHeight = paletteRect.height
    const spaceAbove = parentRect.top - padding
    const spaceBelow = viewportHeight - buttonBottom - padding

    if (spaceAbove < paletteHeight && spaceBelow > paletteHeight) {
      // Not enough space above, but enough below - position below the button
      newPosition.top = parent.offsetHeight + 8
      clientLogger.debug('[ToolPalette] Adjusted vertical position: below button', {
        spaceAbove,
        spaceBelow,
        paletteHeight,
      })
    } else if (spaceAbove < paletteHeight) {
      // Not enough space above or below - constrain to available space above
      newPosition.bottom = Math.min(80, spaceAbove)
      clientLogger.debug('[ToolPalette] Constrained vertical position', {
        spaceAbove,
        newBottom: newPosition.bottom,
      })
    } else {
      // Enough space above - use default position
      newPosition.bottom = 80
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Necessary for DOM measurement before paint
    setPosition(newPosition)
  }, [isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!paletteRef.current) return

      const target = event.target as Node

      // Check if click is inside the palette
      if (paletteRef.current.contains(target)) {
        return
      }

      // Check if click is on the parent div (which contains the button)
      if (paletteRef.current.parentElement?.contains(target)) {
        return
      }

      // Click is outside both palette and parent container
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

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

  // Debug logging when palette opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[ToolPalette] Opened', {
        showAddCharacter,
        hasAddCharacterCallback: !!onAddCharacterClick,
        hasDeleteMemoriesCallback: !!onDeleteChatMemoriesClick,
        hasReextractMemoriesCallback: !!onReextractMemoriesClick,
        chatPhotoCount,
        hasImageProfile,
        chatId,
        chatMemoryCount,
      })
    }
  }, [isOpen, showAddCharacter, onAddCharacterClick, onDeleteChatMemoriesClick, onReextractMemoriesClick, chatPhotoCount, hasImageProfile, chatId, chatMemoryCount])

  if (!isOpen) return null

  // Build dynamic style from position state
  const positionStyle: React.CSSProperties = {
    position: 'absolute',
    ...(position.top !== undefined && { top: position.top }),
    ...(position.bottom !== undefined && { bottom: position.bottom }),
    ...(position.left !== undefined && { left: position.left }),
    ...(position.right !== undefined && { right: position.right }),
    maxHeight: 'calc(100vh - 100px)', // Ensure palette doesn't exceed viewport
    overflowY: 'auto',
  }

  return (
    <div
      ref={paletteRef}
      className="bg-background border border-border rounded-lg shadow-lg p-2 w-48 z-50"
      style={positionStyle}
    >
      {/* Gallery Button */}
      {chatPhotoCount > 0 && (
        <button
          type="button"
          onClick={handleGalleryClick}
          className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            <div className="font-medium">View Gallery</div>
            <div className="text-xs text-muted-foreground">{chatPhotoCount} photos</div>
          </div>
        </button>
      )}

      {/* Generate Image Button */}
      {hasImageProfile && (
        <button
          type="button"
          onClick={handleGenerateImageClick}
          className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div>
            <div className="font-medium">Generate Image</div>
            <div className="text-xs text-muted-foreground">With {'{{placeholders}}'} support</div>
          </div>
        </button>
      )}

      {/* Add Character Button - shown only for single-character chats */}
      {showAddCharacter && onAddCharacterClick && (
        <button
          type="button"
          onClick={handleAddCharacterClick}
          className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
        >
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          <div>
            <div className="font-medium">Add Character</div>
            <div className="text-xs text-muted-foreground">Start a multi-character chat</div>
          </div>
        </button>
      )}

      {/* Chat Settings Button */}
      <button
        type="button"
        onClick={handleSettingsClick}
        className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <div>
          <div className="font-medium">Chat Settings</div>
          <div className="text-xs text-muted-foreground">Provider & Images</div>
        </div>
      </button>

      {/* Export Chat Button */}
      <button
        type="button"
        onClick={handleExportClick}
        className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <div>
          <div className="font-medium">Export Chat</div>
          <div className="text-xs text-muted-foreground">Download as JSONL</div>
        </div>
      </button>

      {/* Memory Management Section - only shown when callbacks are provided */}
      {(onDeleteChatMemoriesClick || onReextractMemoriesClick) && (
        <>
          {/* Divider */}
          <div className="my-2 border-t border-border" />

          {/* Re-extract Memories Button */}
          {onReextractMemoriesClick && (
            <button
              type="button"
              onClick={handleReextractMemoriesClick}
              className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-foreground hover:bg-accent"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <div>
                <div className="font-medium">Re-extract Memories</div>
                <div className="text-xs text-muted-foreground">Queue memory jobs for chat</div>
              </div>
            </button>
          )}

          {/* Delete Chat Memories Button */}
          {onDeleteChatMemoriesClick && (
            <button
              type="button"
              onClick={handleDeleteChatMemoriesClick}
              className="qt-dropdown-item w-full gap-3 px-4 py-3 text-left text-destructive hover:bg-destructive/10"
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <div>
                <div className="font-medium">Delete Chat Memories</div>
                <div className="text-xs text-muted-foreground">
                  {chatMemoryCount > 0 ? `${chatMemoryCount} memories` : 'No memories'}
                </div>
              </div>
            </button>
          )}
        </>
      )}
    </div>
  )
}
