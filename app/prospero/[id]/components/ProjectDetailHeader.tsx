'use client'

/**
 * Project Detail Header
 *
 * Header section with project info, edit mode, and actions.
 */

import Link from 'next/link'
import type { Project, EditForm } from '../types'

interface ProjectDetailHeaderProps {
  project: Project
  isEditing: boolean
  editForm: EditForm
  onEditFormChange: (form: EditForm) => void
  onEditClick: () => void
  onCancelEdit: () => void
  onSave: () => void
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  )
}

export function ProjectDetailHeader({
  project,
  isEditing,
  editForm,
  onEditFormChange,
  onEditClick,
  onCancelEdit,
  onSave,
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-6">
      <div className="flex items-center gap-4">
        <Link href="/prospero" className="qt-text-primary hover:underline text-sm">
          &larr; Projects
        </Link>
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center text-xl"
          style={{ backgroundColor: project.color || 'var(--muted)' }}
        >
          {project.icon || <FolderIcon className="w-6 h-6 text-muted-foreground" />}
        </div>
        <div>
          {isEditing ? (
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => onEditFormChange({ ...editForm, name: e.target.value })}
              className="text-2xl font-semibold bg-transparent border-b border-primary focus:outline-none"
            />
          ) : (
            <h1 className="text-2xl font-semibold">{project.name}</h1>
          )}
          {isEditing ? (
            <input
              type="text"
              value={editForm.description}
              onChange={(e) => onEditFormChange({ ...editForm, description: e.target.value })}
              placeholder="Add a description..."
              className="qt-text-small bg-transparent border-b border-border focus:outline-none w-full"
            />
          ) : (
            project.description && <p className="qt-text-small">{project.description}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/salon/new?projectId=${project.id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow hover:bg-success/90"
        >
          <PlusIcon className="w-4 h-4" />
          New Chat
        </Link>
        {isEditing ? (
          <>
            <button
              onClick={onCancelEdit}
              className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              Save
            </button>
          </>
        ) : (
          <button
            onClick={onEditClick}
            className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm shadow-sm hover:bg-muted"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
