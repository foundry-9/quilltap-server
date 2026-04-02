'use client'

/**
 * Project Card
 *
 * Displays a single project with counts and actions.
 */

import Link from 'next/link'
import type { Project } from '../types'

interface ProjectCardProps {
  project: Project
  onClick: (e: React.MouseEvent) => void
  onDelete: () => void
}

/**
 * Folder icon for projects without custom icons
 */
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

/**
 * Trash icon for delete button
 */
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

export function ProjectCard({ project, onClick, onDelete }: ProjectCardProps) {
  return (
    <div
      className="qt-entity-card cursor-pointer hover:qt-border-primary/50 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
            style={{ backgroundColor: project.color || 'var(--muted)' }}
          >
            {project.icon || <FolderIcon className="w-5 h-5 qt-text-secondary" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{project.name}</h2>
            <p className="qt-text-small">
              {project.chatCount} chat{project.chatCount !== 1 ? 's' : ''} &bull; {project.fileCount} file{project.fileCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {project.description && (
        <p className="line-clamp-2 qt-text-small mb-4">{project.description}</p>
      )}

      <div className="qt-entity-card-actions flex gap-2">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground qt-shadow-sm transition hover:qt-bg-primary/90"
        >
          Open
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="qt-button-destructive qt-shadow-sm"
          title="Delete project"
        >
          <TrashIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}
