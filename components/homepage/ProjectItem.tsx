/**
 * ProjectItem
 *
 * Individual project item for the homepage projects list.
 */

import Link from 'next/link'
import { formatMessageTime } from '@/lib/format-time'
import type { HomepageProject } from './types'

interface ProjectItemProps {
  project: HomepageProject
}

// Folder icon
function FolderIcon({ className, color }: { className?: string; color?: string | null }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={color || 'currentColor'}
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function ProjectItem({ project }: ProjectItemProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:qt-bg-muted/50 transition-colors">
      <Link
        href={`/prospero/${project.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md qt-bg-muted">
          <FolderIcon className="w-5 h-5" color={project.color} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="qt-card-title truncate">
            {project.name}
          </p>
          {project.description && (
            <p className="qt-card-subtitle truncate">
              {project.description}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className="qt-meta">
            {formatMessageTime(project.lastActivity)}
          </span>
          <span className="qt-meta text-primary">
            {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
          </span>
        </div>
      </Link>
      <Link
        href={`/salon/new?projectId=${project.id}`}
        className="shrink-0 qt-button-success qt-button-sm !px-2"
        title={`Start a new chat in ${project.name}`}
        aria-label={`Start a new chat in ${project.name}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </Link>
    </div>
  )
}
