/**
 * ProjectItem
 *
 * One project on the home page's shelf.
 */

import Link from 'next/link'
import { formatMessageTime } from '@/lib/format-time'
import { Icon } from '@/components/ui/icon'
import type { HomepageProject } from './types'

interface ProjectItemProps {
  project: HomepageProject
}

export function ProjectItem({ project }: ProjectItemProps) {
  return (
    <div className="qt-homepage-row">
      <Link
        href={`/prospero/${project.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
        title={project.description || undefined}
      >
        <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md qt-bg-muted">
          <Icon name="folder" className="w-5 h-5" style={project.color ? { color: project.color } : undefined} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="qt-card-title truncate">
            {project.name}
          </p>
          <p className="qt-meta truncate">
            <span className="qt-text-brand">
              {project.chatCount} {project.chatCount === 1 ? 'chat' : 'chats'}
            </span>
            <span aria-hidden="true"> &middot; </span>
            <span>{formatMessageTime(project.lastActivity)}</span>
          </p>
        </div>
      </Link>
      <Link
        href={`/salon/new?projectId=${project.id}`}
        className="shrink-0 qt-button-success qt-button-sm !px-2"
        title={`Start a new chat in ${project.name}`}
        aria-label={`Start a new chat in ${project.name}`}
      >
        <Icon name="chat" className="w-4 h-4" />
      </Link>
    </div>
  )
}
