'use client'

import { useRef, useState, useEffect } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

interface RoleplayTemplate {
  id: string
  name: string
  description: string | null
  isBuiltIn: boolean
}

interface ToolPaletteProps {
  isOpen: boolean
  onClose: () => void
  toggleButtonRef?: React.RefObject<HTMLButtonElement | null>
  onGalleryClick: () => void
  onSettingsClick: () => void
  onRenameClick?: () => void
  onProjectClick?: () => void
  projectName?: string | null
  onAddCharacterClick?: () => void
  onDeleteChatMemoriesClick?: () => void
  onReextractMemoriesClick?: () => void
  onSearchReplaceClick?: () => void
  onBulkCharacterReplaceClick?: () => void
  onToolSettingsClick?: () => void
  onRunToolClick?: () => void
  onStateClick?: () => void
  onRegenerateBackgroundClick?: () => void
  agentModeEnabled?: boolean | null
  onAgentModeToggle?: () => void
  chatPhotoCount: number
  showAddCharacter?: boolean
  chatId: string
  chatMemoryCount?: number
  storyBackgroundsEnabled?: boolean
  disabled?: boolean
  roleplayTemplateId?: string | null
  onRoleplayTemplateChange?: () => void
}

/**
 * Tool palette section header component
 */
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="qt-tool-palette-section-header">
      {icon}
      <span>{title}</span>
    </div>
  )
}

