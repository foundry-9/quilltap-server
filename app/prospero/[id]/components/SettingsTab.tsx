'use client'

/**
 * Settings Tab
 *
 * Project settings including instructions and character access.
 */

import type { Project, EditForm } from '../types'

interface SettingsTabProps {
  project: Project
  editForm: EditForm
  onEditFormChange: (form: EditForm) => void
  onSave: () => void
  onToggleAllowAnyCharacter: () => void
}

export function SettingsTab({
  project,
  editForm,
  onEditFormChange,
  onSave,
  onToggleAllowAnyCharacter,
}: SettingsTabProps) {
  return (
    <div className="max-w-2xl space-y-6">
      {/* Instructions */}
      <div>
        <h3 className="qt-text-section mb-2">Project Instructions</h3>
        <p className="qt-text-small mb-3">
          These instructions are included in the system prompt for all conversations in this project.
        </p>
        <textarea
          value={editForm.instructions}
          onChange={(e) => onEditFormChange({ ...editForm, instructions: e.target.value })}
          rows={6}
          placeholder="Add instructions for characters in this project..."
          className="w-full rounded-lg border qt-border-default bg-background px-3 py-2 text-foreground focus:qt-border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={onSave}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:qt-bg-primary/90"
          >
            Save Instructions
          </button>
        </div>
      </div>

      {/* Allow Any Character */}
      <div className="flex items-center justify-between p-4 rounded-lg border qt-border-default qt-bg-card">
        <div>
          <h4 className="font-medium">Allow Any Character</h4>
          <p className="qt-text-small">
            When enabled, any character can participate in project chats. When disabled, only roster characters can participate.
          </p>
        </div>
        <button
          onClick={onToggleAllowAnyCharacter}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            project.allowAnyCharacter ? 'bg-primary' : 'qt-bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full qt-bg-toggle-knob transition-transform ${
              project.allowAnyCharacter ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
