'use client'

/**
 * Settings Card
 *
 * Card displaying project instructions and project state.
 * Spans two rows in the grid layout to give instructions plenty of room.
 */

import { useState } from 'react'
import type { Project, EditForm } from '../types'
import StateEditorModal from '@/components/state/StateEditorModal'

interface SettingsCardProps {
  project: Project
  editForm: EditForm
  onEditFormChange: (form: EditForm) => void
  onSave: () => void
  expanded: boolean
  onToggle: () => void
  onProjectUpdate?: () => void
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export function SettingsCard({
  project,
  editForm,
  onEditFormChange,
  onSave,
  expanded,
  onToggle,
  onProjectUpdate,
}: SettingsCardProps) {
  const [showStateEditorModal, setShowStateEditorModal] = useState(false)

  return (
    <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden row-span-2">
      {/* Header - always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-5 h-5 qt-text-primary" />
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
            <textarea
              value={editForm.instructions}
              onChange={(e) => onEditFormChange({ ...editForm, instructions: e.target.value })}
              rows={10}
              placeholder="Add instructions for characters in this project..."
              className="qt-textarea w-full"
            />
            <div className="mt-2 flex justify-end">
              <button onClick={onSave} className="qt-button qt-button-primary">
                Save
              </button>
            </div>
          </div>

          {/* Project State */}
          <div className="flex items-center justify-between p-3 rounded-lg qt-border qt-bg-surface">
            <div>
              <h4 className="text-sm font-medium text-foreground">Project State</h4>
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