export default function ToolPalette({
  isOpen,
  onClose,
  toggleButtonRef,
  onGalleryClick,
  onSettingsClick,
  onRenameClick,
  onProjectClick,
  projectName,
  onAddCharacterClick,
  onDeleteChatMemoriesClick,
  onReextractMemoriesClick,
  onSearchReplaceClick,
  onBulkCharacterReplaceClick,
  onToolSettingsClick,
  onRunToolClick,
  onStateClick,
  onRegenerateBackgroundClick,
  agentModeEnabled = false,
  onAgentModeToggle,
  chatPhotoCount,
  showAddCharacter = false,
  chatId,
  chatMemoryCount = 0,
  storyBackgroundsEnabled = false,
  disabled = false,
  roleplayTemplateId,
  onRoleplayTemplateChange,
}: ToolPaletteProps) {
  const paletteRef = useRef<HTMLDivElement>(null)
  const [roleplayTemplates, setRoleplayTemplates] = useState<RoleplayTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(roleplayTemplateId ?? null)
  const [templateSaving, setTemplateSaving] = useState(false)

  useClickOutside(paletteRef, onClose, {
    enabled: isOpen,
    excludeRefs: toggleButtonRef ? [toggleButtonRef] : [],
    onEscape: onClose,
  })

  // Fetch roleplay templates when palette opens
  useEffect(() => {
    if (isOpen) {
      setSelectedTemplateId(roleplayTemplateId ?? null)
      fetch('/api/v1/roleplay-templates')
        .then(res => res.ok ? res.json() : [])
        .then(data => setRoleplayTemplates(data))
        .catch(() => setRoleplayTemplates([]))
    }
  }, [isOpen, roleplayTemplateId])

  const handleRoleplayTemplateChange = async (templateId: string | null) => {
    try {
      setTemplateSaving(true)
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleplayTemplateId: templateId }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`)
      }
      setSelectedTemplateId(templateId)
      showSuccessToast('Roleplay template updated')
      onRoleplayTemplateChange?.()
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      showErrorToast(msg || 'Failed to update roleplay template')
    } finally {
      setTemplateSaving(false)
    }
  }

  const handleGalleryClick = () => {
    onGalleryClick()
    onClose()
  }

  const handleSettingsClick = () => {
    onSettingsClick()
    onClose()
  }

  const handleRenameClick = () => {
    onRenameClick?.()
    onClose()
  }

  const handleProjectClick = () => {
    onProjectClick?.()
    onClose()
  }

  const handleAddCharacterClick = () => {
    onAddCharacterClick?.()
    onClose()
  }

  const handleExportClick = () => {
    window.location.href = `/api/v1/chats/${chatId}?action=export`
    onClose()
  }

  const handleDeleteChatMemoriesClick = () => {
    onDeleteChatMemoriesClick?.()
    onClose()
  }

  const handleReextractMemoriesClick = () => {
    onReextractMemoriesClick?.()
    onClose()
  }

  const handleSearchReplaceClick = () => {
    onSearchReplaceClick?.()
    onClose()
  }

  const handleBulkCharacterReplaceClick = () => {
    onBulkCharacterReplaceClick?.()
    onClose()
  }

  const handleToolSettingsClick = () => {
    onToolSettingsClick?.()
    onClose()
  }

  const handleRunToolClick = () => {
    onRunToolClick?.()
    onClose()
  }

  const handleStateClick = () => {
    onStateClick?.()
    onClose()
  }

  const handleAgentModeToggle = () => {
    onAgentModeToggle?.()
    onClose()
  }

  const handleRegenerateBackgroundClick = () => {
    onRegenerateBackgroundClick?.()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      ref={paletteRef}
      className="qt-tool-palette-popover"
    >
      {/* CHAT Section */}
      <div className="qt-tool-palette-section">
        <SectionHeader
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          title="CHAT"
        />
        <div className="qt-tool-palette-section-content">
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

          {/* Tool Settings */}
          {onToolSettingsClick && (
            <button
              type="button"
              onClick={handleToolSettingsClick}
              className="qt-tool-palette-button"
              title="Configure LLM tools"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>Tools</span>
            </button>
          )}

          {/* Run Tool */}
          {onRunToolClick && (
            <button
              type="button"
              onClick={handleRunToolClick}
              className="qt-tool-palette-button"
              title="Run a tool manually"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
              </svg>
              <span>Run Tool</span>
            </button>
          )}

          {/* Agent Mode Toggle */}
          {onAgentModeToggle && (
            <button
              type="button"
              onClick={handleAgentModeToggle}
              className={`qt-tool-palette-badge ${agentModeEnabled ? 'qt-tool-palette-badge-on' : 'qt-tool-palette-badge-off'}`}
              title={agentModeEnabled ? 'Disable agent mode' : 'Enable agent mode'}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>{agentModeEnabled ? 'Agent On' : 'Agent Off'}</span>
            </button>
          )}

          {/* Regenerate Story Background */}
          {storyBackgroundsEnabled && onRegenerateBackgroundClick && (
            <button
              type="button"
              onClick={handleRegenerateBackgroundClick}
              className="qt-tool-palette-button"
              title="Regenerate story background image"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Regen Background</span>
            </button>
          )}
        </div>
      </div>

      {/* ORGANIZE Section */}
      <div className="qt-tool-palette-section">
        <SectionHeader
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          }
          title="ORGANIZE"
        />
        <div className="qt-tool-palette-section-content">
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

          {/* Chat State */}
          {onStateClick && (
            <button
              type="button"
              onClick={handleStateClick}
              className="qt-tool-palette-button"
              title="View/edit chat state"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              <span>State</span>
            </button>
          )}
        </div>
      </div>

      {/* EDIT CONTENT Section */}
      <div className="qt-tool-palette-section">
        <SectionHeader
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          }
          title="EDIT CONTENT"
        />
        <div className="qt-tool-palette-section-content">
          {/* Roleplay Template */}
          <div className="qt-tool-palette-inline-select">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <select
              value={selectedTemplateId || ''}
              onChange={(e) => handleRoleplayTemplateChange(e.target.value || null)}
              disabled={templateSaving}
              className="qt-tool-palette-select"
              title="Roleplay template"
            >
              <option value="">No Template</option>
              {roleplayTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}{template.isBuiltIn ? ' (Built-in)' : ''}
                </option>
              ))}
            </select>
          </div>

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
        </div>
      </div>
    </div>
  )
}
