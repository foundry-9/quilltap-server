'use client'

/**
 * Settings Card
 *
 * Card displaying project instructions and project state.
 * Spans the full grid width so the Lexical instructions editor has room to
 * breathe instead of being squeezed into a single column.
 */

import { useState } from 'react'
import type { Project } from '../types'
import StateEditorModal from '@/components/state/StateEditorModal'
import { ChevronIcon } from '@/components/ui/ChevronIcon'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { Icon } from '@/components/ui/icon'

interface SettingsCardProps {
  project: Project
  instructions: string
  onInstructionsChange: (value: string) => void
  /** The instructions differ from what is saved. */
  instructionsDirty: boolean
  /** Saves the instructions only. */
  onSave: () => void
  expanded: boolean
  onToggle: () => void
  onProjectUpdate?: () => void
}


export function SettingsCard({
  project,
  instructions,
  onInstructionsChange,
  instructionsDirty,
  onSave,
  expanded,
  onToggle,
  onProjectUpdate,
}: SettingsCardProps) {
  const [showStateEditorModal, setShowStateEditorModal] = useState(false)

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden col-span-full">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <Icon name="settings" className="w-5 h-5 qt-text-primary" />
          <div className="text-left">
            <h3 className="qt-heading-4 text-foreground">Project Settings</h3>
            <p className="qt-text-small qt-text-secondary">
              Instructions &amp; project state
            </p>
          </div>
        </div>
        <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
      </button>

      {/* Content - expandable */}
      {expanded && (
        <div className="border-t qt-border-default p-4 space-y-4">
          {/* Project Instructions */}
          <div>
            <label className="qt-text-label block mb-2">Project Instructions</label>
            <p className="qt-text-xs qt-text-secondary mb-2">
              These instructions are included in system prompts for all project chats.
            </p>
            <MarkdownLexicalEditor
              value={instructions}
              onChange={onInstructionsChange}
              remountKey={project.id}
              namespace="ProsperoSettingsCard.instructions"
              ariaLabel="Project instructions"
              minHeight="14rem"
            />
            <div className="mt-2 flex justify-end">
              <button onClick={onSave} disabled={!instructionsDirty} className="qt-button qt-button-primary">
                Save
              </button>
            </div>
          </div>

          {/* Project State */}
          <div className="flex items-center justify-between p-3 rounded-lg qt-border qt-bg-surface">
            <div>
              <h4 className="qt-label text-foreground">Project State</h4>
              <p className="qt-text-xs qt-text-secondary">
                Persistent JSON data for games, inventory, and session tracking.
              </p>
            </div>
            <button
              onClick={() => setShowStateEditorModal(true)}
              className="qt-button qt-button-secondary qt-button-sm"
            >
              View/Edit
            </button>
          </div>
        </div>
      )}

      {/* State Editor Modal */}
      <StateEditorModal
        isOpen={showStateEditorModal}
        onClose={() => setShowStateEditorModal(false)}
        entityType="project"
        entityId={project.id}
        entityName={project.name}
        onSuccess={onProjectUpdate}
      />
    </div>
  )
}
