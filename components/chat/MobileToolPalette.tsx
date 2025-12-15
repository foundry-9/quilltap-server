'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

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
  // Export
  chatId: string
  // Memory management
  onDeleteChatMemoriesClick?: () => void
  onReextractMemoriesClick?: () => void
  chatMemoryCount?: number
  // Roleplay template info for RP buttons
  roleplayTemplateId?: string | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  input: string
  setInput: (value: string) => void
  // Disabled state
  disabled?: boolean
}

type AnnotationType = 'narration' | 'internal' | 'ooc'

interface AnnotationConfig {
  label: string
  type: AnnotationType
  prefix: string
  suffix: string
}

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

// Standard template annotations
const STANDARD_ANNOTATIONS: AnnotationConfig[] = [
  { label: 'Narration', type: 'narration', prefix: '*', suffix: '*' },
  { label: 'OOC', type: 'ooc', prefix: '((', suffix: '))' },
]

// Quilltap RP template annotations
const QUILLTAP_RP_ANNOTATIONS: AnnotationConfig[] = [
  { label: 'Narration', type: 'narration', prefix: '[', suffix: ']' },
  { label: 'Internal', type: 'internal', prefix: '{', suffix: '}' },
  { label: 'OOC', type: 'ooc', prefix: '// ', suffix: '' },
]

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
  chatId,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  chatMemoryCount = 0,
  roleplayTemplateId,
  inputRef,
  input,
  setInput,
  disabled = false,
}: MobileToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)
  const [template, setTemplate] = useState<RoleplayTemplate | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState(false)

  // Fetch template info when roleplayTemplateId changes
  useEffect(() => {
    if (!roleplayTemplateId) {
      setTemplate(null)
      return
    }

    const fetchTemplate = async () => {
      try {
        setLoadingTemplate(true)
        clientLogger.debug('[MobileToolPalette] Fetching template', {
          roleplayTemplateId,
        })

        const response = await fetch(`/api/roleplay-templates/${roleplayTemplateId}`)
        if (response.ok) {
          const data = await response.json()
          setTemplate(data)
          clientLogger.debug('[MobileToolPalette] Template loaded', {
            templateName: data.name,
            isBuiltIn: data.isBuiltIn,
          })
        } else {
          clientLogger.warn('[MobileToolPalette] Failed to fetch template', {
            roleplayTemplateId,
            status: response.status,
          })
          setTemplate(null)
        }
      } catch (error) {
        clientLogger.error('[MobileToolPalette] Error fetching template', {
          roleplayTemplateId,
          error: error instanceof Error ? error.message : String(error),
        })
        setTemplate(null)
      } finally {
        setLoadingTemplate(false)
      }
    }

    fetchTemplate()
  }, [roleplayTemplateId])

  // Get annotations based on template type
  const getAnnotations = useCallback((): AnnotationConfig[] => {
    if (!template) return []

    if (template.name === 'Standard') {
      return STANDARD_ANNOTATIONS
    } else if (template.name === 'Quilltap RP') {
      return QUILLTAP_RP_ANNOTATIONS
    }

    return STANDARD_ANNOTATIONS
  }, [template])

  // Insert annotation at cursor position
  const insertAnnotation = useCallback(
    (config: AnnotationConfig) => {
      const textarea = inputRef.current
      if (!textarea) return

      clientLogger.debug('[MobileToolPalette] Inserting annotation', {
        type: config.type,
        label: config.label,
      })

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = input.substring(start, end)

      const before = input.substring(0, start)
      const after = input.substring(end)
      const wrapped = config.prefix + selectedText + config.suffix
      const newValue = before + wrapped + after

      setInput(newValue)

      const newCursorPos = selectedText
        ? start + wrapped.length
        : start + config.prefix.length

      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(newCursorPos, newCursorPos)
      }, 0)

      onClose()
    },
    [input, inputRef, setInput, onClose]
  )

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!paletteRef.current) return

      const target = event.target as Node

      // Don't close if clicking inside the palette
      if (paletteRef.current.contains(target)) {
        return
      }

      // Don't close if clicking the toggle button (it handles its own toggle)
      if (toggleButtonRef?.current?.contains(target)) {
        return
      }

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
  }, [isOpen, onClose, toggleButtonRef])

  // Debug logging when palette opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('[MobileToolPalette] Opened', {
        showAddCharacter,
        hasImageProfile,
        chatPhotoCount,
        chatId,
        chatMemoryCount,
        roleplayTemplateId,
      })
    }
  }, [isOpen, showAddCharacter, hasImageProfile, chatPhotoCount, chatId, chatMemoryCount, roleplayTemplateId])

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

  const annotations = getAnnotations()
  const hasRpButtons = roleplayTemplateId && template && annotations.length > 0 && !loadingTemplate

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

      {/* Bottom Section: Quick Actions (left) | Roleplay (right) */}
      <div className="qt-mobile-tool-palette-section">
        <div className="qt-mobile-tool-palette-split">
          {/* Quick Actions - Left Column */}
          <div className="qt-mobile-tool-palette-split-column">
            <div className="qt-mobile-tool-palette-section-header">Quick Actions</div>
            <div className="flex flex-col gap-1.5">
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

          {/* Roleplay - Right Column */}
          {hasRpButtons && (
            <div className="qt-mobile-tool-palette-split-column">
              <div className="qt-mobile-tool-palette-section-header">Roleplay</div>
              <div className="qt-mobile-tool-palette-rp-buttons">
                {annotations.map((config) => (
                  <button
                    key={config.type}
                    type="button"
                    onClick={() => insertAnnotation(config)}
                    disabled={disabled}
                    className={`qt-rp-annotation-button qt-rp-annotation-button-${config.type}`}
                    title={`Insert ${config.label.toLowerCase()} notation (${config.prefix}...${config.suffix || 'end of line'})`}
                  >
                    {config.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
