/**
 * ProjectItem
 *
 * Individual project item for the homepage projects list.
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
    <div className="flex items-center gap-3 p-2 rounded-lg hover:qt-bg-muted/50 transition-colors">
      <Link
        href={`/prospero/${project.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <div className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md qt-bg-muted">
          <Icon name="folder" className="w-5 h-5" style={project.color ? { color: project.color } : undefined} />
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
        <Icon name="chat" className="w-4 h-4" />
      </Link>
    </div>
  )
}
