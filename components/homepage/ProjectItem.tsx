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
    <Link
      href={`/projects/${project.id}`}
      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
    >
      <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md bg-muted">
        <FolderIcon className="w-5 h-5" color={project.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {project.name}
        </p>
        {project.description && (
          <p className="text-xs text-muted-foreground truncate">
            {project.description}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="text-xs text-muted-foreground">
          {formatMessageTime(project.lastActivity)}
        </span>
        <span className="text-xs text-primary">
          {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
        </span>
      </div>
    </Link>
  )
}
