'use client'

/**
 * Project Detail Header
 *
 * Header section with project info, edit mode, and actions.
 */

import Link from 'next/link'
import type { Project, HeaderDraft } from '../types'
import { Icon } from '@/components/ui/icon'

interface ProjectDetailHeaderProps {
  project: Project
  isEditing: boolean
  draft: HeaderDraft
  onDraftChange: (draft: HeaderDraft) => void
  onEditClick: () => void
  onCancelEdit: () => void
  onSave: () => void
  /** In-view back (workspace tab). When omitted, the route Link is used. */
  onBack?: () => void
}


export function ProjectDetailHeader({
  project,
  isEditing,
  draft,
  onDraftChange,
  onEditClick,
  onCancelEdit,
  onSave,
  onBack,
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b qt-border-default/60 pb-6">
      <div className="flex items-center gap-4">
        {onBack ? (
          <button onClick={onBack} className="qt-text-primary hover:underline text-sm">
            &larr; Projects
          </button>
        ) : (
          <Link href="/prospero" className="qt-text-primary hover:underline text-sm">
            &larr; Projects
          </Link>
        )}
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center text-xl"
          style={{ backgroundColor: project.color || 'var(--muted)' }}
        >
          {project.icon || <Icon name="folder" className="w-6 h-6 qt-text-secondary" />}
        </div>
        <div>
          {isEditing ? (
            <input
              aria-label="Project name"
              type="text"
              value={draft.name}
              onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
              className="qt-heading-2 bg-transparent border-b qt-border-primary focus:outline-none"
            />
          ) : (
            <h1 className="qt-heading-2">{project.name}</h1>
          )}
          {isEditing ? (
            <input
              aria-label="Project description"
              type="text"
              value={draft.description}
              onChange={(e) => onDraftChange({ ...draft, description: e.target.value })}
              placeholder="Add a description..."
              className="qt-text-small bg-transparent border-b qt-border-default focus:outline-none w-full"
            />
          ) : (
            project.description && <p className="qt-text-small">{project.description}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/salon/new?projectId=${project.id}`}
          className="inline-flex items-center gap-2 rounded-lg qt-bg-success px-4 py-2 text-sm font-semibold qt-text-on-success shadow hover:qt-bg-success/90"
        >
          <Icon name="plus" className="w-4 h-4" />
          New Chat
        </Link>
        {isEditing ? (
          <>
            <button
              onClick={onCancelEdit}
              className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-shadow-sm hover:qt-bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              className="qt-button qt-button-primary"
            >
              Save
            </button>
          </>
        ) : (
          <button
            onClick={onEditClick}
            className="inline-flex items-center rounded-lg border qt-border-default qt-bg-card px-4 py-2 text-sm qt-shadow-sm hover:qt-bg-muted"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  )
}
